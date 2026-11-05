// Run after `npm --prefix ui run build` and `npm --prefix ui run preview`.
// This browser regression uses deterministic HTTP fixtures, not live SMS providers.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const appUrl = process.env.UI_SMOKE_URL || 'http://127.0.0.1:4173';
const apiOrigin = 'https://number-api.inboxcloudkit.xyz';
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {})
});
const errors = [];
const page = await browser.newPage();
let messageRequests = 0;
try {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (url.origin !== apiOrigin) return request.continue();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
    let body;
    if (url.pathname === '/api/countries') {
      body = [{ country: 'USA', source: 'fixture.test', url: 'https://fixture.test/country/usa', count: 0 }];
    } else if (url.pathname === '/api/list/USA') {
      const pageNumber = Number(url.searchParams.get('page') || 1);
      body = { phones: [{ value: pageNumber === 1 ? '+12025550123' : '+12025550124', source: pageNumber === 1 ? 'fixture.test' : 'second.test', url: 'https://fixture.test/inbox/12025550123' }], errors: [{ source: 'failed.test', error: 'Upstream fixture failure' }], pagination: { page: pageNumber, limit: 1, total: 2, hasMore: pageNumber === 1 } };
    } else if (url.pathname === '/api/USA/+12025550123' || url.pathname === '/api/USA/12025550123') {
      messageRequests += 1;
      body = messageRequests === 1 ? { result: null, results: [] } : { result: { ago: 60, agoText: '1 minute ago', message: 'Fixture verification message', url: 'https://fixture.test/inbox/12025550123' }, results: [{ ago: 60, agoText: '1 minute ago', message: 'Fixture verification message', url: 'https://fixture.test/inbox/12025550123' }] };
    } else {
      return request.respond({ status: 404, headers, body: JSON.stringify({ error: 'Unknown fixture route' }) });
    }
    return request.respond({ status: 200, headers, body: JSON.stringify(body) });
  });
  await page.goto(appUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.ant-card');
  assert.match(await page.title(), /Number API/);
  assert.match(await page.locator('body').wait().then(() => page.$eval('body', (element) => element.textContent)), /USA/);
  await page.click('.ant-card');
  await page.waitForFunction(() => location.pathname === '/phones/USA');
  await page.waitForFunction(() => document.body.textContent.includes('+12025550123'));
  await page.waitForFunction(() => document.body.textContent.includes('+12025550124'));
  assert.match(await page.$eval('body', (element) => element.textContent), /Some sources failed/);
  await page.goto(`${appUrl}/messages/USA/fixture.test/12025550123`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.textContent.includes('No data'));
  const buttons = await page.$$('button');
  for (const button of buttons) {
    if ((await button.evaluate((element) => element.textContent)).includes('Refresh')) { await button.click(); break; }
  }
  await page.waitForFunction(() => document.body.textContent.includes('Fixture verification message'));
  assert.equal(messageRequests, 2);
  assert.deepEqual(errors, []);
  console.log('UI browser smoke passed: country count0 visible, all API listing pages/source warning, empty inbox refresh, single message rendered, no browser errors.');
} finally {
  await browser.close();
}
