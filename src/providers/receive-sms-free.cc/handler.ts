import type { Page } from 'puppeteer';
import { countries, Countries } from './countries.js';
import type { OtpRouteHandlerOptions, PhoneNumberListReply } from '../types.js';
import type { Country } from '../providers.js';
import { normalizePhoneNumber } from '../helpers.js';
import { convertMessages, inboxPage, navigate, nextPage, normalizePhones, pollMessages, requirePhones } from '../runtime.js';

const baseUrl = 'https://receive-sms-free.cc';
const origins = [baseUrl];

export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `${baseUrl}/Free-${Countries[country as keyof typeof Countries]}-Phone-Number/` : '';

export const getReceiveSmsFreePhones = async (page: Page, country: Country, nextUrl?: string): Promise<PhoneNumberListReply> => {
  const countryUrl = getCountryUrl(country);
  if (!countryUrl) return { phones: [] };
  await navigate(page, nextUrl ?? countryUrl, origins);
  const prefix = new URL(countryUrl).pathname;
  await page.waitForSelector(`a[href^="${prefix}"]`, { timeout: 10_000 });
  const records = await page.$$eval(`a[href^="${prefix}"]`, (links) => links.flatMap((link) => {
    const url = (link as HTMLAnchorElement).href;
    const match = new URL(url).pathname.match(/\/(\d{7,15})\/?$/);
    return match ? [{ phone: `+${match[1]}`, url }] : [];
  }));
  return { phones: requirePhones(normalizePhones(records, country, origins)), nextPageUrl: await nextPage(page, origins) };
};

export const handleReceiveSmsFreeCC = async (page: Page, options: OtpRouteHandlerOptions) => {
  const phone = normalizePhoneNumber(options.phoneNumber, options.country);
  const url = inboxPage(`${getCountryUrl(options.country)}${encodeURIComponent(phone)}/`, options.page, 'html');
  await navigate(page, url, origins);
  await page.waitForSelector('.sms-item, .casetext', { timeout: 10_000 });
  return pollMessages(page, options, async () => {
    const rows = await page.$$eval('.sms-item, .casetext > .row', (items) => items.map((item) => ({
      agoText: item.querySelector('.time-text')?.textContent?.trim() ?? item.children[1]?.textContent?.trim() ?? '',
      message: item.querySelector('.sms-content')?.textContent?.trim() ?? item.children[2]?.textContent?.trim() ?? ''
    })));
    return convertMessages(rows, page.url());
  }, origins);
};
