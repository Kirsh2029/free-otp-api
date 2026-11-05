import { config as loadDotEnv } from 'dotenv';

loadDotEnv({ quiet: true });

export type Environment = Record<string, string | undefined>;

const defaultApiBaseUrl = 'https://number-api.inboxcloudkit.xyz/api';

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  apiBaseUrl: string;
  apiPath: string;
  corsOrigins: string[];
  redis: {
    url?: string;
    host: string;
    port: number;
    password?: string;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    reconnectAttempts: number;
  };
  cacheTtlSeconds: number;
  browser: {
    executablePath?: string;
    noSandbox: boolean;
    maxConcurrency: number;
    taskTimeoutMs: number;
    navigationTimeoutMs: number;
    maintenanceIntervalMs: number;
    proxy?: string;
  };
  maxProviderPages: number;
  providerRetries: number;
}

const integer = (env: Environment, key: string, fallback: number, min: number, max: number): number => {
  const text = env[key]?.trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`${key} must be an integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}`);
  }
  return value;
};

const boolean = (env: Environment, key: string, fallback: boolean): boolean => {
  const text = env[key]?.trim().toLowerCase();
  if (!text) return fallback;
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw new Error(`${key} must be true or false`);
};

export const normalizeHttpUrl = (value: string, name = 'URL'): URL => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP or HTTPS URL without credentials, query, or fragment`);
  }
  return url;
};

const normalizeOrigin = (value: string): string => {
  const url = normalizeHttpUrl(value, 'CORS_ORIGINS');
  if (url.pathname !== '/') throw new Error('CORS_ORIGINS entries must be origins without paths');
  return url.origin;
};

export const loadConfig = (env: Environment = process.env): AppConfig => {
  const apiUrl = normalizeHttpUrl(env.API_BASE_URL || env.PUBLIC_URL || defaultApiBaseUrl, 'API_BASE_URL');
  const apiPath = apiUrl.pathname.replace(/\/+$/, '') || '/api';
  apiUrl.pathname = apiPath;
  const corsOrigins = [
    'https://inboxcloudkit.xyz',
    'https://www.inboxcloudkit.xyz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...((env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean))
  ].map(normalizeOrigin);

  const redisUrl = env.REDIS_URL?.trim() || undefined;
  if (redisUrl) {
    let url: URL;
    try {
      url = new URL(redisUrl);
    } catch {
      throw new Error('REDIS_URL must be an absolute redis:// or rediss:// URL');
    }
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.hash || url.search) {
      throw new Error('REDIS_URL must use redis:// or rediss:// with a hostname');
    }
  }

  const proxy = env.PROXY?.trim() || undefined;
  if (proxy) {
    let url: URL;
    try {
      url = new URL(proxy);
    } catch {
      throw new Error('PROXY must be an absolute proxy URL');
    }
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new Error('PROXY must use HTTP, HTTPS, SOCKS4, or SOCKS5 without credentials, query, or fragment');
    }
  }

  return {
    nodeEnv: env.NODE_ENV || 'development',
    host: env.HOST?.trim() || '0.0.0.0',
    port: integer(env, 'PORT', 3030, 1, 65535),
    apiBaseUrl: apiUrl.toString().replace(/\/+$/, ''),
    apiPath,
    corsOrigins: [...new Set(corsOrigins)],
    redis: {
      url: redisUrl,
      host: env.REDIS_HOST?.trim() || '127.0.0.1',
      port: integer(env, 'REDIS_PORT', 6379, 1, 65535),
      password: env.REDIS_PASSWORD || undefined,
      connectTimeoutMs: integer(env, 'REDIS_CONNECT_TIMEOUT_MS', 10000, 100, 120000),
      commandTimeoutMs: integer(env, 'REDIS_COMMAND_TIMEOUT_MS', 5000, 100, 120000),
      reconnectAttempts: integer(env, 'REDIS_RECONNECT_ATTEMPTS', 3, 0, 100)
    },
    cacheTtlSeconds: integer(env, 'CACHE_TTL_SECONDS', 43200, 1, 604800),
    browser: {
      executablePath: env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
      noSandbox: boolean(env, 'PUPPETEER_NO_SANDBOX', false),
      maxConcurrency: integer(env, 'BROWSER_MAX_CONCURRENCY', 3, 1, 20),
      taskTimeoutMs: integer(env, 'BROWSER_TASK_TIMEOUT_MS', 60000, 1000, 300000),
      navigationTimeoutMs: integer(env, 'BROWSER_NAVIGATION_TIMEOUT_MS', 30000, 1000, 120000),
      maintenanceIntervalMs: integer(env, 'BROWSER_REFRESH_INTERVAL_MS', 600000, 1000, 86400000),
      proxy
    },
    maxProviderPages: integer(env, 'MAX_PROVIDER_PAGES', 50, 1, 100),
    providerRetries: integer(env, 'PROVIDER_RETRIES', 2, 1, 5)
  };
};

export const config = loadConfig();
