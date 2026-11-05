import type { Page } from 'puppeteer';
import { Countries, countries } from './countries.js';
import { Source, type OtpRouteHandlerOptions, type PhoneNumberListReply } from '../types.js';
import type { Country } from '../providers.js';
import { config } from '../../config.js';
import { convertMessages, findPhoneUrl, navigate, nextPage, normalizePhones, pollMessages, ProviderError, requirePhones } from '../runtime.js';

const baseUrl = 'https://www.receive-smss-online.com';
const origins = [baseUrl, 'https://receive-smss-online.com'];
export const getCountryUrl = (_country: Country) => `${baseUrl}/`;

export const getReceiveSmssOnlineComPhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  if (!countries.includes(country)) return { phones: [] };
  await navigate(page, nextUrl ?? `${baseUrl}/`, origins);
  await page.waitForSelector('h2', { timeout: 10_000 });
  const label = Countries[country as keyof typeof Countries];
  const records = await page.$$eval('a[href]', (links, countryLabel) => links.flatMap((link) => {
    const card = link.closest('div.rounded-lg, div.rounded-xl, article') ?? link.parentElement;
    if (!card?.textContent?.includes(countryLabel)) return [];
    const numberText = card.querySelector('.font-medium.text-sm')?.textContent ?? link.textContent ?? '';
    const phone = numberText.match(/\+\d[\d ()-]{6,18}/)?.[0];
    return phone ? [{ phone, url: (link as HTMLAnchorElement).href }] : [];
  }), label);
  // The live public page currently states zero numbers; surface unavailability explicitly.
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleReceiveSmssOnlineCom = async (page: Page, options: OtpRouteHandlerOptions) => {
  if ((options.page ?? 1) > 1) throw new ProviderError('Inbox pagination is unverified for this provider', 400);
  const url = await findPhoneUrl(page, Source.ReceiveSmssOnlineCom, options.country, options.phoneNumber, getReceiveSmssOnlineComPhones, config.maxProviderPages);
  await navigate(page, url, origins);
  await page.waitForSelector('table', { timeout: 10_000 });
  return pollMessages(page, options, async () => {
    const rows = await page.$$eval('tr', (items) => items.flatMap((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      return cells.length >= 3 ? [{ message: cells[1].textContent?.trim() ?? '', agoText: cells[2].textContent?.trim() ?? '' }] : [];
    }));
    return convertMessages(rows, page.url());
  }, origins);
};
