import type { Page } from 'puppeteer';
import type { Country } from './providers.js';
import type { Message, OtpRouteHandlerOptions, PhoneNumber, PhoneNumberListReply, Source } from './types.js';
import { normalizePhoneNumber, filterUniquePhones, tryParseOtpCode } from './helpers.js';
import { delay, parseTimeAgo } from '../time/utils.js';
import { getPhones } from '../repository/redis.js';

/** Upstream failures are distinct from a successful inbox with no matching message. */
export class ProviderError extends Error {
  constructor(message: string, public statusCode = 502) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const assertProviderUrl = (url: string, origins: string[]): string => {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new ProviderError('Provider returned an invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !origins.includes(parsed.origin)) {
    throw new ProviderError('Provider returned an unexpected URL');
  }
  return parsed.href;
};

export const navigate = async (page: Page, url: string, origins: string[]): Promise<void> => {
  assertProviderUrl(url, origins);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() >= 400) {
    throw new ProviderError(`Provider page returned HTTP ${response?.status() ?? 'no response'}`, [403, 429].includes(response?.status() ?? 0) ? 503 : 502);
  }
  assertProviderUrl(page.url(), origins);
  const title = await page.title();
  if (/just a moment|access denied|attention required|captcha|verify you are human/i.test(title)) {
    throw new ProviderError('Provider requires an interactive access check', 503);
  }
};

export const normalizePhones = (records: PhoneNumber[], country: Country, origins: string[]): PhoneNumber[] =>
  filterUniquePhones(records.flatMap(({ phone, url }) => {
    try {
      return [{ phone: normalizePhoneNumber(phone, country), url: assertProviderUrl(url, origins) }];
    } catch {
      // Provider cards can also contain advertisements and malformed/inactive records.
      return [];
    }
  }));

export const requirePhones = (phones: PhoneNumber[]): PhoneNumber[] => {
  if (!phones.length) throw new ProviderError('No public numbers found: provider listing is empty or its layout changed', 503);
  return phones;
};

export const nextPage = async (page: Page, origins: string[]): Promise<string | undefined> => {
  const current = page.url();
  const href = await page.evaluate(() => {
    const explicit = document.querySelector<HTMLAnchorElement>('a[rel="next"], .pagination li.active + li a, .pagination .active + a');
    if (explicit?.href) return explicit.href;
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href], .pagination a[href]'));
    return links.find((a) => /^(next|next\s*[»›>]|[»›])$/i.test(a.textContent?.trim() ?? ''))?.href;
  });
  if (!href || href === current || new URL(href).hash) return;
  return assertProviderUrl(href, origins);
};

/** A loading skeleton or changed markup must not be reported as a successful empty inbox. */
export const waitForInboxReady = async (page: Page, rowSelector: string, emptySelector: string, timeoutMs = 15_000): Promise<void> => {
  try {
    await page.waitForFunction((rows, empty) => {
      if (document.querySelector(rows)) return true;
      return Array.from(document.querySelectorAll(empty)).some((node) => /^\s*(?:no (?:sms )?messages(?: received)?(?: yet)?[.!]?|this inbox is empty[.!]?)\s*$/i.test(node.textContent ?? ''));
    }, { timeout: timeoutMs }, rowSelector, emptySelector);
  } catch {
    if (page.isClosed()) throw new ProviderError('Inbox request was closed', 503);
    throw new ProviderError('Provider inbox did not finish loading or its message markup changed', 502);
  }
};

export interface RawMessage { agoText: string; message: string; timestamp?: string; sender?: string; }

export interface ParsedMessageRows {
  messages: Message[];
  rawRowCount: number;
  parseDrops: number;
  droppedTimestampCount: number;
  droppedMessageCount: number;
}

