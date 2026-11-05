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
import { type Provider, type ProviderVerification, Source } from './types.js';

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
    statusReason: 'Rebranded to asms.ai; UK listing, inbox, timestamps, OTP extraction and inbox pagination passed live browser tests. All eight tested US inbox links redirected away, so USA is excluded.',
    verifiedAt: '2026-11-05',
    name: Source.AnonymSms,
    unavailableCountries: { USA: 'All eight listed US inbox links redirected to the country listing during the 2026-11-05 live check; no readable inbox remained.' },
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
    statusReason: 'USA and UK complete listings, listing pagination, inbox reads, timestamps, OTP extraction and inbox pagination passed live browser tests; dated counts are reported under verification.',
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

// Legacy `status: verified` means listing/inbox compatibility, never carrier delivery.
const auditVerification: Record<Source, ProviderVerification> = {
  "receive-sms-free.cc": {
    "listing": {
      "status": "blocked",
      "checkedAt": "2026-11-05T20:20:49.955Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Standard browser access returned HTTP 403; no bypass attempted."
    },
    "inboxRead": {
      "status": "unverified",
      "checkedAt": "2026-11-05T20:20:49.955Z",
      "countries": [],
      "detail": "No inbox was re-tested because public listing access was blocked or no number was available."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "anonymsms.com": {
    "listing": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:29:31.013Z",
      "countries": [
        "UK"
      ],
      "detail": "Representative complete public collections: UK 8 numbers. Listing availability does not demonstrate SMS delivery. USA excluded: all eight advertised inbox links redirected to the country page."
    },
    "inboxRead": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:20:53.174Z",
      "countries": [
        "UK"
      ],
      "detail": "Existing public inbox reads: UK 10 parsed messages. These are historical messages, not controlled fresh delivery evidence."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "quackr.io": {
    "listing": {
      "status": "not_applicable",
      "checkedAt": "2026-11-05",
      "countries": [],
      "detail": "Not exercised: provider terms prohibit scraping."
    },
    "inboxRead": {
      "status": "not_applicable",
      "checkedAt": "2026-11-05",
      "countries": [],
      "detail": "Not exercised: provider terms prohibit scraping."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "smstome.com": {
    "listing": {
      "status": "blocked",
      "checkedAt": "2026-11-05T20:20:53.179Z",
      "countries": [
        "Slovenia"
      ],
      "detail": "Standard browser access returned HTTP 403; no bypass attempted."
    },
    "inboxRead": {
      "status": "unverified",
      "checkedAt": "2026-11-05T20:20:53.179Z",
      "countries": [],
      "detail": "No inbox was re-tested because public listing access was blocked or no number was available."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "receivesms.co": {
    "listing": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:29:43.146Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Representative complete public collections: USA 93 numbers, UK 10 numbers. Listing availability does not demonstrate SMS delivery."
    },
    "inboxRead": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:20:55.474Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Existing public inbox reads: USA 40 parsed messages, UK 40 parsed messages. These are historical messages, not controlled fresh delivery evidence."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "receivesmsonline.com": {
    "listing": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:29:45.934Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Representative complete public collections: USA 181 numbers, UK 171 numbers. Listing availability does not demonstrate SMS delivery."
    },
    "inboxRead": {
      "status": "verified",
      "checkedAt": "2026-11-05T20:28:01.257Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Existing public inbox reads: USA 14 parsed messages, UK 47 parsed messages. These are historical messages, not controlled fresh delivery evidence."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  },
  "receive-smss-online.com": {
    "listing": {
      "status": "failed",
      "checkedAt": "2026-11-05T20:21:05.559Z",
      "countries": [
        "USA",
        "UK"
      ],
      "detail": "Current public country pages exposed no phone inventory."
    },
    "inboxRead": {
      "status": "unverified",
      "checkedAt": "2026-11-05T20:21:05.559Z",
      "countries": [],
      "detail": "No inbox was re-tested because public listing access was blocked or no number was available."
    },
    "freshSmsDelivery": {
      "status": "unverified",
      "detail": "No controlled newly sent SMS has been observed by this audit. Verify the exact number and source using a new unique marker; existing inbox reads are not delivery evidence."
    }
  }
};

for (const provider of Object.values(Sources)) {
  provider.verification = auditVerification[provider.name as Source];
  if (provider.status === 'verified') provider.statusReason = `Public listing and existing-message reads only; fresh SMS delivery remains unverified. ${provider.statusReason}`;
}
