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

export interface RawMessage { agoText: string; message: string; timestamp?: string; }

export const convertMessages = (rows: RawMessage[], url: string): Message[] => rows.flatMap((row) => {
  const timestamp = row.timestamp ? Date.parse(row.timestamp) : parseTimeAgo(row.agoText);
  if (!row.message.trim() || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 60_000) return [];
  return [{ ago: timestamp, agoText: row.agoText, message: row.message.trim(), url }];
});

export const pollMessages = async (
  page: Page,
  options: OtpRouteHandlerOptions,
  read: () => Promise<Message[]>,
  origins: string[]
): Promise<Message[]> => {
  const deadline = Date.now() + Math.min(Math.max(options.timeoutMs ?? 15_000, 0), 60_000);
  const patterns = Array.isArray(options.matcher) ? options.matcher : [options.matcher];
  for (;;) {
    if (page.isClosed()) throw new ProviderError('Inbox request was closed', 503);
    const messages = await read();
    const matches = messages.filter((message) => message.ago >= (options.askedOtpAt ?? 0) &&
      patterns.some((pattern) => message.message.includes(pattern)));
    if (matches.length) return matches.slice(0, options.limit ?? 100).map((message) => ({ ...message, otp: tryParseOtpCode(message.message) }));
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
