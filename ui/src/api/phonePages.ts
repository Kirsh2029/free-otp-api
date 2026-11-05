import type { PhonesResponse } from '../types';

/** Load the API's pages before source grouping/search; never silently truncate a listing. */
export async function loadPhonePages(fetchPage: (page: number, limit: number) => Promise<PhonesResponse>, maximumPages = 100): Promise<PhonesResponse> {
  const phones = new Map<string, PhonesResponse['phones'][number]>();
  const errors = new Map<string, { source: string; error: string }>();
  const warn = (error: string) => errors.set(error, { source: 'API pagination', error });
  for (let page = 1; page <= maximumPages; page += 1) {
    let result: PhonesResponse;
    try {
      result = await fetchPage(page, 1000);
    } catch (error) {
      if (!phones.size) throw error;
      warn(`The listing is incomplete: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    for (const failure of result.errors ?? []) errors.set(`${failure.source}:${failure.error}`, failure);
    const previousCount = phones.size;
    for (const phone of result.phones) phones.set(`${phone.source}:${phone.value}`, phone);
    if (!result.pagination?.hasMore) break;
    if (result.pagination.page !== page || previousCount === phones.size) {
      warn('The listing is incomplete because API pagination stopped advancing. Refresh to retry.');
      break;
    }
    if (page === maximumPages) warn(`The listing is incomplete after ${maximumPages} API pages. Filter using the API for additional results.`);
  }
  return { phones: [...phones.values()], ...(errors.size ? { errors: [...errors.values()] } : {}) };
}
