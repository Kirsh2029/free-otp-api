import assert from 'node:assert/strict';
import test from 'node:test';
import { endpoints } from '../src/api/endpoints.ts';
import { extractMessages, inboxStatus, newestMessageTimestamp } from '../src/pages/phone-messages/status.ts';
import type { InboxDiagnostics } from '../src/types.ts';

const diagnostics: InboxDiagnostics = {
  providerUrl: 'https://provider.test/inbox', readAt: '2026-11-05T20:00:00.000Z', readDurationMs: 20,
  rawRowCount: 2, parseDrops: 0, droppedTimestampCount: 0, droppedMessageCount: 0,
  observedMessageCount: 2, matchedMessageCount: 0, returnedMessageCount: 0,
  timeFilteredCount: 1, matcherFilteredCount: 1, page: 1, pollCount: 1,
  newestMessageAt: 1793900000000, oldestMessageAt: 1793800000000,
  emptyInbox: false, deliveryStatus: 'unverified'
};
const oldMessage = { ago: 1577836800000, agoText: 'old message', message: 'Historical test content', url: 'https://provider.test/inbox' };

test('an empty match list with observed history is explained as filtered, not an empty or verified inbox', () => {
  const status = inboxStatus({ results: [], diagnostics });
  assert.equal(status.kind, 'filtered');
  assert.match(status.description, /2 messages.*1 fall outside.*1 do not match/);
  assert.equal(newestMessageTimestamp({ results: [], diagnostics }), diagnostics.newestMessageAt);
});
test('empty provider inbox and older API response with no read evidence remain distinct', () => {
  assert.equal(inboxStatus({ results: [], diagnostics: { ...diagnostics, observedMessageCount: 0, emptyInbox: true } }).kind, 'empty');
  assert.equal(inboxStatus({ results: [] }).kind, 'unknown');
});
test('historical messages and legacy single-result replies are visible without claiming new delivery', () => {
  const response = { result: oldMessage, results: [] };
  assert.deepEqual(extractMessages(response), [oldMessage]);
  assert.equal(inboxStatus(response).kind, 'matched');
  assert.match(inboxStatus(response).description, /does not verify/);
});
test('message endpoints encode literal filters once and preserve explicit since=0', () => {
  const relative = new URL(endpoints.phoneMessages('UK', '+447700900123', 'anonymsms.com', 2, { ago: '5m', match: 'literal + % marker' }), 'https://api.test');
  assert.equal(relative.pathname, '/UK/%2B447700900123');
  assert.equal(relative.searchParams.get('match'), 'literal + % marker');
  assert.equal(relative.searchParams.get('ago'), '5m');
  assert.equal(relative.searchParams.has('since'), false);
  const absolute = new URL(endpoints.phoneMessages('USA', '12025550123', 'receivesms.co', 1, { since: 0 }), 'https://api.test');
  assert.equal(absolute.searchParams.get('since'), '0');
});

import { readApiResponse } from '../src/api/response.ts';

test('gateway HTML and API failures remain failures instead of being interpreted as empty inboxes', async () => {
  await assert.rejects(readApiResponse(new Response('<html>Gateway failure</html>', { status: 502 })), /API request failed \(502\)/);
  await assert.rejects(readApiResponse(new Response('not json', { status: 200 })), /invalid JSON/);
  await assert.rejects(readApiResponse(new Response(JSON.stringify({ error: 'Provider timestamp parsing failed' }), { status: 503 })), /Provider timestamp parsing failed/);
});
