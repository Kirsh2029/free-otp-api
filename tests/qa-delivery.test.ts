import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createDeliveryService } from '../src/delivery/service.js';
import { createProbeStore } from '../src/delivery/repository.js';
import { DeliveryTestError, type DeliveryProbe, type ProbeStore } from '../src/delivery/types.js';
import { Sources, Source, type Message, type MessageReadDiagnostics } from '../src/providers/index.js';
import { defaultServices } from '../src/routes/services.js';
import { createRedisRepository } from '../src/repository/redis.js';

const fixture = () => {
  let clock = Date.UTC(2026, 10, 5, 20);
  let rows: Message[] = [];
  let reads = 0;
  let readError: Error | undefined;
  let pendingRead: Promise<void> | undefined;
  const records = new Map<string, DeliveryProbe>();
  const locks = new Map<string, string>();
  const copy = (value: DeliveryProbe): DeliveryProbe => structuredClone(value);
  const store: ProbeStore = {
    reserveCreation: async () => true,
    create: async (probe) => { records.set(probe.id, copy(probe)); },
    get: async (id) => { const value = records.get(id); return value && copy(value); },
    update: async (probe) => {
      const previous = records.get(probe.id);
      assert.ok(previous);
      if (previous.status !== 'pending' || (probe.status !== 'received' && (previous.checkedAt ?? 0) > (probe.checkedAt ?? 0))) return copy(previous);
      records.set(probe.id, copy(probe));
      return copy(probe);
    },
    beginCheck: async (id, token, now) => {
      const value = records.get(id);
      if (!value || value.status !== 'pending' || locks.has(id) || now - (value.checkedAt ?? value.createdAt) < 3000) return false;
      locks.set(id, token);
      return true;
    },
    endCheck: async (id, token) => { if (locks.get(id) === token) locks.delete(id); }
  };
  const provider = Sources[Source.ReceiveSmsOnlineCom];
  const service = createDeliveryService({
    store, now: () => clock, settings: loadConfig({}),
    services: {
      ...defaultServices, providers: [provider], allProviders: [provider],
      getMessages: async (_provider, options) => {
        reads++;
        if (pendingRead) await pendingRead;
        if (readError) throw readError;
        const diagnostics: MessageReadDiagnostics = {
          providerUrl: provider.baseUrl + '/united-states/12025550100/', readAt: new Date(clock).toISOString(), readDurationMs: 1,
          rawRowCount: rows.length, parseDrops: 0, droppedTimestampCount: 0, droppedMessageCount: 0,
          observedMessageCount: rows.length, matchedMessageCount: rows.length, returnedMessageCount: rows.length,
          timeFilteredCount: 0, matcherFilteredCount: 0, page: 1, pollCount: 1, emptyInbox: rows.length === 0
        };
        options.onRead?.(diagnostics);
        return structuredClone(rows);
      }
    }
  });
  return {
    service, records, locks, store,
    reads: () => reads,
    move: (value: number) => { clock = value; },
    messages: (value: Message[]) => { rows = value; },
    error: (value?: Error) => { readError = value; },
    wait: (value?: Promise<void>) => { pendingRead = value; },
    message: (probe: DeliveryProbe, overrides: Partial<Message> = {}): Message => ({
      ago: clock, agoText: 'just now', message: probe.messageText, otp: probe.expectedOtp,
      url: provider.baseUrl + '/united-states/12025550100/', ...overrides
    }),
    create: () => service.create({ source: provider.name, country: 'USA', phoneNumber: '12025550100' })
  };
};

test('delivery proof rejects stale, invalid, and far-future timestamps even when nonce and code match', async () => {
  for (const ago of [0, -1, NaN, Infinity, -Infinity, Date.UTC(2026, 10, 4, 20), Date.UTC(2026, 10, 6, 20)]) {
    const f = fixture();
    const probe = await f.create();
    f.move(probe.createdAt + 5000);
    f.messages([f.message(probe, { ago })]);
    assert.equal((await f.service.check(probe.id)).status, 'pending', String(ago));
  }
});

