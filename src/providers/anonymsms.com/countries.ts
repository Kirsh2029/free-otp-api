import { Country } from '../providers.js';

export enum Countries {
  USA = 'united-states',
  UK = 'united-kingdom',
  Georgia = 'georgia',
  //Ukraine = 'ukraine',
  Germany = 'germany',
  // Terroruzzia = 'russia',
  Netherlands = 'netherlands',
  Spain = 'spain'
}

// All eight listed USA links redirected to the country page on 2026-11-05.
// Keep the historical enum identifier, but stop advertising removed inboxes.
export const countries = Object.keys(Countries).filter((country) => country !== 'USA') as Country[];
