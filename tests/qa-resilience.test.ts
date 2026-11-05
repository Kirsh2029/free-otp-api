import assert from 'node:assert/strict';
import { connect, createServer, type Socket } from 'node:net';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createRedisRepository } from '../src/repository/redis.js';

test('Redis startup rejects a TCP peer that never completes the Redis handshake', async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const repository = createRedisRepository({
    ...loadConfig({}).redis, host: '127.0.0.1', port: address.port, url: undefined,
    connectTimeoutMs: 100, reconnectAttempts: 0
  });
  try {
    const outcome = await Promise.race([
      repository.connect().then(() => 'connected', () => 'rejected'),
      new Promise<string>((resolve) => setTimeout(() => resolve('stalled'), 1000))
    ]);
    assert.equal(outcome, 'rejected');
    assert.equal(repository.client.isOpen, false);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await repository.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Redis commands reject promptly when an established connection stops replying', {
  skip: !process.env.TEST_REDIS_URL
}, async () => {
  const upstreamUrl = new URL(process.env.TEST_REDIS_URL!);
  const upstreamHost = upstreamUrl.hostname;
  const upstreamPort = Number(upstreamUrl.port || 6379);
  const sockets = new Set<Socket>();
  let paused = false;
  let closing = false;
  let connections = 0;
  const server = createServer((downstream) => {
    if (closing) { downstream.destroy(); return; }
    if (++connections > 1) paused = false;
    const upstream = connect({ host: upstreamHost, port: upstreamPort });
    sockets.add(downstream);
    sockets.add(upstream);
    downstream.on('data', (data) => { if (!paused) upstream.write(data); });
    upstream.on('data', (data) => { if (!paused) downstream.write(data); });
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => { sockets.delete(downstream); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); downstream.destroy(); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  upstreamUrl.hostname = '127.0.0.1';
  upstreamUrl.port = String(address.port);
  const repository = createRedisRepository({
    ...loadConfig({ REDIS_URL: upstreamUrl.href }).redis, commandTimeoutMs: 100
  });
  try {
    await repository.connect();
    paused = true;
    const outcome = await Promise.race([
      repository.getPhones('qa-paused-connection', 'USA').then(() => 'resolved', () => 'rejected'),
      new Promise<string>((resolve) => setTimeout(() => resolve('stalled'), 1000))
    ]);
    assert.equal(outcome, 'rejected');
    const recoveryDeadline = Date.now() + 1000;
    while (!await repository.healthy() && Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await repository.healthy(), true);
    assert.deepEqual(await repository.getPhones('qa-paused-connection', 'USA'), []);
  } finally {
    closing = true;
    sockets.forEach((socket) => socket.destroy());
    await repository.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
