import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { config, type AppConfig } from '../config.js';
import type { Country } from '../providers/index.js';
import { assertProviderUrl } from '../providers/runtime.js';
import { errorStatus, isProviderAvailable, readProviderInbox, type ApiServices } from '../routes/services.js';
import { DeliveryTestError, type DeliveryProbe, type ProbeStore } from './types.js';

interface DeliveryDependencies {
  services: ApiServices;
  store: ProbeStore;
  settings?: AppConfig;
  now?: () => number;
}

export const createDeliveryService = ({ services, store, settings = config, now = Date.now }: DeliveryDependencies) => {
  const providerFor = (source: string, country: Country) => {
    const provider = services.providers.find((entry) => entry.name === source && entry.countries.includes(country) && isProviderAvailable(entry));
    if (!provider) throw new DeliveryTestError('Provider is unavailable for the selected country', 503);
    return provider;
  };
  return {
    create: async (input: { source: string; country: Country; phoneNumber: string }): Promise<DeliveryProbe> => {
      const provider = providerFor(input.source, input.country);
      let phoneNumber: string;
      try { phoneNumber = services.normalizePhone(input.phoneNumber, input.country); }
      catch { throw new DeliveryTestError('Invalid phone number for the selected country', 400); }
      if (!await store.reserveCreation(now(), settings.deliveryTestMaxPerMinute)) {
        throw new DeliveryTestError('Delivery test creation limit reached; retry in the next minute', 429);
      }
      // Letters-only nonce avoids accidental OTP extraction from identifier digits.
      const marker = 'NUMBERTEST-' + [...randomBytes(24)].map((value) => String.fromCharCode(65 + value % 26)).join('');
      const expectedOtp = String(randomInt(100000, 1000000));
      let baseline;
      try {
        baseline = await readProviderInbox(services, provider, {
          country: input.country, phoneNumber: `+${phoneNumber}`, askedOtpAt: 0, matcher: '', page: 1, limit: 1000, timeoutMs: 0
        });
      } catch (error) {
        throw new DeliveryTestError('The provider inbox could not be read; no delivery test was started', errorStatus(error));
      }
      if (baseline.messages.some((message) => message.message.includes(marker))) {
        throw new DeliveryTestError('Test marker already exists in the baseline; create another test', 502);
      }
      const createdAt = now();
      const probe: DeliveryProbe = {
        id: randomUUID(), status: 'pending', country: input.country, phoneNumber, source: provider.name,
        marker, expectedOtp, messageText: `${marker} code ${expectedOtp}`,
        createdAt, checkedAt: createdAt, expiresAt: createdAt + settings.deliveryTestTtlSeconds * 1000,
        baselineRead: baseline.diagnostics
      };
      await store.create(probe);
      return probe;
    },
    check: async (id: string): Promise<DeliveryProbe> => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
        throw new DeliveryTestError('Invalid delivery test identifier', 400);
      }
      const probe = await store.get(id);
      if (!probe) throw new DeliveryTestError('Delivery test was not found or its retention period ended', 404);
      if (probe.status !== 'pending') return probe;
      if (now() >= probe.expiresAt) return store.update({ ...probe, status: 'expired', checkedAt: now() });
      const token = randomUUID();
      if (!await store.beginCheck(id, token, now(), settings.browser.taskTimeoutMs + 2000)) {
        const latest = await store.get(id);
        if (!latest) throw new DeliveryTestError('Delivery test no longer exists', 404);
        if (latest.status !== 'pending') return latest;
        return { ...latest, checkDeferred: true, nextCheckAt: Math.max(now() + 1000, (latest.checkedAt || latest.createdAt) + 3000) };
      }
      try {
        const provider = providerFor(probe.source, probe.country);
        let read;
        try {
          read = await readProviderInbox(services, provider, {
            country: probe.country, phoneNumber: `+${probe.phoneNumber}`, askedOtpAt: 0, matcher: '', page: 1, limit: 1000, timeoutMs: 0
          });
        } catch (error) {
          const status = errorStatus(error);
          const saved = await store.update({ ...probe, checkedAt: now(), lastError: { at: now(), statusCode: status, message: 'Provider inbox read failed' } });
          throw new DeliveryTestError('The provider inbox could not be read; delivery remains unverified', status, saved);
        }
        const checkedAt = now();
        if (checkedAt >= probe.expiresAt) return await store.update({ ...probe, status: 'expired', checkedAt, currentRead: read.diagnostics });
        const code = new RegExp(`(?:^|\\D)${probe.expectedOtp}(?!\\d)`);
        const found = read.messages.find((message) => typeof message.message === 'string' &&
          message.message.includes(probe.marker) && code.test(message.message) &&
          Number.isFinite(message.ago) && message.ago >= probe.createdAt - 120_000 && message.ago <= checkedAt + 60_000);
        if (found) {
          try { assertProviderUrl(found.url, provider.allowedOrigins || [new URL(provider.baseUrl).origin]); }
          catch {
            const saved = await store.update({ ...probe, checkedAt, lastError: { at: checkedAt, statusCode: 502, message: 'Provider returned an unexpected inbox URL' } });
            throw new DeliveryTestError('Provider returned an unexpected inbox URL; delivery remains unverified', 502, saved);
          }
        }
        return await store.update({
          ...probe, checkedAt, currentRead: read.diagnostics, lastError: undefined,
          ...(found ? {
            status: 'received' as const, receivedAt: checkedAt,
            evidence: { providerUrl: found.url, messageTimestamp: found.ago, otpMatched: found.otp === probe.expectedOtp, messageLength: found.message.length }
          } : {})
        });
      } finally {
        await store.endCheck(id, token);
      }
    }
  };
};
