import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createDeliveryService } from '../src/delivery/service.js';
import { createProbeStore } from '../src/delivery/repository.js';
import { type DeliveryProbe, type ProbeStore, DeliveryTestError } from '../src/delivery/types.js';
import { loadConfig } from '../src/config.js';
import { Source, type Message, type Provider } from '../src/providers/index.js';
import { normalizePhoneNumber, tryParseOtpCode } from '../src/providers/helpers.js';
import type { ApiServices } from '../src/routes/services.js';
import { buildApp } from '../src/app.js';
import { createRedisRepository } from '../src/repository/redis.js';

const provider: Provider = {
  name: Source.ReceiveSmsCo, baseUrl: 'https://fixture.test', countries: ['USA'], enabled: true,
  status: 'unverified', statusReason: 'Controlled local test fixture',
  getPhonesList: async () => ({ phones: [] }), handleOtp: async () => []
};

const fixtureStore = (): ProbeStore & { records: Map<string, DeliveryProbe> } => {
  const records = new Map<string, DeliveryProbe>();
  const locks = new Map<string, string>();
  let count = 0;
  return {
    records,
    reserveCreation: async (_now, maximum) => ++count <= maximum,
    create: async (probe) => { records.set(probe.id, structuredClone(probe)); },
    get: async (id) => { const p = records.get(id); return p ? structuredClone(p) : undefined; },
    update: async (probe) => {
      const old = records.get(probe.id);
      assert.ok(old);
      if (old.status !== 'pending') return structuredClone(old);
      records.set(probe.id, structuredClone(probe));
      return structuredClone(probe);
    },
    beginCheck: async (id, token, now) => {
      const old = records.get(id);
      if (!old || locks.has(id) || now - (old.checkedAt ?? old.createdAt) < 3000) return false;
      locks.set(id, token);
      return true;
    },
    endCheck: async (id, token) => { if (locks.get(id) === token) locks.delete(id); }
  };
};

const fixture = (overrides: Partial<ApiServices> = {}) => {
  let now = Date.now();
  let inbox: Message[] = [];
  let reads = 0;
  const store = fixtureStore();
  const services: ApiServices = {
    providers: [provider], allProviders: [provider], normalizePhone: normalizePhoneNumber,
    getPhones: async () => [], savePhones: async () => {}, getPhonesList: async () => [],
    getMessages: async (_provider, options) => {
      reads++;
      assert.equal(options.askedOtpAt, 0);
      options.onRead?.({ providerUrl: 'https://fixture.test/inbox', readAt: new Date(now).toISOString(), readDurationMs: 1,
        rawRowCount: inbox.length, parseDrops: 0, droppedTimestampCount: 0, droppedMessageCount: 0,
        observedMessageCount: inbox.length, matchedMessageCount: inbox.length, returnedMessageCount: inbox.length,
        timeFilteredCount: 0, matcherFilteredCount: 0, page: 1, pollCount: 1, emptyInbox: inbox.length === 0 });
      return structuredClone(inbox);
    }, ...overrides
  };
  const settings = loadConfig({ DELIVERY_TEST_MAX_PER_MINUTE: '2' });
  const service = createDeliveryService({ services, store, settings, now: () => now });
  const input = { country: 'USA' as const, phoneNumber: '(202) 555-0123', source: Source.ReceiveSmsCo };
  return { service, store, services, settings, input,
    advance: (ms = 4000) => { now += ms; }, now: () => now, reads: () => reads,
    setInbox: (messages: Message[]) => { inbox = messages; },
    message: (text: string, otp?: string): Message => ({ ago: now, agoText: 'just now', message: text, otp, url: 'https://fixture.test/inbox' }) };
};