test('delivery proof never combines a marker in one message with a code in another', async () => {
  const f = fixture();
  const probe = await f.create();
  f.move(probe.createdAt + 5000);
  f.messages([
    f.message(probe, { message: probe.marker + ' code 000000', otp: '000000' }),
    f.message(probe, { message: 'Unrelated test code ' + probe.expectedOtp })
  ]);
  assert.equal((await f.service.check(probe.id)).status, 'pending');
});

test('delivery proof rejects a code that is only part of a larger numeric identifier', async () => {
  for (const boundary of ['prefix', 'suffix']) {
    const f = fixture();
    const probe = await f.create();
    f.move(probe.createdAt + 5000);
    const code = boundary === 'prefix' ? '9' + probe.expectedOtp : probe.expectedOtp + '9';
    f.messages([f.message(probe, { message: probe.marker + ' code ' + code })]);
    assert.equal((await f.service.check(probe.id)).status, 'pending');
  }
});

test('delivery proof does not accept an unrelated website or credential-bearing inbox URL', async () => {
  for (const url of ['https://unrelated.example.test/inbox', 'https://user:password@receiveasmsonline.com/inbox']) {
    const f = fixture();
    const probe = await f.create();
    f.move(probe.createdAt + 5000);
    f.messages([f.message(probe, { url })]);
    await assert.rejects(f.service.check(probe.id), (error: unknown) => error instanceof DeliveryTestError && error.statusCode === 502);
    assert.equal(f.records.get(probe.id)?.status, 'pending');
    assert.equal(f.records.get(probe.id)?.lastError?.statusCode, 502);
    const reads = f.reads();
    assert.equal((await f.service.check(probe.id)).checkDeferred, true);
    assert.equal(f.reads(), reads);
    assert.equal(f.locks.size, 0);
  }
});

