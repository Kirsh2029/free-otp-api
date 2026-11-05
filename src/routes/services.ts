import { browser } from '../browser/cluster.js';
import { getPhones, savePhones } from '../repository/redis.js';
import { normalizePhoneNumber } from '../providers/helpers.js';
import { getPhonesListTask } from '../providers/getPhonesListTask.js';
import { providers, Sources, type Country, type Message, type MessageReadDiagnostics, type OtpRouteHandlerOptions, type PhoneNumber, type Provider } from '../providers/index.js';

export interface ApiServices {
  providers: Provider[];
  allProviders: Provider[];
  getPhones: (source: string, country: string) => Promise<PhoneNumber[]>;
  savePhones: (source: string, country: string, phones: PhoneNumber[]) => Promise<unknown>;
  getPhonesList: (country: Country, provider: Provider) => Promise<PhoneNumber[]>;
  getMessages: (provider: Provider, options: OtpRouteHandlerOptions) => Promise<Message | Message[] | undefined>;
  normalizePhone: (phone: string, country: Country) => string;
}

export const defaultServices: ApiServices = {
  providers,
  allProviders: Object.values(Sources),
  getPhones,
  savePhones,
  getPhonesList: getPhonesListTask,
  normalizePhone: normalizePhoneNumber,
  getMessages: async (provider, options) => browser.execute(options, async ({ page, data }) => {
    browser.registerPageHandlers(page);
    return provider.handleOtp(page, data);
  })
};

export const normalizeInboxRead = (found: Message | Message[] | undefined): Message[] =>
  Array.isArray(found) ? found : found ? [found] : [];

export const readProviderInbox = async (
  services: Pick<ApiServices, 'getMessages'>,
  provider: Provider,
  options: OtpRouteHandlerOptions
): Promise<{ messages: Message[]; diagnostics?: MessageReadDiagnostics }> => {
  let diagnostics: MessageReadDiagnostics | undefined;
  const found = await services.getMessages(provider, {
    ...options,
    onRead: (snapshot) => {
      diagnostics = { ...snapshot };
      options.onRead?.(snapshot);
    }
  });
  return { messages: normalizeInboxRead(found), ...(diagnostics ? { diagnostics } : {}) };
};

declare module 'fastify' {
  interface FastifyInstance {
    numberApiServices: ApiServices;
  }
}

export const errorStatus = (error: unknown, fallback = 502): number => {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
    const status = error.statusCode;
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || ('code' in error && error.code === 'ETIMEDOUT'))) return 504;
  return fallback;
};

export const isProviderAvailable = (provider: Provider): boolean => provider.enabled && provider.status !== 'disabled';

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;
