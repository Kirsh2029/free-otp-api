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

test('absolute since filters omit the relative default text and expose the effective filter', async (t) => {
  const app = await createApp(t);
  for (const suffix of ['since=0', 'since=0&ago=30s', 'since=1000&ago=5m']) {
    const response = await app.inject('/api/USA/14155552671?' + suffix);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().requested.timeFilter, 'since');
    assert.equal(response.json().requested.agoText, undefined);
  }
  const relative = await app.inject('/api/USA/14155552671?ago=5m');
  assert.equal(relative.json().requested.timeFilter, 'ago');
  assert.equal(relative.json().requested.agoText, '5m');
});

test('blank numeric and repeated query values are rejected before cache or inbox access', async (t) => {
  let calls = 0;
  const app = await createApp(t, {
    getPhones: async () => { calls++; return phones; },
    getMessages: async () => { calls++; return []; }
  });
  for (const suffix of [
    'since=%20', 'since=%09', 'timeout=%20', 'limit=%20', 'page=%20',
    'since=0&since=0', 'source=receive-sms-free.cc&source=receive-sms-free.cc',
    'match=a&match=a', 'ago=30s&ago=30s', 'page=1&page=1', 'timeout=0&timeout=0'
  ]) {
    const response = await app.inject('/api/USA/14155552671?' + suffix);
    assert.equal(response.statusCode, 400, suffix);
  }
  assert.equal(calls, 0);
});

test('disabled providers remain unavailable even if an enabled-array snapshot still includes them', async (t) => {
  let calls = 0;
  for (const disabled of [{ ...first, enabled: false }, { ...first, status: 'disabled' as const }]) {
    const app = await createApp(t, {
      providers: [disabled],
      getPhones: async () => { calls++; return []; },
      getMessages: async () => { calls++; return []; }
    });
    for (const endpoint of ['/api/countries', '/api/list/USA', '/api/USA/14155552671']) {
      assert.equal((await app.inject(endpoint)).statusCode, 503, endpoint);
    }
  }
  assert.equal(calls, 0);
});

test('an explicitly selected source that does not support the country never silently falls back', async (t) => {
  const unsupported = { ...second, countries: ['UK' as const], status: 'verified' as const };
  const calls: string[] = [];
  const app = await createApp(t, { providers: [first, unsupported], getMessages: async (selected) => { calls.push(selected.name); return []; } });
  assert.equal((await app.inject(`/api/USA/14155552671?source=${encodeURIComponent(second.name)}`)).statusCode, 503);
  assert.equal((await app.inject(`/api/list/USA?source=${encodeURIComponent(second.name)}`)).statusCode, 503);
  assert.deepEqual(calls, []);
});

test('provider message 503 and 504 statuses remain distinct from successful empty inboxes', async (t) => {
  for (const statusCode of [503, 504]) {
    const app = await createApp(t, { getMessages: async () => { throw Object.assign(new Error('Fixture upstream failure'), { statusCode }); } });
    const response = await app.inject('/api/USA/14155552671?since=0');
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.json().results, undefined);
    assert.equal(response.json().error, 'Fixture upstream failure');
  }
});

test('native navigation timeout errors map to504 and malformed provider status codes do not crash routes', async (t) => {
  for (const error of [Object.assign(new Error('Fixture navigation timed out'), { name: 'TimeoutError' }), Object.assign(new Error('Fixture socket timed out'), { code: 'ETIMEDOUT' })]) {
    const app = await createApp(t, { getMessages: async () => { throw error; } });
    assert.equal((await app.inject('/api/USA/14155552671?since=0')).statusCode, 504);
  }
  const app = await createApp(t, { getMessages: async () => { throw Object.assign(new Error('Fixture malformed status'), { statusCode: 504.5 }); } });
  assert.equal((await app.inject('/api/USA/14155552671?since=0')).statusCode, 502);
});

const readSnapshot = {
  providerUrl: 'https://public.example.test/inbox',
  readAt: '2026-11-05T19:00:00.000Z',
  readDurationMs: 7,
  rawRowCount: 5,
  parseDrops: 1,
  droppedTimestampCount: 1,
  droppedMessageCount: 0,
  observedMessageCount: 4,
  matchedMessageCount: 0,
  returnedMessageCount: 0,
  timeFilteredCount: 1,
  matcherFilteredCount: 3,
  page: 1,
  pollCount: 1,
  newestMessageAt: message.ago,
  oldestMessageAt: message.ago - 1000,
  emptyInbox: false
};