/** Provider absolute timestamps without a zone are interpreted as UTC, independent of host TZ. */
export const parseProviderTimestamp = (input: string, now = Date.now()): number => {
  const text = input.trim().replace(/^(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)$/, '$1-$2-$3T$4');
  if (!text) return 0;
  const absolute = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?$/i);
  if (absolute) {
    const [, y, m, d, h = '0', min = '0', sec = '0', frac = '0', zone] = absolute;
    const components = [Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(sec), Number(frac.padEnd(3, '0'))];
    const date = new Date(Date.UTC(components[0], components[1], components[2], components[3], components[4], components[5], components[6]));
    if (date.getUTCFullYear() !== components[0] || date.getUTCMonth() !== components[1] || date.getUTCDate() !== components[2] || date.getUTCHours() !== components[3] || date.getUTCMinutes() !== components[4] || date.getUTCSeconds() !== components[5]) return 0;
    const timestamp = zone && !/^(Z|UTC|GMT)$/i.test(zone)
      ? Date.parse(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec}.${frac.padEnd(3, '0')}${zone}`)
      : date.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 60_000 ? timestamp : 0;
  }
  // Preserve the established relative-time grammar; do not invent dates for unknown text.
  return parseTimeAgo(text.replace(/\b(sec|secs|min|mins|hr|hrs)\./gi, '$1'), now);
};

export const parseMessageRows = (rows: RawMessage[], url: string, now = Date.now()): ParsedMessageRows => {
  const messages: Message[] = [];
  let droppedTimestampCount = 0;
  let droppedMessageCount = 0;
  for (const row of rows) {
    if (!row.message.trim()) { droppedMessageCount++; continue; }
    const timestamp = parseProviderTimestamp(row.timestamp || row.agoText, now);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60_000) { droppedTimestampCount++; continue; }
    const message = [row.sender?.trim(), row.message.trim()].filter(Boolean).join(' ');
    messages.push({ ago: timestamp, agoText: row.agoText, message, url });
  }
  return { messages, rawRowCount: rows.length, parseDrops: rows.length - messages.length, droppedTimestampCount, droppedMessageCount };
};

/** Legacy helper preserved for callers that only need the parsed messages. */
export const convertMessages = (rows: RawMessage[], url: string): Message[] => parseMessageRows(rows, url).messages;

export const pollMessages = async (
  page: Page,
  options: OtpRouteHandlerOptions,
  read: () => Promise<Message[] | ParsedMessageRows>,
  origins: string[]
): Promise<Message[]> => {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15_000, 0), 60_000);
  if (!Number.isFinite(timeoutMs) || !Number.isFinite(options.interval ?? 5) || !Number.isInteger(options.page ?? 1) || (options.page ?? 1) < 1 || !Number.isInteger(options.limit ?? 100) || (options.limit ?? 100) < 1) throw new ProviderError('Invalid inbox polling options', 400);
  const deadline = Date.now() + timeoutMs;
  const patterns = Array.isArray(options.matcher) ? options.matcher : [options.matcher];
  let pollCount = 0;
  for (;;) {
    if (page.isClosed()) throw new ProviderError('Inbox request was closed', 503);
    const startedAt = Date.now();
    const batch = await read();
    const parsed = Array.isArray(batch) ? undefined : batch;
    const messages = parsed ? parsed.messages : batch as Message[];
    const withinTime = messages.filter((message) => message.ago >= (options.askedOtpAt ?? 0));
    const matches = withinTime.filter((message) => patterns.some((pattern) => message.message.includes(pattern)));
    const returned = matches.slice(0, options.limit ?? 100).map((message) => ({ ...message, otp: tryParseOtpCode(message.message) }));
    const timestamps = messages.map((message) => message.ago);
    if (parsed) options.onRead?.({
      providerUrl: page.url(), readAt: new Date().toISOString(), readDurationMs: Date.now() - startedAt,
      rawRowCount: parsed.rawRowCount, parseDrops: parsed.parseDrops,
      droppedTimestampCount: parsed.droppedTimestampCount, droppedMessageCount: parsed.droppedMessageCount,
      observedMessageCount: messages.length, matchedMessageCount: matches.length, returnedMessageCount: returned.length,
      timeFilteredCount: messages.length - withinTime.length, matcherFilteredCount: withinTime.length - matches.length,
      page: options.page ?? 1, pollCount: ++pollCount, emptyInbox: parsed.rawRowCount === 0,
      newestMessageAt: timestamps.length ? Math.max(...timestamps) : undefined,
      oldestMessageAt: timestamps.length ? Math.min(...timestamps) : undefined
    });
    if (parsed && parsed.rawRowCount > 0 && messages.length === 0) throw new ProviderError('Provider inbox rows were present but no message timestamps or content could be parsed', 502);
    if (matches.length) return returned;
    if (Date.now() >= deadline) return [];
    const waitMs = Math.min(Math.max((options.interval ?? 5) * 1000, 1000), deadline - Date.now());
    if (waitMs <= 0) return [];
    await delay(waitMs / 1000);
    await navigate(page, page.url(), origins);
  }
};

/** Inbox IDs on some sites are unrelated to the telephone number. Prefer the Redis URL. */
export const findPhoneUrl = async (
  page: Page,
  source: Source,
  country: Country,
  phone: string,
  list: (page: Page, country: Country, url?: string) => Promise<PhoneNumberListReply>,
  maxPages = 10
): Promise<string> => {
  const target = normalizePhoneNumber(phone, country);
  const cached = await getPhones(source, country);
  const found = cached.find((entry) => {
    try { return normalizePhoneNumber(entry.phone, country) === target; }
    catch { return false; }
  });
  if (found) return found.url;
  let url: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < maxPages; index++) {
    const result = await list(page, country, url);
    const entry = result.phones.find((item) => item.phone === target);
    if (entry) return entry.url;
    if (!result.nextPageUrl) break;
    if (seen.has(result.nextPageUrl)) throw new ProviderError('Provider repeated a pagination URL');
    seen.add(result.nextPageUrl);
    url = result.nextPageUrl;
  }
  throw new ProviderError('Phone number is no longer listed by this provider', 404);
};

export const inboxPage = (url: string, pageNumber = 1, format: 'html' | 'asms' | 'query' = 'query'): string => {
  if (pageNumber <= 1) return url;
  if (format === 'html') return new URL(`${pageNumber}.html`, url.endsWith('/') ? url : `${url}/`).href;
  if (format === 'asms') return `${url.replace(/\/+$/, '')}/page/${pageNumber}`;
  const parsed = new URL(url);
  parsed.searchParams.set('page', String(pageNumber));
  return parsed.href;
};
