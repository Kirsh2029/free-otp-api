import { setTimeout as wait } from 'node:timers/promises';
import { browser } from '../browser/cluster.js';
import { consola } from 'consola';
import type { Country, PhoneNumber, PhoneNumberListReply, Provider } from './index.js';
import { filterUniquePhones } from './helpers.js';
import { assertProviderUrl, ProviderError } from './runtime.js';
import { config } from '../config.js';

/** Bounded pagination and retries. A failed refresh never overwrites Redis with an empty success. */
export const getPhonesListTask = async (country: Country, provider: Provider): Promise<PhoneNumber[]> => {
  if (!provider.enabled) throw new ProviderError(`Provider ${provider.name} is disabled: ${provider.statusReason}`, 503);
  if (!provider.countries.includes(country)) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProviderError('Provider listing exceeded its overall time budget', 504)), config.browser.taskTimeoutMs);
  const phones: PhoneNumber[] = [];
  const seen = new Set<string>();
  let url: string | undefined;
  try {
    for (let index = 0; index < config.maxProviderPages; index++) {
      controller.signal.throwIfAborted();
      let result: PhoneNumberListReply | undefined;
      for (let attempt = 0; attempt <= config.providerRetries; attempt++) {
        controller.signal.throwIfAborted();
        try {
          result = await browser.execute({ country, url }, async ({ page, data }) => provider.getPhonesList(page, data.country, data.url), { signal: controller.signal });
          break;
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          const statusCode = (error as { statusCode?: number }).statusCode;
          if ((error instanceof Error && error.name === 'AbortError') || attempt >= config.providerRetries || [404, 499, 503, 504].includes(statusCode ?? 0)) throw error;
          consola.warn(`Provider ${provider.name} listing failed for ${country}; retry ${attempt + 1}/${config.providerRetries}`);
          await wait(Math.min(attempt + 1, 3) * 1000, undefined, { signal: controller.signal });
        }
      }
      controller.signal.throwIfAborted();
      if (!result) throw new ProviderError(`Provider ${provider.name} did not return a listing`);
      phones.push(...result.phones);
      if (!result.nextPageUrl) return filterUniquePhones(phones);
      // Pagination origins come from the registry, never from upstream content.
      assertProviderUrl(result.nextPageUrl, provider.allowedOrigins ?? [new URL(provider.baseUrl).origin]);
      if (seen.has(result.nextPageUrl)) throw new ProviderError(`Provider ${provider.name} repeated a pagination URL`);
      seen.add(result.nextPageUrl);
      url = result.nextPageUrl;
    }
    throw new ProviderError(`Provider ${provider.name} pagination exceeds MAX_PROVIDER_PAGES=${config.maxProviderPages}; increase the configured bound`);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