test('delivery tests start only after a baseline read and issue distinct harmless markers', async () => {
  const f = fixture();
  const first = await f.service.create(f.input);
  const second = await f.service.create(f.input);
  assert.equal(f.reads(), 2);
  assert.equal(first.status, 'pending');
  assert.equal(first.phoneNumber, '12025550123');
  assert.match(first.marker, /^NUMBERTEST-[A-Z]{24}$/);
  assert.notEqual(first.marker, second.marker);
  assert.notEqual(first.id, second.id);
  assert.equal(tryParseOtpCode(first.messageText), first.expectedOtp);
  assert.equal(first.baselineRead?.observedMessageCount, 0);
  assert.equal(first.expiresAt - first.createdAt, 600000);
  assert.equal(first.receivedAt, undefined);
});

test('historical messages and unmatched codes never become fresh receipt proof', async () => {
  const f = fixture();
  f.setInbox([f.message('Old verification code 123456', '123456')]);
  const p = await f.service.create(f.input);
  f.advance();
  assert.equal((await f.service.check(p.id)).status, 'pending');
  f.setInbox([f.message(p.marker + ' code 000000', '000000'), f.message('different marker code ' + p.expectedOtp, p.expectedOtp)]);
  f.advance();
  assert.equal((await f.service.check(p.id)).status, 'pending');
});

test('a new exact marker and bounded expected code produce durable per-test receipt evidence', async () => {
  const f = fixture();
  const p = await f.service.create(f.input);
  f.setInbox([f.message(p.messageText, p.expectedOtp)]);
  f.advance();
  const received = await f.service.check(p.id);
  assert.equal(received.status, 'received');
  assert.equal(received.receivedAt, f.now());
  assert.equal(received.evidence?.otpMatched, true);
  assert.equal(received.evidence?.providerUrl, 'https://fixture.test/inbox');
  const reads = f.reads();
  f.setInbox([]);
  assert.equal((await f.service.check(p.id)).status, 'received');
  assert.equal(f.reads(), reads);
});

test('delivery observation and OTP extractor correctness remain separate results', async () => {
  const f = fixture();
  const p = await f.service.create(f.input);
  f.setInbox([f.message(p.messageText, '000000')]);
  f.advance();
  const read = await f.service.check(p.id);
  assert.equal(read.status, 'received');
  assert.equal(read.evidence?.otpMatched, false);
});

test('rapid repeated delivery checks reuse pending state without extra browser work', async () => {
  const f = fixture();
  const p = await f.service.create(f.input);
  const reads = f.reads();
  const check = await f.service.check(p.id);
  assert.equal(check.status, 'pending');
  assert.equal(check.checkDeferred, true);
  assert.equal(f.reads(), reads);
});

test('expiry prevents more provider reads and remains terminal', async () => {
  const f = fixture();
  const p = await f.service.create(f.input);
  const reads = f.reads();
  f.advance(600001);
  assert.equal((await f.service.check(p.id)).status, 'expired');
  assert.equal(f.reads(), reads);
  f.setInbox([f.message(p.messageText, p.expectedOtp)]);
  assert.equal((await f.service.check(p.id)).status, 'expired');
});

test('unreadable baseline never issues a ready test', async () => {
  const f = fixture({ getMessages: async () => { throw Object.assign(new Error('fixture upstream denial'), { statusCode: 503 }); } });
  await assert.rejects(f.service.create(f.input), (e: unknown) => e instanceof DeliveryTestError && e.statusCode === 503);
  assert.equal(f.store.records.size, 0);
});

test('a later upstream outage stays an error with unverified pending state', async () => {
  const f = fixture();
  const p = await f.service.create(f.input);
  f.advance();
  f.services.getMessages = async () => { throw Object.assign(new Error('fixture deadline'), { statusCode: 504 }); };
  await assert.rejects(f.service.check(p.id), (e: unknown) => e instanceof DeliveryTestError && e.statusCode === 504 && e.probe?.status === 'pending');
  const stored = await f.store.get(p.id);
  assert.equal(stored?.status, 'pending');
  assert.equal(stored?.lastError?.statusCode, 504);
});

