import type { Page } from 'puppeteer';
import { Countries, countries } from './countries.js';
import type { Country } from '../providers.js';
import { Source, type OtpRouteHandlerOptions, type PhoneNumberListReply } from '../types.js';
import { config } from '../../config.js';
import { waitForInboxReady, parseMessageRows, findPhoneUrl, inboxPage, navigate, nextPage, normalizePhones, pollMessages, requirePhones } from '../runtime.js';

const baseUrl = 'https://smstome.com';
const origins = [baseUrl];
export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `${baseUrl}/country/${Countries[country as keyof typeof Countries]}` : '';

export const getSmsToMeComPhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  const url = nextUrl ?? getCountryUrl(country);
  if (!url) return { phones: [] };
  await navigate(page, url, origins);
  await page.waitForSelector('a[href*="/phone/"]', { timeout: 10_000 });
  const records = await page.$$eval('a[href*="/phone/"]', (links) => links.flatMap((link) => {
    const url = (link as HTMLAnchorElement).href;
    const match = new URL(url).pathname.match(/\/phone\/(\d{7,15})\/sms\/\d+/);
    return match ? [{ phone: `+${match[1]}`, url }] : [];
  }));
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleSmsToMe = async (page: Page, options: OtpRouteHandlerOptions) => {
  const url = await findPhoneUrl(page, Source.SmsToMeCom, options.country, options.phoneNumber, getSmsToMeComPhones, config.maxProviderPages);
  await navigate(page, inboxPage(url, options.page), origins);
  return pollMessages(page, options, async () => {
    await waitForInboxReady(page, 'table.mp-table .mp-cell-msg, table.messagesTable tr td:nth-child(3)', 'table.mp-table td, table.messagesTable td');
    const rows = await page.$$eval('table.mp-table tbody tr, table.messagesTable tr', (items) => items.flatMap((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) return [];
      return [{ agoText: cells[1].textContent?.trim() ?? '', message: cells[2].textContent?.trim() ?? '' }];
    }));
    return parseMessageRows(rows, page.url());
  }, origins);
};
