import assert from 'node:assert/strict';
import test from 'node:test';
import { ask, describe } from './gate.mjs';

test('describes tool calls with valid destinations', () => {
  assert.equal(describe('export_customers', { to: 'a@b.com', count: 800 }, {}).destination, 'EXTERNAL_EMAIL');
  assert.equal(describe('export_customers', { to: 'a@acme.internal' }, { INTERNAL_EMAIL_DOMAIN: 'acme.internal' }).destination, 'INTERNAL');
  assert.equal(describe('delete_customers', { count: 3 }, {}).recordsAffected, 3);
});

test('forwards only on ALLOW and fails closed', async () => {
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  assert.equal((await ask('x', {}, { apiKey: 'k', fetchImpl: reply(200, { id: 'e', decision: 'ALLOW', reasons: [] }) })).allowed, true);
  assert.equal((await ask('x', {}, { apiKey: 'k', fetchImpl: reply(200, { id: 'e', decision: 'REVIEW', finalDecision: 'REVIEW', reasons: [] }) })).allowed, false);
  assert.equal((await ask('x', {}, { apiKey: 'k', fetchImpl: reply(401, { message: 'bad key' }) })).allowed, false);
  assert.equal((await ask('x', {}, { apiKey: 'k', fetchImpl: async () => { throw new Error('down'); } })).decision, 'BLOCK');
});
