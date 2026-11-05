import {  handleReceiveSmsFreeCC,
  getReceiveSmsFreePhones,
  getCountryUrl as getReceiveSmsFreeCountryUrl
} from './receive-sms-free.cc/handler.js';
import {
  handleAnonymSms,
  getAnonymSmsPhones,
  getCountryUrl as getAnonymSmsCountryUrl
} from './anonymsms.com/handler.js';
import { handleQuackrIo, getQuackrIoPhones, getCountryUrl as getQuackrIoCountryUrl } from './quackr.io/handler.js';
import { handleSmsToMe, getSmsToMeComPhones, getCountryUrl as getSmsToMeCountryUrl } from './smstome.com/handler.js';
import {
  handleReceiveSmsCo,
  getReceiveSmsCoPhones,
  getCountryUrl as getReceiveSmsCoCountryUrl
} from './receivesms.co/handler.js';
import {
  countries as receiveSmsFreeCountries,
  Countries as ReceiveSmsFreeCounties
} from './receive-sms-free.cc/countries.js';
import { countries as anonymSmsCountries, Countries as AnonymSmsCountries } from './anonymsms.com/countries.js';
import { countries as quackrIoCountries, Countries as QuackrIoCountries } from './quackr.io/countries.js';
import { countries as smsToMeComCountries, Countries as SmsToMeComCountries } from './smstome.com/countries.js';
import { countries as receiveSmsCoCountries, Countries as ReceiveSmsCoCountries } from './receivesms.co/countries.js';
import {
  handleReceiveSmsOnlineCom,
  getReceiveSmsOnlineComPhones,
  getCountryUrl as getReceiveSmsOnlineCountryUrl
} from './receiveasmsonline.com/handler.js';
import {
  countries as receiveSmsOnlineComCountries,
  Countries as ReceiveSmsOnlineComCountries
} from './receiveasmsonline.com/countries.js';
import { handleReceiveSmssOnlineCom, getReceiveSmssOnlineComPhones } from './receive-smss-online.com/handler.js';
import {
  countries as getReceiveSmssOnlineComCountries,
  Countries as GetReceiveSmssOnlineComCountries
} from './receive-smss-online.com/countries.js';
import { type Provider, Source } from './types.js';

export type Country =
  | keyof typeof ReceiveSmsFreeCounties
  | keyof typeof AnonymSmsCountries
  | keyof typeof QuackrIoCountries
  | keyof typeof SmsToMeComCountries
  | keyof typeof ReceiveSmsOnlineComCountries
  | keyof typeof ReceiveSmsCoCountries
  | keyof typeof GetReceiveSmssOnlineComCountries;

export const allowedCountries = Array.from(
  new Set([
    ...receiveSmsFreeCountries,
    ...anonymSmsCountries,
    ...quackrIoCountries,
    ...smsToMeComCountries,
    ...receiveSmsOnlineComCountries,
    ...receiveSmsCoCountries,
    ...getReceiveSmssOnlineComCountries
  ])
);

