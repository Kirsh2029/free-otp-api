import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiConfig } from '../src/api/config.ts';

test('frontend config has an independent deployment default and trims trailing slashes', () => {
  assert.equal(resolveApiConfig({}).baseUrl, 'https://number-api.inboxcloudkit.xyz/api');
  assert.equal(resolveApiConfig({ VITE_API_BASE_URL: 'https://example.test/api///' }).baseUrl, 'https://example.test/api');
});
test('frontend new config wins over legacy host config', () => {
  assert.equal(resolveApiConfig({ VITE_API_BASE_URL: 'https://example.test/api', REACT_APP_API_HOST: 'localhost:3030' }).baseUrl, 'https://example.test/api');
  assert.equal(resolveApiConfig({ REACT_APP_API_HOST: 'localhost:3030', REACT_APP_API_PROTOCOL: 'http' }).baseUrl, 'http://localhost:3030/api');
});
test('frontend config rejects malformed and credential-bearing URLs', () => {
  for (const value of ['bad', 'ftp://example.test/api', 'https://user:secret@example.test/api', 'https://example.test/api?token=secret', 'https://example.test/api#frag']) {
    assert.throws(() => resolveApiConfig({ VITE_API_BASE_URL: value }));
  }
});

import { formatPhoneNumberForDisplay, transformPhoneRecords } from '../src/pages/phones/components/helpers.ts';

test('phone display preserves international calling codes without duplicating plus or NANP code', () => {
  assert.equal(formatPhoneNumberForDisplay('USA', '+12025550123'), '+12025550123');
  assert.equal(formatPhoneNumberForDisplay('USA', '2025550123'), '+12025550123');
  assert.equal(formatPhoneNumberForDisplay('UK', '+447700900123'), '+447700900123');
});
test('phone grouping retains sources before client pagination', () => {
  const records = transformPhoneRecords([
    { value: '+12025550123', source: 'one', url: 'https://one.test/inbox' },
    { value: '+12025550123', source: 'two', url: 'https://two.test/inbox' }
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].sources.length, 2);
});