test('unknown/disabled providers, invalid phones, missing IDs and creation limits fail explicitly', async () => {
  const f = fixture();
  await assert.rejects(f.service.create({ ...f.input, phoneNumber: 'abc' }), /Invalid phone/);
  await assert.rejects(f.service.create({ ...f.input, source: Source.QuackrIo }), /unavailable/);
  await assert.rejects(f.service.check('bad id'), /Invalid delivery/);
  await assert.rejects(f.service.check('00000000-0000-0000-0000-000000000000'), /not found/);
  await f.service.create(f.input);
  await f.service.create(f.input);
  await assert.rejects(f.service.create(f.input), (e: unknown) => e instanceof DeliveryTestError && e.statusCode === 429);
});

test('delivery routes validate JSON and preserve POST CORS/no-store behavior', async (t) => {
  const f = fixture();
  const app = await buildApp({ logger: false, services: f.services, healthCheck: async () => true, delivery: { store: f.store } });
  t.after(() => app.close());
  for (const body of [{}, { source: 'bad', country: 'USA', phoneNumber: '12025550123' }, { ...f.input, extra: true }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/delivery-tests', payload: body })).statusCode, 400);
  }
  const created = await app.inject({ method: 'POST', url: '/api/delivery-tests', payload: f.input });
  assert.equal(created.statusCode, 200);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(created.json().status, 'pending');
  assert.equal((await app.inject('/api/delivery-tests/not-a-uuid')).statusCode, 400);
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/delivery-tests', headers: { origin: 'https://inboxcloudkit.xyz', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(preflight.statusCode, 204);
  assert.match(String(preflight.headers['access-control-allow-methods']), /POST/);
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
});

test('SIMULATED HTTP transport: newly injected fixture SMS is observed by API and persisted in real Redis', {
  skip: !process.env.TEST_REDIS_URL, timeout: 20000
}, async () => {
  const messages: Message[] = [];
  const providerServer = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/sms') {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const input = JSON.parse(raw) as { message: string };
      messages.push({ ago: Date.now(), agoText: 'just now', message: input.message, otp: tryParseOtpCode(input.message), url: origin + '/inbox' });
      response.statusCode = 201;
      response.end(JSON.stringify({ simulated: true }));
    } else response.end(JSON.stringify(messages));
  });
  await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  const address = providerServer.address();
  assert.ok(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  const f = fixture({
    providers: [{ ...provider, baseUrl: origin }],
    getMessages: async () => await (await fetch(origin + '/inbox')).json() as Message[]
  });
  const redis = createRedisRepository(loadConfig({ REDIS_URL: process.env.TEST_REDIS_URL }).redis);
  await redis.connect();
  const store = createProbeStore(redis.client, redis.command, 60, { [Source.ReceiveSmsCo]: [origin] });
  const app = await buildApp({ logger: false, services: f.services, healthCheck: redis.healthy, delivery: { store } });
  let id: string | undefined;
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const api = app.server.address();
    assert.ok(api && typeof api === 'object');
    const base = 'http://127.0.0.1:' + api.port + '/api';
    const created = await fetch(base + '/delivery-tests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.input) });
    assert.equal(created.status, 200);
    const probe = await created.json() as DeliveryProbe;
    id = probe.id;
    assert.equal(probe.status, 'pending');
    assert.equal((await (await fetch(base + '/delivery-tests/' + id)).json() as DeliveryProbe).status, 'pending');
    const send = await fetch(origin + '/sms', { method: 'POST', body: JSON.stringify({ message: probe.messageText }) });
    assert.equal(send.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const checked = await (await fetch(base + '/delivery-tests/' + id)).json() as DeliveryProbe;
    assert.equal(checked.status, 'received');
    assert.equal(checked.evidence?.otpMatched, true);
    assert.equal((await store.get(id))?.status, 'received');
    const oldRoute = await fetch(base + '/USA/12025550123?' + new URLSearchParams({ source: Source.ReceiveSmsCo, since: '0', match: probe.marker }));
    assert.equal(oldRoute.status, 200);
    const body = await oldRoute.json() as { results: Message[] };
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].otp, probe.expectedOtp);
  } finally {
    if (id) await redis.client.del('number-api:delivery:' + id);
    await app.close();
    await redis.close();
    await new Promise<void>((resolve) => providerServer.close(() => resolve()));
  }
});