export const Sources: Record<Source, Provider> = {
  [Source.ReceiveSmsFree]: {
    enabled: true,
    status: 'unverified',
    statusReason: 'Public HTTP listing and inbox HTML are accessible, but standard headless Chrome received HTTP 403 during the audit; no bypass attempted.',
    name: Source.ReceiveSmsFree,
    baseUrl: 'https://receive-sms-free.cc',
    getPhonesList: getReceiveSmsFreePhones,
    handleOtp: handleReceiveSmsFreeCC,
    countries: receiveSmsFreeCountries,
    getCountryUrl: getReceiveSmsFreeCountryUrl,
    refreshCacheExpression: '5 */8 * * *'
  },
  [Source.AnonymSms]: {
    enabled: true,
    status: 'verified',
    statusReason: 'Rebranded to asms.ai; UK listing, inbox, timestamps, OTP extraction and inbox pagination passed live browser tests. Some stale US links redirect back to the country listing.',
    verifiedAt: '2026-11-05',
    name: Source.AnonymSms,
    baseUrl: 'https://asms.ai',
    allowedOrigins: ['https://asms.ai', 'https://anonymsms.com'],
    getPhonesList: getAnonymSmsPhones,
    handleOtp: handleAnonymSms,
    countries: anonymSmsCountries,
    getCountryUrl: getAnonymSmsCountryUrl,
    refreshCacheExpression: '15 */8 * * *'
  },
  [Source.QuackrIo]: {
    enabled: false,
    status: 'disabled',
    statusReason: 'Provider terms explicitly prohibit scraping: https://quackr.io/terms',
    name: Source.QuackrIo,
    baseUrl: 'https://quackr.io',
    getPhonesList: getQuackrIoPhones,
    handleOtp: handleQuackrIo,
    countries: quackrIoCountries,
    getCountryUrl: getQuackrIoCountryUrl,
    refreshCacheExpression: '25 */8 * * *'
  },
  [Source.SmsToMeCom]: {
    enabled: true,
    status: 'unverified',
    statusReason: 'Slovenia public HTTP listing, pagination and inbox HTML are accessible; standard headless Chrome received HTTP 403. Sweden listing was removed (404).',
    name: Source.SmsToMeCom,
    baseUrl: 'https://smstome.com',
    getPhonesList: getSmsToMeComPhones,
    handleOtp: handleSmsToMe,
    countries: smsToMeComCountries,
    getCountryUrl: getSmsToMeCountryUrl,
    refreshCacheExpression: '30 */8 * * *'
  },
  [Source.ReceiveSmsCo]: {
    enabled: true,
    status: 'verified',
    statusReason: 'USA complete listing (94 unique numbers), listing pagination, inbox, timestamps, OTP extraction and inbox pagination passed live browser tests.',
    verifiedAt: '2026-11-05',
    name: Source.ReceiveSmsCo,
    baseUrl: 'https://www.receivesms.co',
    allowedOrigins: ['https://www.receivesms.co', 'https://receivesms.co'],
    getPhonesList: getReceiveSmsCoPhones,
    handleOtp: handleReceiveSmsCo,
    countries: receiveSmsCoCountries,
    getCountryUrl: getReceiveSmsCoCountryUrl,
    refreshCacheExpression: '35 */8 * * *'
  },
  [Source.ReceiveSmsOnlineCom]: {
    enabled: true,
    status: 'verified',
    statusReason: 'Actual host receiveasmsonline.com: UK listing and hydrated inbox, timestamps and OTP extraction passed live browser tests. Legacy source identifier retained.',
    verifiedAt: '2026-11-05',
    name: Source.ReceiveSmsOnlineCom,
    baseUrl: 'https://receiveasmsonline.com',
    getPhonesList: getReceiveSmsOnlineComPhones,
    handleOtp: handleReceiveSmsOnlineCom,
    countries: receiveSmsOnlineComCountries,
    getCountryUrl: getReceiveSmsOnlineCountryUrl,
    refreshCacheExpression: '40 */8 * * *'
  },
  [Source.ReceiveSmssOnlineCom]: {
    enabled: true,
    status: 'unverified',
    statusReason: 'Current public page reports zero phone numbers; no listed inbox was available for a live test. Calls surface provider unavailability explicitly.',
    name: Source.ReceiveSmssOnlineCom,
    baseUrl: 'https://www.receive-smss-online.com',
    allowedOrigins: ['https://www.receive-smss-online.com', 'https://receive-smss-online.com'],
    getPhonesList: getReceiveSmssOnlineComPhones,
    handleOtp: handleReceiveSmssOnlineCom,
    countries: getReceiveSmssOnlineComCountries,
    getCountryUrl: () => 'https://www.receive-smss-online.com/',
    refreshCacheExpression: '42 */8 * * *'
  }
};

export const providers = (Object.keys(Sources) as Source[]).map((source) => Sources[source]).filter((provider) => provider.enabled);
