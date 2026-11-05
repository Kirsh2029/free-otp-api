import type { Page } from 'puppeteer';
import { countries, Countries } from './countries.js';
import type { OtpRouteHandlerOptions, PhoneNumberListReply } from '../types.js';
import type { Country } from '../providers.js';
import { normalizePhoneNumber } from '../helpers.js';
import { convertMessages, navigate, nextPage, normalizePhones, pollMessages, ProviderError, requirePhones } from '../runtime.js';

const baseUrl = 'https://receiveasmsonline.com';
const origins = [baseUrl];
export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `${baseUrl}/${Countries[country as keyof typeof Countries]}/` : '';

export const getReceiveSmsOnlineComPhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  const countryUrl = getCountryUrl(country);
  if (!countryUrl) return { phones: [] };
  await navigate(page, nextUrl ?? countryUrl, origins);
  const prefix = new URL(countryUrl).pathname;
  await page.waitForSelector(`div[class*="Country__NumberGrid"] a[href^="${prefix}"]`, { timeout: 10_000 });
  const records = await page.$$eval(`div[class*="Country__NumberGrid"] a[href^="${prefix}"]`, (links) => links.flatMap((link) => {
    const url = (link as HTMLAnchorElement).href;
    const match = new URL(url).pathname.match(/\/(\d{7,15})\/?$/);
    return match ? [{ phone: `+${match[1]}`, url }] : [];
  }));
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleReceiveSmsOnlineCom = async (page: Page, options: OtpRouteHandlerOptions) => {
  if ((options.page ?? 1) > 1) throw new ProviderError('This provider exposes only the current inbox page', 400);
  const phone = normalizePhoneNumber(options.phoneNumber, options.country);
  await navigate(page, `${getCountryUrl(options.country)}${encodeURIComponent(phone)}/`, origins);
  // Messages hydrate after the public page loads. Loading skeletons are not an empty inbox.
  await page.waitForSelector('div[class*="Telephone__Message-"]', { timeout: 15_000 });
  return pollMessages(page, options, async () => {
    const rows = await page.$$eval('div[class*="Telephone__Message-"]', (items) => items.map((row) => ({
      message: row.children[0]?.children[0]?.textContent?.trim() ?? '',
      agoText: row.children[1]?.children[1]?.textContent?.trim() ?? ''
    })));
    return convertMessages(rows, page.url());
  }, origins);
};
