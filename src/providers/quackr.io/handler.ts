import type { Page } from 'puppeteer';
import type { Country } from '../providers.js';
import type { OtpRouteHandlerOptions, PhoneNumberListReply } from '../types.js';
import { Countries, countries } from './countries.js';
import { ProviderError } from '../runtime.js';

export const getCountryUrl = (country: Country): string => countries.includes(country)
  ? `https://quackr.io/temporary-numbers/${Countries[country as keyof typeof Countries]}` : '';
const disabled = (): never => { throw new ProviderError('Quackr scraping is disabled: provider terms prohibit scraping (https://quackr.io/terms)', 503); };
export const getQuackrIoPhones = async (_page: Page, _country: Country): Promise<PhoneNumberListReply> => disabled();
export const handleQuackrIo = async (_page: Page, _options: OtpRouteHandlerOptions) => disabled();
