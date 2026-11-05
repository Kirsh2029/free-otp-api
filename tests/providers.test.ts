import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import type { Page } from 'puppeteer';
import { Source, Sources, providers, type Provider, type PhoneNumberListReply, type MessageReadDiagnostics } from '../src/providers/index.js';
import { browser } from '../src/browser/cluster.js';
import { getReceiveSmsCoPhones } from '../src/providers/receivesms.co/handler.js';
import { config } from '../src/config.js';
import { getPhonesListTask } from '../src/providers/getPhonesListTask.js';
import { assertProviderUrl, convertMessages, inboxPage, parseMessageRows, parseProviderTimestamp, pollMessages, ProviderError, waitForInboxReady } from '../src/providers/runtime.js';

const page = { isClosed: () => false, url: () => 'https://receive-sms-free.cc/inbox/' } as unknown as Page;
const provider: Provider = {
  ...Sources[Source.ReceiveSmsFree],
  getPhonesList: async () => ({ phones: [] })
};

test('every historical provider remains registered with explicit status and an HTTPS base URL', () => {
  assert.deepEqual(Object.keys(Sources).sort(), Object.values(Source).sort());
  for (const [source, entry] of Object.entries(Sources)) {
    assert.equal(entry.name, source);
    assert.equal(new URL(entry.baseUrl).protocol, 'https:');
    assert.ok(entry.statusReason);
    assert.equal(providers.includes(entry), entry.enabled);
  }
  assert.equal(Sources[Source.ReceiveSmsOnlineCom].baseUrl, 'https://receiveasmsonline.com');
  assert.equal(Sources[Source.AnonymSms].baseUrl, 'https://asms.ai');
  assert.equal(Sources[Source.QuackrIo].enabled, false);
});

test('pagination URL validation prevents leaving a provider origin or embedding credentials', () => {
  const origins = ['https://receive-sms-free.cc'];
  assert.equal(assertProviderUrl('https://receive-sms-free.cc/page/2', origins), 'https://receive-sms-free.cc/page/2');
  for (const url of ['http://127.0.0.1/internal', 'https://receive-sms-free.cc.evil.test/', 'https://user:password@receive-sms-free.cc/', 'not a URL']) {
    assert.throws(() => assertProviderUrl(url, origins), ProviderError);
  }
});

test('listing failures propagate instead of becoming a successful empty cache refresh', async () => {
  const stub = mock.method(browser, 'execute', async () => { throw new ProviderError('Temporarily unavailable', 503); });
  try {
    await assert.rejects(getPhonesListTask('USA', provider), /Temporarily unavailable/);
    assert.equal(stub.mock.callCount(), 1);
  } finally { stub.mock.restore(); }
});

test('listing pagination collects and deduplicates real phone identifiers', async () => {
  const replies: PhoneNumberListReply[] = [
    { phones: [{ phone: '12543207600', url: 'https://receive-sms-free.cc/Free-USA-Phone-Number/12543207600/' }], nextPageUrl: 'https://receive-sms-free.cc/Free-USA-Phone-Number/2.html' },
    { phones: [{ phone: '12543207600', url: 'https://receive-sms-free.cc/Free-USA-Phone-Number/12543207600/' }, { phone: '12543207599', url: 'https://receive-sms-free.cc/Free-USA-Phone-Number/12543207599/' }] }
  ];
  const stub = mock.method(browser, 'execute', async () => replies.shift());
  try {
    const result = await getPhonesListTask('USA', provider);
    assert.deepEqual(result.map((entry) => entry.phone), ['12543207600', '12543207599']);
    assert.equal(stub.mock.callCount(), 2);
  } finally { stub.mock.restore(); }
});

test('listing pagination loops fail promptly and configured page bounds are enforced', async () => {
  const reply: PhoneNumberListReply = { phones: [{ phone: '12543207600', url: 'https://receive-sms-free.cc/number/' }], nextPageUrl: 'https://receive-sms-free.cc/page/2' };
  const stub = mock.method(browser, 'execute', async () => reply);
  const saved = config.maxProviderPages;
  try {
    await assert.rejects(getPhonesListTask('USA', provider), /repeated a pagination URL/);
    config.maxProviderPages = 1;
    await assert.rejects(getPhonesListTask('USA', provider), /exceeds MAX_PROVIDER_PAGES/);
  } finally { config.maxProviderPages = saved; stub.mock.restore(); }
});

test('disabled provider selection fails before starting a browser', async () => {
  await assert.rejects(getPhonesListTask('USA', Sources[Source.QuackrIo]), /disabled/);
});

