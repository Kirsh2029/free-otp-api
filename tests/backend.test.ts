import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Source, type Provider, type Message } from '../src/providers/index.js';
import { normalizePhoneNumber } from '../src/providers/helpers.js';
import type { ApiServices } from '../src/routes/services.js';

const provider = (source: Source): Provider => ({
  name: source,
  baseUrl: 'https://public.example.test',
  countries: ['USA'],
  enabled: true,
  status: 'unverified',
  statusReason: 'Local test fixture',
  getCountryUrl: () => 'https://public.example.test/usa',
  getPhonesList: async () => ({ phones: [] }),
  handleOtp: async () => []
});
const first = provider(Source.ReceiveSmsFree);
const second = provider(Source.SmsToMeCom);
const phones = [
  { phone: '14155552671', url: 'https://public.example.test/14155552671' },
  { phone: '12025550123', url: 'https://public.example.test/12025550123' }
];
const message: Message = { ago: 1700000000000, agoText: 'fixture timestamp', message: '100% verification code: 123456', otp: '123456', url: phones[0].url };

const createApp = async (t: TestContext, overrides: Partial<ApiServices> = {}, healthCheck: () => Promise<boolean> = async () => true) => {
  const app = await buildApp({
    logger: false,
    config: loadConfig({}),
    healthCheck,
    services: {
      providers: [first], allProviders: [first],
      getPhones: async () => phones,
      savePhones: async () => {},
      getPhonesList: async () => phones,
      getMessages: async () => [message],
      normalizePhone: normalizePhoneNumber,
      ...overrides
    }
  });
  t.after(() => app.close());
  return app;
};

test('health reflects Redis readiness and liveness remains available', async (t) => {
  let healthy = true;
  const app = await createApp(t, {}, async () => healthy);
  assert.equal((await app.inject('/health')).statusCode, 200);
  healthy = false;
  const down = await app.inject('/health');
  assert.equal(down.statusCode, 503);
  assert.deepEqual(down.json(), { status: 'degraded', redis: 'down' });
  assert.equal((await app.inject('/health/live')).statusCode, 200);
});

test('CORS returns an exact permitted origin, handles preflight, and omits credentials', async (t) => {
  const app = await createApp(t);
  for (const origin of ['https://inboxcloudkit.xyz', 'https://www.inboxcloudkit.xyz', 'http://localhost:3000']) {
    const response = await app.inject({ url: '/api/countries', headers: { origin } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  }
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/list/USA', headers: { origin: 'https://inboxcloudkit.xyz', 'access-control-request-method': 'GET', 'access-control-request-headers': 'content-type' } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://inboxcloudkit.xyz');
  const denied = await app.inject({ url: '/api/countries', headers: { origin: 'https://foreign.example.test' } });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('CORS supports additional origins through central configuration', async (t) => {
  const app = await buildApp({ logger: false, config: loadConfig({ CORS_ORIGINS: 'https://dashboard.example.test' }), healthCheck: async () => true });
  t.after(() => app.close());
  const response = await app.inject({ url: '/health', headers: { origin: 'https://dashboard.example.test' } });
  assert.equal(response.headers['access-control-allow-origin'], 'https://dashboard.example.test');
});

test('Swagger is available and uses configured API base exactly once', async (t) => {
  const app = await buildApp({ logger: false, config: loadConfig({ API_BASE_URL: 'https://api.example.test/v2///' }), healthCheck: async () => true });
  t.after(() => app.close());
  assert.equal((await app.inject('/docs/')).statusCode, 200);
  const spec = (await app.inject('/docs/json')).json();
  assert.deepEqual(spec.servers, [{ url: 'https://api.example.test/v2' }]);
  assert.equal(spec.info.title, 'Number API');
  assert(spec.paths['/countries']);
  assert.equal(spec.paths['/v2/countries'], undefined);
  assert.equal((await app.inject('/api/countries')).statusCode, 404);
});

test('route validation rejects invalid country, phone, source, pagination, and time filters before providers run', async (t) => {
  let calls = 0;
  const app = await createApp(t, { getMessages: async () => { calls++; return []; }, getPhonesList: async () => { calls++; return []; } });
  for (const url of [
    '/api/list/Atlantis', '/api/list/USA?source=unknown', '/api/list/USA?page=0', '/api/list/USA?limit=1001',
    '/api/USA/not-a-number', '/api/USA/14155552671?since=-1', '/api/USA/14155552671?since=NaN',
    '/api/USA/14155552671?ago=tomorrow', '/api/USA/14155552671?source=unknown', '/api/USA/14155552671?timeout=999999',
    '/api/USA/14155552671?unexpected=1'
  ]) assert.equal((await app.inject(url)).statusCode, 400, url);
  assert.equal(calls, 0);
});

test('country listing preserves legacy array contract and identifies cache counts', async (t) => {
  const app = await createApp(t);
  const response = await app.inject('/api/countries');
  assert.deepEqual(response.json(), [{ country: 'USA', source: first.name, url: 'https://public.example.test/usa', count: 2 }]);
  assert.equal(response.headers['x-number-counts'], 'redis-cache');
});

test('Redis read failures do not become misleading empty countries', async (t) => {
  const app = await createApp(t, { getPhones: async () => { throw new Error('fixture dependency failure'); } });
  const response = await app.inject('/api/countries');
  assert.equal(response.statusCode, 503);
  assert.match(response.json().error, /cache/);
});

test('phone listing normalizes, de-duplicates, filters by source, and paginates', async (t) => {
  const app = await createApp(t, { providers: [first, second], getPhones: async () => [...phones, { ...phones[0], phone: '+1 (415) 555-2671' }] });
  const response = await app.inject(`/api/list/USA?source=${encodeURIComponent(first.name)}&page=2&limit=1`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { phones: [{ value: '12025550123', url: phones[1].url, source: first.name }], pagination: { page: 2, limit: 1, total: 2, hasMore: false } });
});

test('phone cache misses invoke and save live provider listing', async (t) => {
  let lookups = 0;
  let saved = 0;
  const app = await createApp(t, {
    getPhones: async () => [],
    getPhonesList: async (country, selected) => { assert.equal(country, 'USA'); assert.equal(selected.name, first.name); lookups++; return phones; },
    savePhones: async (_source, _country, result) => { saved = result.length; }
  });
  const response = await app.inject('/api/list/USA');
  assert.equal(response.statusCode, 200);
  assert.equal(lookups, 1);
  assert.equal(saved, 2);
});

test('listing shows partial provider failures and fails honestly when every source fails', async (t) => {
  const app = await createApp(t, { providers: [first, second], getPhones: async (source) => { if (source === second.name) throw new Error('Fixture provider offline'); return phones; } });
  const partial = await app.inject('/api/list/USA');
  assert.equal(partial.statusCode, 200);
  assert.deepEqual(partial.json().errors, [{ source: second.name, error: 'Fixture provider offline' }]);
  const failed = await app.inject(`/api/list/USA?source=${encodeURIComponent(second.name)}`);
  assert.equal(failed.statusCode, 502);
  assert.match(failed.json().error, /All selected providers failed/);
});

test('unavailable sources return 503 without browser access', async (t) => {
  const app = await createApp(t, { providers: [] });
  assert.equal((await app.inject('/api/list/USA')).statusCode, 503);
  assert.equal((await app.inject('/api/USA/14155552671?source=quackr.io')).statusCode, 503);
});

test('message retrieval preserves literal percent matcher and returns single matches in results', async (t) => {
  const app = await createApp(t, { getMessages: async (_source, options) => { assert.equal(options.matcher, '100%'); assert.equal(options.phoneNumber, '+14155552671'); assert.equal(options.page, 2); return message; } });
  const response = await app.inject('/api/USA/%2B14155552671?since=0&match=100%25&page=2');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().requested.ago, 0);
  assert.deepEqual(response.json().results, [message]);
  assert.deepEqual(response.json().result, message);
});

test('message time and matcher filters apply even if upstream ignores them', async (t) => {
  const app = await createApp(t, { getMessages: async () => [message, { ...message, ago: 10 }, { ...message, message: 'unrelated' }] });
  const response = await app.inject('/api/USA/14155552671?since=1000&match=verification&limit=1');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().results, [message]);
});

test('an empty or undefined public inbox result is handled without crashing', async (t) => {
  const app = await createApp(t, { getMessages: async () => undefined });
  const response = await app.inject('/api/USA/14155552671?since=0');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().result, null);
  assert.deepEqual(response.json().results, []);
});

test('provider inbox errors are upstream failures rather than empty results', async (t) => {
  const app = await createApp(t, { getMessages: async () => { throw new Error('Fixture inbox offline'); } });
  const response = await app.inject('/api/USA/14155552671');
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error, 'Fixture inbox offline');
});

