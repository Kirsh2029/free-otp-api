import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createRedisRepository } from '../src/repository/redis.js';

test('Redis import and repository creation have no implicit network connection', async () => {
  const repository = createRedisRepository(loadConfig({}).redis);
  assert.equal(repository.client.isOpen, false);
  assert.equal(await repository.healthy(), false);
  await assert.rejects(repository.getPhones('test', 'USA'));
  await repository.close();
});

test('Redis connection failure rejects startup after bounded retries', async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const repository = createRedisRepository({
    ...loadConfig({}).redis, host: '127.0.0.1', port: address.port, connectTimeoutMs: 100, reconnectAttempts: 0
  });
  const start = Date.now();
  await assert.rejects(repository.connect(), /Redis connection failed/);
  assert.ok(Date.now() - start < 5000);
  assert.equal(await repository.healthy(), false);
  await repository.close();
});

test('real Redis connects once, caches with expiry, evicts corruption, and closes', {
  skip: !process.env.TEST_REDIS_URL
}, async () => {
  const repository = createRedisRepository(loadConfig({ REDIS_URL: process.env.TEST_REDIS_URL }).redis, 1);
  const source = 'number-api-test-' + process.pid;
  const key = source + '|USA';
  try {
    await Promise.all([repository.connect(), repository.connect()]);
    assert.equal(await repository.healthy(), true);
    assert.deepEqual(await repository.getPhones(source, 'USA'), []);
    const phones = [{ phone: '12025550100', url: 'https://example.test/inbox' }];
    await repository.savePhones(source, 'USA', phones);
    assert.deepEqual(await repository.getPhones(source, 'USA'), phones);
    assert.ok(await repository.client.ttl(key) > 0);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(await repository.getPhones(source, 'USA'), []);
    await repository.client.set(key, '{broken json');
    await assert.rejects(repository.getPhones(source, 'USA'), /Invalid cached phone data/);
    assert.equal(await repository.client.exists(key), 0);
  } finally {
    await repository.close();
  }
  assert.equal(repository.client.isOpen, false);
  assert.equal(await repository.healthy(), false);
});