test('absolute inbox timestamps retain milliseconds and malformed rows are ignored', () => {
  const messages = convertMessages([
    { agoText: 'Nov 4', timestamp: '2026-11-04T23:17:31.172Z', message: 'Synthetic test code 012345' },
    { agoText: 'invalid', message: 'Not a timestamp' },
    { agoText: 'future', timestamp: new Date(Date.now() + 3_600_000).toISOString(), message: 'Future message' },
    { agoText: '1 minute ago', message: '' }
  ], page.url());
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ago, Date.parse('2026-11-04T23:17:31.172Z'));
});

test('single inbox pass applies time and text matching, extracts zero-prefixed OTP and limits results', async () => {
  const result = await pollMessages(page, {
    country: 'USA', phoneNumber: '12543207600', matcher: ['test'], askedOtpAt: 200, timeoutMs: 0, limit: 1
  }, async () => [
    { ago: 100, agoText: 'old', message: 'test code 1234', url: page.url() },
    { ago: 300, agoText: 'new', message: 'test code 012345', url: page.url() },
    { ago: 400, agoText: 'newer', message: 'other code 2345', url: page.url() }
  ], ['https://receive-sms-free.cc']);
  assert.equal(result.length, 1);
  assert.equal(result[0].otp, '012345');
  assert.deepEqual(await pollMessages(page, {
    country: 'USA', phoneNumber: '12543207600', matcher: 'absent', timeoutMs: 0
  }, async () => [], ['https://receive-sms-free.cc']), []);
});

test('provider-specific inbox pagination preserves valid URLs', () => {
  assert.equal(inboxPage('https://receive-sms-free.cc/phone/', 2, 'html'), 'https://receive-sms-free.cc/phone/2.html');
  assert.equal(inboxPage('https://asms.ai/number/447480750178', 2, 'asms'), 'https://asms.ai/number/447480750178/page/2');
  assert.equal(inboxPage('https://smstome.com/phone?view=messages', 2), 'https://smstome.com/phone?view=messages&page=2');
});


test('untrusted listing content cannot whitelist its own pagination host', async () => {
  const stub = mock.method(browser, 'execute', async () => ({
    phones: [{ phone: '12543207600', url: 'http://127.0.0.1/internal' }],
    nextPageUrl: 'http://127.0.0.1/internal?page=2'
  }));
  try { await assert.rejects(getPhonesListTask('USA', provider), /unexpected URL/); }
  finally { stub.mock.restore(); }
});

test('the overall listing deadline cancels the browser task and does not retry', async () => {
  const previous = config.browser.taskTimeoutMs;
  config.browser.taskTimeoutMs = 20;
  const stub = mock.method(browser, 'execute', async (_data, _task, options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
  }));
  try {
    await assert.rejects(getPhonesListTask('USA', provider), (error: unknown) => error instanceof ProviderError && error.statusCode === 504);
    assert.equal(stub.mock.callCount(), 1);
  } finally { config.browser.taskTimeoutMs = previous; stub.mock.restore(); }
});


test('ReceiveSMS explicit empty next page terminates pagination while initial empty inventory is an error', async () => {
  const emptyPage = {
    goto: async () => ({ status: () => 200 }),
    url: () => 'https://www.receivesms.co/us-phone-numbers/US/5/',
    title: async () => 'Free US Temporary Phone Numbers',
    waitForSelector: async () => undefined,
    $eval: async () => true
  } as unknown as Page;
  assert.deepEqual(await getReceiveSmsCoPhones(emptyPage, 'USA', emptyPage.url()), { phones: [] });
  await assert.rejects(getReceiveSmsCoPhones(emptyPage, 'USA'), (error: unknown) => error instanceof ProviderError && error.statusCode === 503);
});

test('provider metadata separates historical inbox reads from controlled fresh delivery', () => {
  for (const entry of Object.values(Sources)) {
    assert.ok(entry.verification?.listing);
    assert.ok(entry.verification?.inboxRead);
    assert.equal(entry.verification?.freshSmsDelivery.status, 'unverified');
  }
});

test('provider absolute timestamps have deterministic UTC semantics and reject calendar rollovers', () => {
  const now = Date.UTC(2026, 10, 5, 20);
  assert.equal(parseProviderTimestamp('2026-11-05 17:32:21', now), Date.UTC(2026, 10, 5, 17, 32, 21));
  assert.equal(parseProviderTimestamp('2026/11/05 17:32', now), Date.UTC(2026, 10, 5, 17, 32));
  assert.equal(parseProviderTimestamp('2026 11 05 - 17:32', now), Date.UTC(2026, 10, 5, 17, 32));
  assert.equal(parseProviderTimestamp('2026-11-05T19:32:21+02:00', now), Date.UTC(2026, 10, 5, 17, 32, 21));
  assert.equal(parseProviderTimestamp('2026-02-31 17:32:21', now), 0);
  assert.equal(parseProviderTimestamp('2026-11-05 25:32:21', now), 0);
  assert.equal(parseProviderTimestamp('2026-11-05 23:32:21', now), 0);
  assert.equal(parseProviderTimestamp('2 min. ago', now), now - 120_000);
  assert.equal(parseProviderTimestamp('unrecognized time', now), 0);
});

