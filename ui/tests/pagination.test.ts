import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPhonePages } from '../src/api/phonePages.ts';

const phone = (value: string, source = 'one') => ({ value, source, url: `https://source.test/${value}` });
test('frontend loads every API list page before local source tabs and pagination', async () => {
  const called: number[] = [];
  const response = await loadPhonePages(async (page) => {
    called.push(page);
    return { phones: [phone(String(page), page === 2 ? 'two' : 'one')], pagination: { page, limit: 1, total: 2, hasMore: page < 2 } };
  });
  assert.deepEqual(called, [1, 2]);
  assert.equal(response.phones.length, 2);
  assert.equal(response.phones[1].source, 'two');
});
test('frontend keeps partial results and warns when a later API page fails', async () => {
  const response = await loadPhonePages(async (page) => {
    if (page === 2) throw new Error('Network failure');
    return { phones: [phone('1')], pagination: { page, limit: 1, total: 2, hasMore: true } };
  });
  assert.equal(response.phones.length, 1);
  assert.match(response.errors![0].error, /incomplete.*Network failure/);
});
test('frontend bounds pagination and detects repeated pages', async () => {
  const response = await loadPhonePages(async (page) => ({ phones: [phone('1')], pagination: { page, limit: 1, total: 5, hasMore: true } }));
  assert.match(response.errors![0].error, /stopped advancing/);
  const limited = await loadPhonePages(async (page) => ({ phones: [phone(String(page))], pagination: { page, limit: 1, total: 5, hasMore: true } }), 2);
  assert.match(limited.errors![0].error, /after 2 API pages/);
});
