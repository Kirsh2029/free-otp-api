import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterUniquePhones, normalizePhoneNumber, tryParseOtpCode } from '../src/providers/helpers.js';
import { parseTimeAgo, stringifyTriggerOtpTimeDiff, waitFor } from '../src/time/utils.js';

test('phone normalization retains country calling codes and accepts national formatting', () => {
  for (const [phone, country, expected] of [
    ['(202) 555-0100', 'USA', '12025550100'],
    ['+1 202 555 0100', 'USA', '12025550100'],
    ['12025550100', 'USA', '12025550100'],
    ['0044 7700 900123', 'UK', '447700900123'],
    ['07700 900123', 'UK', '447700900123'],
    ['+49 1512 3456789', 'Germany', '4915123456789'],
    ['+380 67 123 4567', 'Ukraine', '380671234567'],
    ['+39 06 6982', 'Italy', '39066982']
  ]) assert.equal(normalizePhoneNumber(phone, country), expected);
});

test('phone normalization rejects malformed, oversized, and country-mismatched values', () => {
  for (const phone of ['abc12345678', '++12025550100', '2025550100?x=y', '123', '+12345678901234567890', '+447700900123']) {
    assert.throws(() => normalizePhoneNumber(phone, 'USA'));
  }
  assert.throws(() => normalizePhoneNumber('12025550100', 'Unknown'));
});

test('OTP parsing avoids taking partial codes from long phone or tracking numbers', () => {
  assert.equal(tryParseOtpCode('Your code is 123456.'), '123456');
  assert.equal(tryParseOtpCode('Code: 0000'), '0000');
  assert.equal(tryParseOtpCode('Phone 12025550100; code 9876'), '9876');
  assert.equal(tryParseOtpCode('Tracking 123456789012'), undefined);
  assert.equal(tryParseOtpCode('No numeric code'), undefined);
});

test('deduplication treats differently formatted numbers as the same phone', () => {
  assert.deepEqual(filterUniquePhones([
    { phone: '+1 202 555 0100', url: 'https://example.test/1' },
    { phone: '12025550100', url: 'https://example.test/2' },
    { phone: '447700900123', url: 'https://example.test/3' }
  ]).map((entry) => entry.url), ['https://example.test/1', 'https://example.test/3']);
});

test('relative timestamps support multiple units without inventing fresh timestamps', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  assert.equal(parseTimeAgo('30s', now), now - 30_000);
  assert.equal(parseTimeAgo('2 minutes ago', now), now - 120_000);
  assert.equal(parseTimeAgo('1h 30m ago', now), now - 5_400_000);
  assert.equal(parseTimeAgo('an hour ago', now), now - 3_600_000);
  assert.equal(parseTimeAgo('Just now', now), now);
  assert.equal(parseTimeAgo('yesterday', now), now - 86_400_000);
  assert.equal(parseTimeAgo('2026-11-05T11:00:00Z', now), now - 3_600_000);
  assert.equal(parseTimeAgo('2030-01-01T00:00:00Z', now), 0);
  assert.equal(parseTimeAgo('unknown timestamp', now), 0);
  assert.equal(parseTimeAgo('1', now), 0);
  assert.equal(parseTimeAgo(undefined, now), 0);
});

test('time descriptions do not round a few seconds into hours and years', () => {
  assert.equal(stringifyTriggerOtpTimeDiff(Date.now() - 61_000), '1m 1s');
});

test('condition waiting has a finite timeout', async () => {
  await assert.rejects(waitFor(() => false, 1), /Timed out/);
});
