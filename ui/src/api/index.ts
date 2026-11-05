import { resolveApiConfig } from './config';

export const { baseUrl, root, swaggerUrl } = resolveApiConfig(import.meta.env);
const segment = (value: string) => encodeURIComponent(value);

export const endpoints = {
  countriesList: '/countries',
  countryPhones: (country: string) => `/list/${segment(country)}`,
  phoneMessages: (country: string, phone: string, source: string, page = 1) =>
    `/${segment(country)}/${segment(phone)}?${new URLSearchParams({ since: '1', source, page: String(page) })}`
};
