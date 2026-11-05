import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
};

const launch = (port: number, redisUrl: string): ChildProcess => spawn(process.execPath,
  ['--import', 'tsx', 'src/app.ts'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), REDIS_URL: redisUrl,
      REDIS_CONNECT_TIMEOUT_MS: '500', REDIS_RECONNECT_ATTEMPTS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

const isListening = async (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

test('process never serves requests while required Redis handshake is stalled', { timeout: 10000 }, async (t) => {
  const sockets = new Set<Socket>();
  const redis = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => redis.listen(0, '127.0.0.1', resolve));
  const redisAddress = redis.address();
  assert.ok(redisAddress && typeof redisAddress === 'object');
  const port = await freePort();
  const child = launch(port, 'redis://127.0.0.1:' + redisAddress.port);
  t.after(() => { child.kill('SIGKILL'); sockets.forEach((socket) => socket.destroy()); redis.close(); });
  const exiting = once(child, 'exit');
  let output = '';
  child.stdout?.on('data', (data) => { output += String(data); });
  child.stderr?.on('data', (data) => { output += String(data); });
  for (let index = 0; index < 8; index++) {
    assert.equal(await isListening(port), false);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [code] = await exiting;
  assert.equal(code, 1);
  assert.match(output, /startup failed/);
  assert.doesNotMatch(output, /Server listening/);
});

test('running API reports Redis health and exits cleanly on SIGTERM', {
  skip: !process.env.TEST_REDIS_URL, timeout: 10000
}, async (t) => {
  const port = await freePort();
  const child = launch(port, process.env.TEST_REDIS_URL!);
  t.after(() => child.kill('SIGKILL'));
  const exiting = once(child, 'exit');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup deadline exceeded')), 5000);
    child.stdout?.on('data', (data) => {
      if (String(data).includes('Server listening')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('API exited during startup: ' + code)); });
  });
  const response = await fetch('http://127.0.0.1:' + port + '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', redis: 'up' });
  child.kill('SIGTERM');
  const [code, signal] = await exiting;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(await isListening(port), false);
});
