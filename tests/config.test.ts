import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('configuration uses Number API, normalizes trailing slashes, and exposes the route prefix', () => {
  const defaults = loadConfig({});
  assert.equal(defaults.apiBaseUrl, 'https://number-api.inboxcloudkit.xyz/api');
  assert.equal(defaults.apiPath, '/api');
  const custom = loadConfig({ API_BASE_URL: 'https://api.example.test/v2///' });
  assert.equal(custom.apiBaseUrl, 'https://api.example.test/v2');
  assert.equal(custom.apiPath, '/v2');
});

test('PUBLIC_URL is a backwards-compatible fallback and API_BASE_URL wins', () => {
  assert.equal(loadConfig({ PUBLIC_URL: 'https://api.example.test/' }).apiBaseUrl, 'https://api.example.test/api');
  assert.equal(loadConfig({ PUBLIC_URL: 'https://old.example.test/api/', API_BASE_URL: 'https://new.example.test/api' }).apiBaseUrl, 'https://new.example.test/api');
});

test('configuration rejects malformed, non-HTTP, credentialed, and query-bearing public URLs', () => {
  for (const value of ['not-a-url', 'file:///tmp/api', 'https://u:p@example.test/api', 'https://example.test/api?secret=x', 'https://example.test/api#part']) {
    assert.throws(() => loadConfig({ API_BASE_URL: value }), /API_BASE_URL/);
  }
});

test('CORS includes explicit defaults and normalizes additional origins without wildcards', () => {
  const settings = loadConfig({ CORS_ORIGINS: 'https://dashboard.example.test/,https://dashboard.example.test' });
  assert(settings.corsOrigins.includes('https://inboxcloudkit.xyz'));
  assert(settings.corsOrigins.includes('https://www.inboxcloudkit.xyz'));
  assert(settings.corsOrigins.includes('http://localhost:3000'));
  assert.equal(settings.corsOrigins.filter((value) => value === 'https://dashboard.example.test').length, 1);
  for (const value of ['*', 'https://example.test/path', 'https://user:pass@example.test']) {
    assert.throws(() => loadConfig({ CORS_ORIGINS: value }), /CORS_ORIGINS/);
  }
});

test('Redis accepts URL/TLS or separate host, port, and password settings', () => {
  const settings = loadConfig({ REDIS_URL: 'rediss://user:password@redis.example.test:6380/2', REDIS_HOST: 'cache', REDIS_PORT: '6380', REDIS_PASSWORD: 'fixture' });
  assert.equal(settings.redis.url, 'rediss://user:password@redis.example.test:6380/2');
  assert.equal(settings.redis.host, 'cache');
  assert.equal(settings.redis.port, 6380);
  assert.equal(settings.redis.password, 'fixture');
  for (const value of ['https://redis.example.test', 'redis://', 'redis://cache?x=1']) assert.throws(() => loadConfig({ REDIS_URL: value }), /REDIS_URL/);
});

test('numeric and browser flags reject typos instead of silently using defaults', () => {
  for (const env of [{ PORT: 'oops' }, { PORT: '0' }, { REDIS_PORT: '65536' }, { CACHE_TTL_SECONDS: '0' }, { PROVIDER_RETRIES: '0' }, { BROWSER_MAX_CONCURRENCY: '999' }, { PUPPETEER_NO_SANDBOX: 'maybe' }]) {
    assert.throws(() => loadConfig(env));
  }
  assert.equal(loadConfig({ PUPPETEER_NO_SANDBOX: 'true', REDIS_RECONNECT_ATTEMPTS: '0' }).browser.noSandbox, true);
  assert.equal(loadConfig({ REDIS_RECONNECT_ATTEMPTS: '0' }).redis.reconnectAttempts, 0);
});

test('delivery probe expiry, retention, and rate settings are validated centrally', () => {
  const defaults = loadConfig({});
  assert.equal(defaults.deliveryTestTtlSeconds, 600);
  assert.equal(defaults.deliveryTestRetentionSeconds, 86400);
  assert.equal(defaults.deliveryTestMaxPerMinute, 20);
  const custom = loadConfig({ DELIVERY_TEST_TTL_SECONDS: '300', DELIVERY_TEST_RETENTION_SECONDS: '7200', DELIVERY_TEST_MAX_PER_MINUTE: '5' });
  assert.equal(custom.deliveryTestTtlSeconds, 300);
  assert.equal(custom.deliveryTestRetentionSeconds, 7200);
  assert.equal(custom.deliveryTestMaxPerMinute, 5);
  for (const env of [{ DELIVERY_TEST_TTL_SECONDS: '59' }, { DELIVERY_TEST_TTL_SECONDS: '1801' }, { DELIVERY_TEST_RETENTION_SECONDS: '3599' }, { DELIVERY_TEST_MAX_PER_MINUTE: '0' }, { DELIVERY_TEST_MAX_PER_MINUTE: '101' }]) assert.throws(() => loadConfig(env));
});
