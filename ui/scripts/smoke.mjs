// Deterministic browser regression. Every API response below is a fixture;
// no SMS is sent and this script does not verify carrier delivery.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const appUrl = process.env.UI_SMOKE_URL || 'http://127.0.0.1:4173';
const apiOrigin = 'https://number-api.inboxcloudkit.xyz';
const browser = await puppeteer.launch({
  headless: true,
  args: process.env.UI_SMOKE_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
  ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {})
});
const errors = [];
const page = await browser.newPage();
let messageRequests = 0;
let createRequests = 0;
let probeRequests = 0;
let recentQuery;
const probes = new Map();
const oldMessage = { ago: Date.now() - 86400000, agoText: '1 day ago', message: 'Fixture historical message', url: 'https://fixture.test/inbox/12025550123' };
const diagnostics = (overrides = {}) => ({
  providerUrl: oldMessage.url, readAt: new Date().toISOString(), readDurationMs: 10,
  rawRowCount: 1, parseDrops: 0, droppedTimestampCount: 0, droppedMessageCount: 0,
  observedMessageCount: 1, matchedMessageCount: 1, returnedMessageCount: 1,
  timeFilteredCount: 0, matcherFilteredCount: 0, page: 1, pollCount: 1,
  newestMessageAt: oldMessage.ago, oldestMessageAt: oldMessage.ago,
  emptyInbox: false, deliveryStatus: 'unverified', ...overrides
});
async function clickButton(text) {
  for (const button of await page.$$('button')) {
    if ((await button.evaluate((element) => element.textContent)).trim() === text) {
      await button.click(); return;
    }
  }
  throw new Error(`Button not found: ${text}`);
}
const bodyText = () => page.$eval('body', (element) => element.textContent);
try {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (url.origin !== apiOrigin) return request.continue();
    const headers = {
      'access-control-allow-origin': '*', 'content-type': 'application/json',
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type'
    };
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
    let body;
    if (url.pathname === '/api/countries') {
      body = [{ country: 'USA', source: 'fixture.test', url: 'https://fixture.test/country/usa', count: 0 }];
    } else if (url.pathname === '/api/list/USA') {
      const pageNumber = Number(url.searchParams.get('page') || 1);
      body = { phones: [{ value: pageNumber === 1 ? '+12025550123' : '+12025550124', source: pageNumber === 1 ? 'fixture.test' : 'second.test', url: oldMessage.url }], errors: [{ source: 'failed.test', error: 'Upstream fixture failure' }], pagination: { page: pageNumber, limit: 1, total: 2, hasMore: pageNumber === 1 } };
    } else if (url.pathname === '/api/USA/+12025550123' || url.pathname === '/api/USA/12025550123') {
      messageRequests += 1;
      recentQuery = url.searchParams;
      if (url.searchParams.has('match')) {
        body = { result: null, results: [], diagnostics: diagnostics({ matchedMessageCount: 0, returnedMessageCount: 0, matcherFilteredCount: 1 }) };
      } else if (messageRequests === 1) {
        body = { result: null, results: [], diagnostics: diagnostics({ rawRowCount: 0, observedMessageCount: 0, matchedMessageCount: 0, returnedMessageCount: 0, emptyInbox: true, newestMessageAt: undefined, oldestMessageAt: undefined }) };
      } else {
        // Legacy single-result response: results=[] must not hide the message.
        body = { result: oldMessage, results: [], diagnostics: diagnostics() };
      }
    } else if (url.pathname === '/api/delivery-tests' && request.method() === 'POST') {
      createRequests += 1;
      assert.deepEqual(JSON.parse(request.postData()), { country: 'USA', phoneNumber: '12025550123', source: 'fixture.test' });
      if (createRequests === 2) return request.respond({ status: 503, headers, body: JSON.stringify({ error: 'Fixture baseline provider failure' }) });
      body = {
        id: `fixture-${createRequests}`, status: 'pending', country: 'USA', phoneNumber: '12025550123', source: 'fixture.test',
        marker: `fixture-marker-${createRequests}`, messageText: `Number API fixture-marker-${createRequests} code 123456`, expectedOtp: '123456',
        createdAt: Date.now(), expiresAt: Date.now() + (createRequests === 3 ? 600 : 60000), baselineRead: diagnostics()
      };
      probes.set(body.id, body);
    } else if (url.pathname.startsWith('/api/delivery-tests/')) {
      probeRequests += 1;
      const id = url.pathname.split('/').at(-1);
      const previous = probes.get(id);
      if (id === 'fixture-5') return request.respond({ status: 503, headers, body: JSON.stringify({ error: 'Fixture provider poll failed', probe: { ...previous, lastError: { at: Date.now(), statusCode: 503, message: 'Provider inbox read failed' } } }) });
      body = id === 'fixture-3' ? { ...previous, status: 'expired', checkedAt: Date.now() } : {
        ...previous, status: 'received', checkedAt: Date.now(), receivedAt: Date.now(), currentRead: diagnostics(),
        evidence: { providerUrl: oldMessage.url, messageTimestamp: Date.now(), otpMatched: id !== 'fixture-4', messageLength: 60 }
      };
    } else {
      return request.respond({ status: 404, headers, body: JSON.stringify({ error: 'Unknown fixture route' }) });
    }
    return request.respond({ status: 200, headers, body: JSON.stringify(body) });
  });
  await page.goto(appUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.ant-card');
  assert.match(await page.title(), /Number API/);
  assert.match(await bodyText(), /USA/);
  await page.click('.ant-card');
  await page.waitForFunction(() => location.pathname === '/phones/USA');
  await page.waitForFunction(() => document.body.textContent.includes('+12025550124'));
  assert.match(await bodyText(), /Some sources failed/);
  assert.match(await bodyText(), /A listing does not confirm fresh SMS delivery/);

  await page.goto(`${appUrl}/messages/USA/fixture.test/12025550123`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.textContent.includes('Inbox readable; the provider displays no messages'));
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);
  await clickButton('Refresh');
  await page.waitForFunction(() => document.body.textContent.includes('Fixture historical message'));
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);
  assert.equal(messageRequests, 2);

  await page.type('input[aria-label="Message text filter"]', 'literal + % marker');
  await clickButton('Apply filters');
  await page.waitForFunction(() => document.body.textContent.includes('Inbox readable; no messages match these filters'));
  assert.equal(recentQuery.get('match'), 'literal + % marker');
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);

  await clickButton('Start delivery check');
  await page.waitForFunction(() => document.body.textContent.includes('Number API fixture-marker-1 code 123456'));
  assert.match(await bodyText(), /This check does not send an SMS/);
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);
  await clickButton('Check now');
  await page.waitForFunction(() => document.body.textContent.includes('OTP extraction verified for this check'));
  assert.match(await bodyText(), /Fresh test message observed/);

  await clickButton('Start another delivery check');
  await page.waitForFunction(() => document.body.textContent.includes('Fixture baseline provider failure'));
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);
  await clickButton('Start delivery check');
  await page.waitForFunction(() => document.body.textContent.includes('No matching fresh SMS was observed before this check expired'));
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);

  await clickButton('Start another delivery check');
  await page.waitForFunction(() => document.body.textContent.includes('Number API fixture-marker-4 code 123456'));
  await clickButton('Stop checking');
  assert.match(await bodyText(), /Automatic checking is stopped/);
  await clickButton('Check now');
  await page.waitForFunction(() => document.body.textContent.includes('OTP extraction is not verified'));
  assert.match(await bodyText(), /Fresh test message observed/);
  assert.doesNotMatch(await bodyText(), /OTP extraction verified for this check/);
  await clickButton('Start another delivery check');
  await page.waitForFunction(() => document.body.textContent.includes('Number API fixture-marker-5 code 123456'));
  await clickButton('Check now');
  await page.waitForFunction(() => document.body.textContent.includes('Fixture provider poll failed'));
  assert.match(await bodyText(), /Provider inbox read failed \(503\)/);
  assert.match(await bodyText(), /Fresh SMS delivery is unverified/);
  assert.equal(createRequests, 5);
  assert.equal(probeRequests, 4);
  assert.deepEqual(errors, []);
  console.log('UI fixture browser smoke passed: listing pagination/errors, readable-empty vs no-match/history, literal filter encoding, controlled pending/observed/expired/error states, stop/resume, and OTP extraction failure. No carrier delivery was tested.');
} finally {
  await browser.close();
}