test('empty matches expose actual read/filter diagnostics while fresh SMS delivery stays unverified', async (t) => {
  const app = await createApp(t, { getMessages: async (_source, options) => { options.onRead?.(readSnapshot); return []; } });
  const response = await app.inject('/api/USA/14155552671?since=0&match=missing-marker');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().results, []);
  assert.deepEqual(response.json().diagnostics, { ...readSnapshot, deliveryStatus: 'unverified' });
  assert.equal(response.json().diagnostics.observedMessageCount, 4);
  assert.equal(response.json().diagnostics.matchedMessageCount, 0);
});

test('routes do not invent provider read counts when the provider does not report them', async (t) => {
  const app = await createApp(t, { getMessages: async () => [] });
  const response = await app.inject('/api/USA/14155552671?since=0');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().diagnostics, undefined);
});

test('polling exposes the latest actual snapshot rather than accumulating historical row counts', async (t) => {
  const last = { ...readSnapshot, pollCount: 2, observedMessageCount: 6, rawRowCount: 6, parseDrops: 0, droppedTimestampCount: 0, timeFilteredCount: 2, matcherFilteredCount: 4 };
  const app = await createApp(t, { getMessages: async (_source, options) => { options.onRead?.(readSnapshot); options.onRead?.(last); return []; } });
  const response = await app.inject('/api/USA/14155552671?since=0&timeout=1000');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().diagnostics, { ...last, deliveryStatus: 'unverified' });
});

test('read diagnostics survive upstream parse failure without masquerading as a successful empty inbox', async (t) => {
  const dropped = { ...readSnapshot, observedMessageCount: 0, rawRowCount: 5, parseDrops: 5, droppedTimestampCount: 5, timeFilteredCount: 0, matcherFilteredCount: 0, newestMessageAt: undefined, oldestMessageAt: undefined };
  const app = await createApp(t, { getMessages: async (_source, options) => {
    options.onRead?.(dropped);
    throw Object.assign(new Error('Fixture inbox row parsing failed'), { statusCode: 502 });
  } });
  const response = await app.inject('/api/USA/14155552671?since=0');
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().results, undefined);
  assert.equal(response.json().diagnostics.parseDrops, 5);
  assert.equal(response.json().diagnostics.emptyInbox, false);
  assert.equal(response.json().diagnostics.deliveryStatus, 'unverified');
});

test('provider registry distinguishes public listing, historical inbox, and fresh-delivery verification', async (t) => {
  const verification = {
    listing: { status: 'verified' as const, detail: 'Fixture listing parsed' },
    inboxRead: { status: 'verified' as const, detail: 'Fixture history parsed' },
    freshSmsDelivery: { status: 'unverified' as const, detail: 'No controlled sender receipt evidence' }
  };
  const app = await createApp(t, { allProviders: [{ ...first, status: 'verified', verification }] });
  const response = await app.inject('/api/providers');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json()[0].verification, verification);
  assert.equal(response.json()[0].verification.freshSmsDelivery.status, 'unverified');
});

test('delivery probe POST preflight permits JSON without credentialed CORS', async (t) => {
  const app = await createApp(t);
  const response = await app.inject({
    method: 'OPTIONS', url: '/api/delivery-tests',
    headers: { origin: 'https://inboxcloudkit.xyz', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'https://inboxcloudkit.xyz');
  assert.match(String(response.headers['access-control-allow-methods']), /POST/);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
});

test('shared inbox-read helper preserves actual telemetry and existing array/single/undefined results', async () => {
  const { normalizeInboxRead, readProviderInbox } = await import('../src/routes/services.js');
  assert.deepEqual(normalizeInboxRead(undefined), []);
  assert.deepEqual(normalizeInboxRead(message), [message]);
  assert.deepEqual(normalizeInboxRead([message]), [message]);
  let forwarded = 0;
  const read = await readProviderInbox({ getMessages: async (_provider, options) => { options.onRead?.(readSnapshot); return message; } }, first, {
    country: 'USA', phoneNumber: '+14155552671', matcher: '', askedOtpAt: 0,
    onRead: () => { forwarded++; }
  });
  assert.deepEqual(read.messages, [message]);
  assert.deepEqual(read.diagnostics, readSnapshot);
  assert.equal(forwarded, 1);
  const missing = await readProviderInbox({ getMessages: async () => [] }, first, { country: 'USA', phoneNumber: '+14155552671', matcher: '' });
  assert.deepEqual(missing, { messages: [] });
});

test('API responses prevent HTTP caches from replaying stale inbox reads and failures', async (t) => {
  const app = await createApp(t);
  for (const endpoint of ['/api/countries', '/api/list/USA', '/api/USA/14155552671?since=0', '/api/USA/14155552671?source=quackr.io']) {
    assert.equal((await app.inject(endpoint)).headers['cache-control'], 'no-store', endpoint);
  }
});