test('read diagnostics count actual parse drops and distinguish filters from an empty inbox', async () => {
  let diagnostics: MessageReadDiagnostics | undefined;
  const rows = parseMessageRows([
    { agoText: '2026-11-05 10:00:00', message: 'old code 1234' },
    { agoText: '2026-11-05 11:00:00', message: 'test code 012345' },
    { agoText: '2026-11-05 11:30:00', message: 'different message' },
    { agoText: 'unrecognized', message: 'bad timestamp' },
    { agoText: '1 minute ago', message: '' }
  ], page.url(), Date.UTC(2026, 10, 5, 12));
  const matches = await pollMessages(page, {
    country: 'USA', phoneNumber: '12025550100', matcher: 'test', askedOtpAt: Date.UTC(2026, 10, 5, 10, 30), timeoutMs: 0,
    onRead: (value) => { diagnostics = value; }
  }, async () => rows, ['https://receive-sms-free.cc']);
  assert.equal(matches.length, 1);
  assert.equal(diagnostics?.rawRowCount, 5);
  assert.equal(diagnostics?.parseDrops, 2);
  assert.equal(diagnostics?.droppedTimestampCount, 1);
  assert.equal(diagnostics?.droppedMessageCount, 1);
  assert.equal(diagnostics?.observedMessageCount, 3);
  assert.equal(diagnostics?.timeFilteredCount, 1);
  assert.equal(diagnostics?.matcherFilteredCount, 1);
  assert.equal(diagnostics?.matchedMessageCount, 1);
  assert.equal(diagnostics?.returnedMessageCount, 1);
  assert.equal(diagnostics?.emptyInbox, false);
  assert.equal(diagnostics?.providerUrl, page.url());
  assert.equal(diagnostics?.newestMessageAt, Date.UTC(2026, 10, 5, 11, 30));
  assert.equal(JSON.stringify(diagnostics).includes('012345'), false);
  assert.equal(JSON.stringify(diagnostics).includes('different message'), false);
});

test('a nonempty inbox with unparseable timestamps reports diagnostic evidence then fails', async () => {
  let diagnostics: MessageReadDiagnostics | undefined;
  await assert.rejects(pollMessages(page, {
    country: 'USA', phoneNumber: '12025550100', matcher: '', timeoutMs: 0, onRead: (value) => { diagnostics = value; }
  }, async () => parseMessageRows([{ agoText: 'unknown', message: 'synthetic content' }], page.url()), ['https://receive-sms-free.cc']), /no message timestamps or content could be parsed/);
  assert.equal(diagnostics?.rawRowCount, 1);
  assert.equal(diagnostics?.droppedTimestampCount, 1);
  assert.equal(diagnostics?.emptyInbox, false);
});

test('loading skeletons or missing inbox markup surface an error instead of a false empty success', async () => {
  const loadingPage = {
    isClosed: () => false,
    waitForFunction: async () => { throw new Error('Timeout'); }
  } as unknown as Page;
  await assert.rejects(waitForInboxReady(loadingPage, '.message', '.empty', 1), /did not finish loading or its message markup changed/);
});

test('legacy parsed arrays preserve results without inventing raw parser diagnostics', async () => {
  let telemetry = false;
  const result = await pollMessages(page, {
    country: 'USA', phoneNumber: '12025550100', matcher: '', timeoutMs: 0, onRead: () => { telemetry = true; }
  }, async () => [{ ago: Date.now(), agoText: 'now', message: 'synthetic test', url: page.url() }], ['https://receive-sms-free.cc']);
  assert.equal(result.length, 1);
  assert.equal(telemetry, false);
});

test('AnonymSMS excludes the USA country whose eight advertised inboxes all redirected away', () => {
  assert.equal(Sources[Source.AnonymSms].countries.includes('USA'), false);
  assert.ok(Sources[Source.AnonymSms].unavailableCountries?.USA);
  assert.equal(Sources[Source.AnonymSms].countries.includes('UK'), true);
});

test('providers that historically included senders preserve sender-based matching', async () => {
  const parsed = parseMessageRows([{ sender: 'SyntheticSender', agoText: 'now', message: 'Your code is 654321' }], page.url());
  const result = await pollMessages(page, { country: 'USA', phoneNumber: '12025550100', matcher: 'SyntheticSender', timeoutMs: 0 }, async () => parsed, ['https://receive-sms-free.cc']);
  assert.equal(result.length, 1);
  assert.equal(result[0].message, 'SyntheticSender Your code is 654321');
  assert.equal(result[0].otp, '654321');
});