test('provider registry publishes source identifiers and honest verification state', async (t) => {
  const app = await createApp(t);
  const response = await app.inject('/api/providers');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [{ source: first.name, baseUrl: first.baseUrl, enabled: true, status: 'unverified', reason: 'Local test fixture', countries: ['USA'] }]);
});

test('message source defaults prefer verified providers while explicit source remains authoritative', async (t) => {
  const verified = { ...second, status: 'verified' as const };
  const calls: string[] = [];
  const app = await createApp(t, { providers: [first, verified], getMessages: async (selected) => { calls.push(selected.name); return []; } });
  assert.equal((await app.inject('/api/USA/14155552671?since=0')).statusCode, 200);
  assert.equal((await app.inject(`/api/USA/14155552671?since=0&source=${encodeURIComponent(first.name)}`)).statusCode, 200);
  assert.deepEqual(calls, [second.name, first.name]);
});

test('message source inference reuses the cached provider that owns a listed number', async (t) => {
  const verified = { ...first, status: 'verified' as const };
  const calls: string[] = [];
  const app = await createApp(t, {
    providers: [verified, second],
    getPhones: async (source) => source === second.name ? phones : [],
    getMessages: async (selected) => { calls.push(selected.name); return []; }
  });
  assert.equal((await app.inject('/api/USA/14155552671?since=0')).statusCode, 200);
  assert.deepEqual(calls, [second.name]);
});

test('message routes accept URL-encoded national phone formatting', async (t) => {
  let calledPhone: string | undefined;
  const app = await createApp(t, { getMessages: async (_source, options) => { calledPhone = options.phoneNumber; return []; } });
  const response = await app.inject('/api/USA/' + encodeURIComponent('(415) 555-2671') + '?since=0');
  assert.equal(response.statusCode, 200);
  assert.equal(calledPhone, '+14155552671');
});

test('provider listing deadlines retain HTTP 504 instead of an unrelated gateway status', async (t) => {
  const app = await createApp(t, {
    getPhones: async () => [],
    getPhonesList: async () => { throw Object.assign(new Error('Provider listing exceeded its deadline'), { statusCode: 504 }); }
  });
  const response = await app.inject('/api/list/USA');
  assert.equal(response.statusCode, 504);
  assert.match(response.json().errors[0].error, /deadline/);
});
