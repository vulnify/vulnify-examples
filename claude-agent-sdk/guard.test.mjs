import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, vulnifyCanUseTool } from './guard.mjs';

test('maps email and rm to valid Vulnify actions', () => {
  assert.equal(describe('mcp__mail__send_email', { to: 'a@acme.internal' }).destination, 'INTERNAL');
  assert.equal(describe('mcp__mail__send_email', { to: 'a@gmail.com' }).destination, 'EXTERNAL_EMAIL');
  assert.equal(describe('Bash', { command: 'rm -rf x' }).action, 'DELETE_DATA');
  assert.equal(describe('Bash', { command: 'ls' }), null);
});

test('denies unless Vulnify allows, never calling Vulnify for unmapped tools', async () => {
  const calls = [];
  const fake = { check: async (a) => { calls.push(a); return { id: 'e1', decision: a.action === 'DELETE_DATA' ? 'REVIEW' : 'ALLOW', reasons: ['test'] }; } };
  const can = vulnifyCanUseTool(fake);
  const signal = new AbortController().signal;
  assert.equal((await can('Bash', { command: 'rm a' }, { signal })).behavior, 'deny');
  assert.equal((await can('mcp__mail__send_email', { to: 'x@acme.internal' }, { signal })).behavior, 'allow');
  assert.equal((await can('Read', { file_path: 'a' }, { signal })).behavior, 'allow');
  assert.equal(calls.length, 2);
});
