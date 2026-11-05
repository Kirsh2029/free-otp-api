import type { Page } from 'puppeteer';
import { Countries, countries } from './countries.js';
import type { Country } from '../providers.js';
import { Source, type OtpRouteHandlerOptions, type PhoneNumberListReply } from '../types.js';
import { config } from '../../config.js';
import { convertMessages, findPhoneUrl, navigate, nextPage, normalizePhones, pollMessages, ProviderError, requirePhones } from '../runtime.js';

const baseUrl = 'https://www.receivesms.co';
const origins = [baseUrl, 'https://receivesms.co'];
export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `${baseUrl}/${Countries[country as keyof typeof Countries].replace(/\/+$/, '')}/` : '';

export const getReceiveSmsCoPhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  const url = nextUrl ?? getCountryUrl(country);
  if (!url) return { phones: [] };
  await navigate(page, url, origins);
  await page.waitForSelector('main .grid', { timeout: 10_000 });
  // This provider renders Next even beyond the final page. Only its explicit empty
  // inventory marker terminates pagination; missing/changed markup still fails.
  const empty = await page.$eval('main .grid', (grid) => /^\s*No numbers available\.\s*$/.test(grid.textContent ?? ''));
  if (empty) {
    if (nextUrl) return { phones: [] };
    throw new ProviderError('Provider has no public numbers for this country', 503);
  }
  const records = await page.$$eval('a[href*="phone-number/"]', (links) => links.flatMap((link) => {
    const url = (link as HTMLAnchorElement).href;
    if (!/^\/[^/]*phone-number\/\d+\/?$/.test(new URL(url).pathname)) return [];
    const label = link.querySelector('.row')?.textContent ?? link.querySelector('.number')?.textContent ?? '';
    return [{ phone: label.trim(), url }];
  }));
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleReceiveSmsCo = async (page: Page, options: OtpRouteHandlerOptions) => {
  let url = await findPhoneUrl(page, Source.ReceiveSmsCo, options.country, options.phoneNumber, getReceiveSmsCoPhones, config.maxProviderPages);
  if ((options.page ?? 1) > 1) url = `${url.replace(/\/+$/, '')}/${options.page}/`;
  await navigate(page, url, origins);
  await page.waitForSelector('section.entry-list', { timeout: 10_000 });
  return pollMessages(page, options, async () => {
    const rows = await page.$$eval('article.entry-card', (items) => items.map((item) => ({
      agoText: item.querySelector('.entry-right .muted')?.textContent?.trim() ?? '',
      message: item.querySelector('.sms')?.textContent?.trim() ?? ''
    })));
    return convertMessages(rows, page.url());
  }, origins);
};
