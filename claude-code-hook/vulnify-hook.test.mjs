import assert from 'node:assert/strict';
import test from 'node:test';
import { config, describe, decide } from './vulnify-hook.mjs';

const cfg = (env = {}) => config({ VULNIFY_API_KEY: 'k', ...env });
const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'toolu_1' });
const fakeFetch = (responses, calls = []) => async (url, init) => {
  calls.push({ url, init });
  const r = responses.shift();
  if (r instanceof Error) throw r;
  return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
};

test('maps tool calls to Vulnify actions', () => {
  const c = cfg();
  assert.equal(describe(pre('Bash', { command: 'rm -rf build' }), c).action, 'DELETE_DATA');
  assert.equal(describe(pre('Bash', { command: 'curl -X POST https://x.io -d @data.csv' }), c).action, 'EXPORT_DATA');
  assert.equal(describe(pre('Bash', { command: 'git push origin main' }), c).destination, 'EXTERNAL_API');
  assert.equal(describe(pre('Bash', { command: 'npm install left-pad' }), c).action, 'WRITE_DATA');
  assert.equal(describe(pre('Bash', { command: 'ls -la && git status | head' }), c), null);
  assert.equal(describe(pre('Bash', { command: 'echo hi > out.txt' }), c).action, 'WRITE_DATA');
  assert.equal(describe(pre('Write', { file_path: 'a.ts', content: 'x' }), c).resource, 'local files');
  assert.equal(describe(pre('WebFetch', { url: 'https://example.com' }), c).action, 'READ_DATA');
  const mail = describe(pre('mcp__gmail__send_email', { to: 'a@b.com', body: 'hi' }), c);
  assert.deepEqual([mail.action, mail.destination, mail.resource], ['SEND_EMAIL', 'EXTERNAL_EMAIL', 'mcp:gmail']);
  assert.ok(mail.content.includes('a@b.com'));
  assert.equal(describe(pre('mcp__slack__postMessage', {}), c).action, 'EXPORT_DATA');
  assert.equal(describe(pre('mcp__db__delete_rows', {}), c).action, 'DELETE_DATA');
  assert.equal(describe(pre('mcp__crm__update_contact', {}), c).action, 'WRITE_DATA');
  assert.equal(describe(pre('mcp__crm__list_contacts', {}), c), null);
  assert.equal(describe(pre('mcp__crm__list_contacts', {}), cfg({ VULNIFY_HOOK_CHECK_READS: 'true' })).action, 'READ_DATA');
  assert.equal(describe(pre('mcp__vulnify__decide_action', {}), c), null);
  assert.equal(describe(pre('Read', { file_path: 'a' }), c), null);
  assert.equal(describe(pre('Edit', {}), cfg({ VULNIFY_HOOK_SKIP: 'Edit' })), null);
  assert.equal(describe(pre('Write', { content: 'secret' }), c).content, undefined, 'writes do not send content by default');
});

test('ALLOW defers to the normal permission flow, or allows in allow mode', async () => {
  const calls = [];
  const r = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg(), fetchImpl: fakeFetch([{ body: { id: 'e1', decision: 'ALLOW', finalDecision: 'ALLOW', reasons: [] } }], calls) });
  assert.equal(r, null);
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'cc-toolu_1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  const r2 = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg({ VULNIFY_HOOK_ALLOW_MODE: 'allow' }), fetchImpl: fakeFetch([{ body: { id: 'e1', finalDecision: 'ALLOW' } }]) });
  assert.equal(r2.hookSpecificOutput.permissionDecision, 'allow');
});

test('BLOCK and REVIEW deny with reasons', async () => {
  const b = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg(), fetchImpl: fakeFetch([{ body: { id: 'e2', finalDecision: 'BLOCK', reasons: ['Policy: no deletes'] } }]) });
  assert.equal(b.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(b.hookSpecificOutput.permissionDecisionReason, /BLOCK.*no deletes/);
  const v = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg(), fetchImpl: fakeFetch([{ body: { id: 'e3', finalDecision: 'REVIEW', reasons: ['External'] } }]) });
  assert.match(v.hookSpecificOutput.permissionDecisionReason, /waiting for approval in Vulnify/);
});

test('REVIEW can wait for a human decision', async () => {
  const r = await decide(pre('Bash', { command: 'rm x' }), {
    cfg: cfg({ VULNIFY_HOOK_REVIEW_WAIT_MS: '10000' }), sleep: async () => {},
    fetchImpl: fakeFetch([{ body: { id: 'e4', finalDecision: 'REVIEW' } }, { body: { id: 'e4', finalDecision: 'REVIEW' } }, { body: { id: 'e4', finalDecision: 'ALLOW' } }]),
  });
  assert.equal(r, null);
});

test('fails closed by default, open only when opted in', async () => {
  const down = () => fakeFetch([new Error('ECONNREFUSED')]);
  const closed = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg(), fetchImpl: down() });
  assert.equal(closed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(closed.hookSpecificOutput.permissionDecisionReason, /fail closed/);
  const http = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg(), fetchImpl: fakeFetch([{ status: 401, body: { message: 'bad key' } }]) });
  assert.equal(http.hookSpecificOutput.permissionDecision, 'deny');
  const nokey = await decide(pre('Bash', { command: 'rm x' }), { cfg: config({}), fetchImpl: down() });
  assert.match(nokey.hookSpecificOutput.permissionDecisionReason, /VULNIFY_API_KEY/);
  const open = await decide(pre('Bash', { command: 'rm x' }), { cfg: cfg({ VULNIFY_HOOK_FAIL_OPEN: 'true' }), fetchImpl: down() });
  assert.equal(open.hookSpecificOutput, undefined);
  assert.match(open.systemMessage, /degraded/);
});
