import { createClient } from 'redis';
import { consola } from 'consola';
import { config, type AppConfig } from '../config.js';
import type { PhoneNumber } from '../providers/types.js';

export const createRedisRepository = (
  settings: AppConfig['redis'] = config.redis,
  ttlSeconds = config.cacheTtlSeconds
) => {
  const client = createClient({
    ...(settings.url ? { url: settings.url } : {}),
    ...(!settings.url && settings.password ? { password: settings.password } : {}),
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    commandOptions: { timeout: settings.commandTimeoutMs },
    socket: {
      ...(!settings.url ? { host: settings.host, port: settings.port } : {}),
      connectTimeout: settings.connectTimeoutMs,
      reconnectStrategy: (retries) => retries >= settings.reconnectAttempts
        ? new Error('Redis reconnect limit reached')
        : Math.min(100 * 2 ** retries, 2000)
    }
  });
  client.on('error', () => consola.warn('Redis connection error; readiness is unavailable'));
  let connecting: Promise<void> | undefined;
  let abortConnection: (() => void) | undefined;
  let closing = false;
  client.on('connect', () => { if (closing || !client.isOpen) client.destroy(); });

  const connect = async (): Promise<void> => {
    if (closing) throw new Error('Redis connection is closing');
    if (client.isReady) return;
    if (!connecting) {
      connecting = (async () => {
        // TCP connection timeout alone does not cover Redis's protocol handshake.
        // An accepted but silent socket must not hold API startup indefinitely.
        const cancelled = new Promise<never>((_resolve, reject) => {
          abortConnection = () => {
            reject(new Error('Redis connection was interrupted'));
            client.destroy();
          };
        });
        const timer = setTimeout(() => abortConnection?.(), settings.connectTimeoutMs);
        timer.unref();
        try {
          await Promise.race([client.connect().then(() => client.ping()), cancelled]);
        } catch {
          client.destroy();
          throw new Error('Redis connection failed; verify Redis settings and availability');
        } finally {
          clearTimeout(timer);
          abortConnection = undefined;
        }
      })().finally(() => { connecting = undefined; });
    }
    await connecting;
  };

  const close = async (): Promise<void> => {
    closing = true;
    abortConnection?.();
    if (connecting) await connecting.catch(() => undefined);
    if (!client.isOpen) { client.destroy(); return; }
    const timer = setTimeout(() => client.destroy(), 3000);
    timer.unref();
    try { await client.close(); } catch { client.destroy(); }
    finally { clearTimeout(timer); }
  };

  const command = async <T>(operation: Promise<T>, timeoutMs = settings.commandTimeoutMs): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            // Redis6's commandOptions.timeout stops at socket write. A response
            // deadline must also terminate the socket so pending replies cannot
            // hold requests indefinitely or outlive a cancelled operation.
            reject(new Error('Redis command timed out'));
            if (client.isOpen) client.destroy();
            setImmediate(() => { if (!closing) void connect().catch(() => undefined); });
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const healthy = async (): Promise<boolean> => {
    if (!client.isReady) {
      if (!closing && !client.isOpen) setImmediate(() => { if (!closing) void connect().catch(() => undefined); });
      return false;
    }
    try {
      return await command(client.ping(), Math.min(settings.commandTimeoutMs, 1000)) === 'PONG';
    } catch { return false; }
  };

  const key = (source: string, country: string): string => source + '|' + country;
  const savePhones = async (source: string, country: string, phones: PhoneNumber[]): Promise<void> => {
    await command(client.set(key(source, country), JSON.stringify(phones), { EX: ttlSeconds }));
  };
  const getPhones = async (source: string, country: string): Promise<PhoneNumber[]> => {
    const value = await command(client.get(key(source, country)));
    if (value === null) return [];
    try {
      const phones: unknown = JSON.parse(value);
      if (!Array.isArray(phones) || !phones.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const phone = entry as Partial<PhoneNumber>;
        return typeof phone.phone === 'string' && typeof phone.url === 'string';
      })) throw new Error('Invalid phone cache');
      return phones as PhoneNumber[];
    } catch {
      await command(client.del(key(source, country)));
      throw new Error('Invalid cached phone data; the cache entry was removed');
    }
  };
  return { client, connect, close, healthy, savePhones, getPhones, command };
};

const repository = createRedisRepository();
export const client = repository.client;
export const connectRedis = repository.connect;
export const closeRedis = repository.close;
export const isRedisHealthy = repository.healthy;
export const savePhones = repository.savePhones;
export const getPhones = repository.getPhones;
export const runRedisCommand = repository.command;
