import { Country } from '../providers.js';

export enum Countries {
  Slovenia = 'slovenia',
  Sweden = 'sweden',
  Finland = 'finland',
  Belgium = 'belgium',
  Netherlands = 'netherlands'
  // USA = 'usa',
  // Canada = 'canada',
  //UK = 'united-kingdom',
  //France = 'france',
  //Denmark = 'denmark',
}

// The provider removed its Sweden listing (HTTP 404, checked 2026-11-05).
// Keep the enum value so historical country identifiers remain type-compatible.
export const countries = Object.keys(Countries).filter((country) => country !== 'Sweden') as Country[];
