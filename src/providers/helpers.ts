import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import type { PhoneNumber } from './types.js';

const regions: Record<string, CountryCode> = {
  USA: 'US', UK: 'GB', Canada: 'CA', Australia: 'AU', Austria: 'AT', Belgium: 'BE',
  BosniaAndHerzegovina: 'BA', Brazil: 'BR', Bulgaria: 'BG', China: 'CN', Croatia: 'HR',
  Cyprus: 'CY', CzechRepublic: 'CZ', Denmark: 'DK', Estonia: 'EE', Finland: 'FI',
  France: 'FR', Georgia: 'GE', Germany: 'DE', Greece: 'GR', HongKong: 'HK', Hungary: 'HU',
  India: 'IN', Indonesia: 'ID', Ireland: 'IE', Israel: 'IL', Italy: 'IT', IvoryCoast: 'CI',
  Japan: 'JP', Kazakhstan: 'KZ', Latvia: 'LV', Lithuania: 'LT', Mauritius: 'MU', Mexico: 'MX',
  Moldova: 'MD', Morocco: 'MA', Netherlands: 'NL', Nigeria: 'NG', Norway: 'NO', Pakistan: 'PK',
  Philippines: 'PH', Poland: 'PL', Portugal: 'PT', PuertoRico: 'PR', Romania: 'RO',
  Russia: 'RU', Terroruzzia: 'RU', Serbia: 'RS', Singapore: 'SG', Slovakia: 'SK', Slovenia: 'SI',
  SouthAfrica: 'ZA', SouthKorea: 'KR', Spain: 'ES', SriLanka: 'LK', Sweden: 'SE',
  Switzerland: 'CH', Taiwan: 'TW', Thailand: 'TH', Ukraine: 'UA'
};

/** Canonical wire format: E.164 digits, retaining the country calling code. */
export const normalizePhoneNumber = (input: string, country?: string): string => {
  const value = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) {
    throw new Error('Phone number must contain digits and optional phone formatting only');
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 17) {
    throw new Error('Phone number has an invalid length');
  }
  const region = country ? regions[country] : undefined;
  if (country && !region) throw new Error('Unsupported country');
  const explicitInternational = value.startsWith('+') || digits.startsWith('00');
  const internationalDigits = digits.startsWith('00') ? digits.slice(2) : digits;
  let parsed = parsePhoneNumberFromString('+' + internationalDigits);
  const expectedCallingCode = region ? getCountryCallingCode(region) : undefined;
  if (!explicitInternational && region && (!parsed?.isPossible() || parsed.countryCallingCode !== expectedCallingCode)) {
    parsed = parsePhoneNumberFromString(digits, region);
  }
  if (!parsed?.isPossible() || (expectedCallingCode && parsed.countryCallingCode !== expectedCallingCode)) {
    throw new Error('Phone number is invalid for the requested country');
  }
  return parsed.number.slice(1);
};

export const tryParseOtpCode = (line: string): string | undefined => {
  // Prefer the explicitly labelled code over dates, prices or unrelated short IDs.
  const labelled = line.match(/(?:\b(?:otp|pin|code|passcode|verification|security|authentication)\b|验证码|驗證碼)[^\d]{0,40}(\d{3}[ -]\d{3}|\d{4,8})(?!\d)/i)?.[1];
  if (labelled) return labelled.replace(/[ -]/g, '');
  return line.match(/(?:^|[^\d])(\d{4,8})(?!\d)/)?.[1];
};

export const filterUniquePhones = (phones: PhoneNumber[]): PhoneNumber[] => {
  const seen = new Set<string>();
  return phones.filter(({ phone }) => {
    const key = phone.replace(/\D/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
