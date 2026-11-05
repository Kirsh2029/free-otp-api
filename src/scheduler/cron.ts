import { Cron } from 'croner';
import { consola } from 'consola';
import { type Country, type Provider, providers } from '../providers/index.js';
import { getPhonesListTask } from '../providers/getPhonesListTask.js';
import { savePhones } from '../repository/redis.js';
import { filterUniquePhones } from '../providers/helpers.js';
import { browser } from '../browser/cluster.js';

const running = new Set<Promise<void>>();
let stopping = false;

export const lookupPhoneNumbers = async (provider: Provider): Promise<void> => {
  for (const country of provider.countries) {
    if (stopping) break;
    try {
      const phones = await getPhonesListTask(country as Country, provider);
      await savePhones(provider.name, country, filterUniquePhones(phones));
      consola.info('[cache-job] refreshed ' + provider.name + '/' + country + ': ' + phones.length + ' numbers');
    } catch {
      consola.warn('[cache-job] refresh failed for ' + provider.name + '/' + country + '; existing cache retained');
    }
  }
};

export const createJob = (provider: Provider, scheduleExpression: string): Cron =>
  new Cron(scheduleExpression, { catch: true, unref: true, paused: true, protect: true }, () => {
    if (stopping) return;
    const refresh = lookupPhoneNumbers(provider);
    running.add(refresh);
    return refresh.finally(() => { running.delete(refresh); });
  });

export const jobs: Record<string, Cron> = Object.fromEntries(providers.map((provider) => [
  provider.name, createJob(provider, provider.refreshCacheExpression ?? '30 */8 * * *')
]));

export const startJobs = (): void => {
  stopping = false;
  Object.values(jobs).forEach((job) => job.resume());
};

export const stopJobs = async (): Promise<void> => {
  stopping = true;
  Object.values(jobs).forEach((job) => job.pause());
  browser.abortTasks();
  await Promise.allSettled([...running]);
};
