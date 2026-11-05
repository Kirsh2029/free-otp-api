export interface MessageQuery {
  since?: number;
  ago?: string;
  match?: string;
}
const segment = (value: string) => encodeURIComponent(value);

export const endpoints = {
  countriesList: '/countries',
  countryPhones: (country: string) => `/list/${segment(country)}`,
  phoneMessages: (country: string, phone: string, source: string, page = 1, filters: MessageQuery = { since: 1 }) => {
    const query = new URLSearchParams({ source, page: String(page) });
    if (filters.since !== undefined) query.set('since', String(filters.since));
    else if (filters.ago) query.set('ago', filters.ago);
    else query.set('since', '1');
    if (filters.match) query.set('match', filters.match);
    return `/${segment(country)}/${segment(phone)}?${query}`;
  }
};