test('a check crossing expiry cannot become received after a delayed provider response', async () => {
  const f = fixture();
  const probe = await f.create();
  f.move(probe.createdAt + 5000);
  let finish: (() => void) | undefined;
  f.wait(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = f.service.check(probe.id);
  await new Promise((resolve) => setImmediate(resolve));
  f.move(probe.expiresAt + 1);
  f.messages([f.message(probe, { ago: probe.createdAt + 5000 })]);
  assert.ok(finish);
  finish();
  assert.equal((await pending).status, 'expired');
  assert.equal(f.locks.size, 0);
});

test('parallel checks read a pending provider inbox once and release their owned lease', async () => {
  const f = fixture();
  const probe = await f.create();
  f.move(probe.createdAt + 5000);
  let finish: (() => void) | undefined;
  f.wait(new Promise<void>((resolve) => { finish = resolve; }));
  const first = f.service.check(probe.id);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await f.service.check(probe.id);
  assert.equal(second.checkDeferred, true);
  assert.equal(f.reads(), 2); // One baseline and one acquired check.
  assert.ok(finish);
  finish();
  assert.equal((await first).status, 'pending');
  assert.equal(f.locks.size, 0);
});

test('provider errors retain pending status, redact raw error text, and throttle repeated failed checks', async () => {
  const f = fixture();
  const probe = await f.create();
  f.move(probe.createdAt + 5000);
  f.error(new Error('SIMULATED_PRIVATE_MESSAGE_CONTENT'));
  await assert.rejects(f.service.check(probe.id), (error: unknown) => {
    assert.ok(error instanceof DeliveryTestError);
    assert.equal(error.statusCode, 502);
    assert.equal(JSON.stringify(error.probe).includes('SIMULATED_PRIVATE_MESSAGE_CONTENT'), false);
    assert.equal(error.probe?.status, 'pending');
    return true;
  });
  const deferred = await f.service.check(probe.id);
  assert.equal(deferred.checkDeferred, true);
  assert.equal(f.reads(), 2);
  assert.equal(f.locks.size, 0);
});

test('received and expired probes never start another provider read', async () => {
  const f = fixture();
  const received = await f.create();
  f.move(received.createdAt + 5000);
  f.messages([f.message(received)]);
  assert.equal((await f.service.check(received.id)).status, 'received');
  const expired = await f.create();
  f.move(expired.expiresAt + 1);
  assert.equal((await f.service.check(expired.id)).status, 'expired');
  const before = f.reads();
  f.error(new Error('No terminal probe may read the provider'));
  assert.equal((await f.service.check(received.id)).status, 'received');
  assert.equal((await f.service.check(expired.id)).status, 'expired');
  assert.equal(f.reads(), before);
});

test('real Redis delivery storage keeps terminal status and expiry, rejects corruption, and owns check leases atomically', {
  skip: !process.env.TEST_REDIS_URL
}, async () => {
  const redis = createRedisRepository(loadConfig({ REDIS_URL: process.env.TEST_REDIS_URL }).redis);
  await redis.connect();
  const store = createProbeStore(redis.client, redis.command, 60);
  const f = fixture();
  const initial = await f.create();
  const keys: string[] = [];
  const keyFor = (id: string) => 'number-api:delivery:' + id;
  try {
    const pending = { ...initial, id: randomUUID() };
    keys.push(keyFor(pending.id), 'number-api:delivery-lock:' + pending.id);
    await store.create(pending);
    const beforeTtl = await redis.client.pTTL(keyFor(pending.id));
    const newer = { ...pending, checkedAt: pending.createdAt + 10_000 };
    await store.update(newer);
    const earlierReceipt: DeliveryProbe = {
      ...pending, status: 'received', checkedAt: pending.createdAt + 5000, receivedAt: pending.createdAt + 5000,
      evidence: { providerUrl: 'https://receiveasmsonline.com/united-states/12025550100/', messageTimestamp: pending.createdAt + 4000, otpMatched: true, messageLength: pending.messageText.length }
    };
    assert.equal((await store.update(earlierReceipt)).status, 'received');
    assert.equal((await store.update({ ...pending, checkedAt: pending.createdAt + 20_000 })).status, 'received');
    assert.ok(await redis.client.pTTL(keyFor(pending.id)) <= beforeTtl);

    const lockProbe = { ...initial, id: randomUUID() };
    keys.push(keyFor(lockProbe.id), 'number-api:delivery-lock:' + lockProbe.id);
    await store.create(lockProbe);
    const tokens = [randomUUID(), randomUUID()];
    assert.equal(await store.beginCheck(lockProbe.id, tokens[0], lockProbe.createdAt + 1000, 1000), false);
    const leases = await Promise.all(tokens.map((token) => store.beginCheck(lockProbe.id, token, lockProbe.createdAt + 5000, 1000)));
    assert.equal(leases.filter(Boolean).length, 1);
    const owner = tokens[leases.findIndex(Boolean)];
    const other = tokens.find((token) => token !== owner)!;
    await store.endCheck(lockProbe.id, other);
    assert.equal(await store.beginCheck(lockProbe.id, other, lockProbe.createdAt + 5000, 1000), false);
    await store.endCheck(lockProbe.id, owner);
    assert.equal(await store.beginCheck(lockProbe.id, other, lockProbe.createdAt + 5000, 1000), true);
    await store.endCheck(lockProbe.id, other);

    const corrupt = { ...initial, id: randomUUID(), status: 'received' };
    keys.push(keyFor(corrupt.id));
    await redis.client.set(keyFor(corrupt.id), JSON.stringify(corrupt), { EX: 60 });
    await assert.rejects(store.get(corrupt.id), (error: unknown) => error instanceof DeliveryTestError && error.statusCode === 503);
    const mismatch = { ...initial, id: randomUUID() };
    const differentKey = keyFor(randomUUID());
    keys.push(differentKey);
    await redis.client.set(differentKey, JSON.stringify(mismatch), { EX: 60 });
    await assert.rejects(store.get(differentKey.split(':').at(-1)!), (error: unknown) => error instanceof DeliveryTestError && error.statusCode === 503);
  } finally {
    if (keys.length) await redis.client.del(keys);
    await redis.close();
  }
});
