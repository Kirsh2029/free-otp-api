import type { Page } from 'puppeteer';
import { Countries, countries } from './countries.js';
import type { Country } from '../providers.js';
import type { OtpRouteHandlerOptions, PhoneNumberListReply } from '../types.js';
import { normalizePhoneNumber } from '../helpers.js';
import { waitForInboxReady, parseMessageRows, inboxPage, navigate, nextPage, normalizePhones, pollMessages, ProviderError, requirePhones } from '../runtime.js';

// AnonymSMS rebranded in 2026. The original source identifier remains stable.
const baseUrl = 'https://asms.ai';
const origins = [baseUrl, 'https://anonymsms.com'];
export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `${baseUrl}/${Countries[country as keyof typeof Countries]}` : '';

export const getAnonymSmsPhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  const url = nextUrl ?? getCountryUrl(country);
  if (!url) return { phones: [] };
  await navigate(page, url, origins);
  await page.waitForSelector('a[href^="/number/"]', { timeout: 10_000 });
  const records = await page.$$eval('a[href^="/number/"]', (links) => links.flatMap((link) => {
    const url = (link as HTMLAnchorElement).href;
    const match = new URL(url).pathname.match(/^\/number\/(\d{7,15})\/?$/);
    return match ? [{ phone: `+${match[1]}`, url }] : [];
  }));
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleAnonymSms = async (page: Page, options: OtpRouteHandlerOptions) => {
  const phone = normalizePhoneNumber(options.phoneNumber, options.country);
  await navigate(page, inboxPage(`${baseUrl}/number/${encodeURIComponent(phone)}`, options.page, 'asms'), origins);
  if (!new URL(page.url()).pathname.startsWith(`/number/${phone}`)) throw new ProviderError('Provider has removed this public inbox', 404);
  return pollMessages(page, options, async () => {
    await waitForInboxReady(page, 'main time[datetime]', 'main p');
    const rows = await page.$$eval('time[datetime]', (times) => times.map((time) => {
      const card = time.parentElement?.parentElement;
      return {
        agoText: time.textContent?.trim() ?? '',
        timestamp: time.getAttribute('datetime') ?? '',
        message: card?.querySelector('p')?.textContent?.trim() ?? ''
      };
    }));
    return parseMessageRows(rows, page.url());
  }, origins);
};
