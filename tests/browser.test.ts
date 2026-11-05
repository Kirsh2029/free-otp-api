import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Cluster } from 'puppeteer-cluster';
import { BrowserPool } from '../src/browser/cluster.js';

test('failed browser launch releases creation state and permits a later attempt', async () => {
  const pool = new BrowserPool();
  const launch = mock.method(Cluster, 'launch', async () => { throw new Error('test launch failed'); });
  try {
    await assert.rejects(Promise.all([pool.createCluster(), pool.createCluster()]), /test launch failed/);
    assert.equal(launch.mock.callCount(), 1);
    await assert.rejects(pool.createCluster(), /test launch failed/);
    assert.equal(launch.mock.callCount(), 2);
  } finally { launch.mock.restore(); }
});

test('browser rotation drains an active task before closing the cluster', async () => {
  const pool = new BrowserPool();
  let finish: ((result: string) => void) | undefined;
  let closed = false;
  const cluster = {
    execute: () => new Promise<string>((resolve) => { finish = resolve; }),
    close: async () => { closed = true; }
  };
  pool.cluster = cluster as unknown as Cluster;
  const result = pool.execute('test', async () => 'unused');
  await new Promise((resolve) => setImmediate(resolve));
  const rotation = pool.refreshCluster();
  assert.equal(closed, false);
  assert.ok(finish);
  finish('done');
  assert.equal(await result, 'done');
  await rotation;
  assert.equal(closed, true);
  assert.equal(pool.cluster, undefined);
  await pool.closeCluster();
  await assert.rejects(pool.execute('new', async () => 'unused'), /shutting down/);
});

test('queued browser operations abort promptly and no new work enters shutdown', async () => {
  const pool = new BrowserPool();
  const cluster = { execute: () => new Promise(() => {}), close: async () => {} };
  pool.cluster = cluster as unknown as Cluster;
  const controller = new AbortController();
  const operation = pool.execute('queued', async () => 'unused', { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('test cancelled'));
  await assert.rejects(operation, /test cancelled/);
  const second = pool.execute('another', async () => 'unused');
  await new Promise((resolve) => setImmediate(resolve));
  const closing = pool.closeCluster();
  await assert.rejects(second, /shutdown/);
  await closing;
  await assert.rejects(pool.execute('after shutdown', async () => 'unused'), /shutting down/);
});
