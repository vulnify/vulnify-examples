import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describe } from './vulnify-hook.mjs';
import { SCENARIOS, demoConfig, mockFetch, runScenario, summarize } from './demo.mjs';

test('the three tool calls are ALLOW, REVIEW, and BLOCK', async () => {
  const calls = [];
  const cfg = demoConfig({ VULNIFY_HOOK_CHECK_READS: 'true' });
  cfg.apiKey = 'mock';
  const fetchImpl = mockFetch(calls);
  const lines = [];
  for (const scenario of SCENARIOS) {
    const outcome = await runScenario(scenario, { cfg, fetchImpl });
    lines.push(summarize(outcome.body, outcome.result));
  }
  assert.deepEqual(calls.map((body) => body.action), ['READ_DATA', 'EXPORT_DATA', 'DELETE_DATA']);
  assert.equal(calls[1].recordsAffected, 800);
  assert.equal(calls[1].destination, 'EXTERNAL_API');
  assert.match(calls[2].content, /DROP DATABASE production/);
  assert.match(lines[0], /^ALLOW/);
  assert.match(lines[1], /Vulnify REVIEW/);
  assert.match(lines[1], /800/);
  assert.match(lines[2], /Vulnify BLOCK/);
});

test('a read-only command is skipped unless reads are checked', () => {
  const input = SCENARIOS[0].input;
  assert.equal(describe(input, demoConfig({ VULNIFY_HOOK_CHECK_READS: 'false' })), null);
  assert.equal(describe(input, demoConfig({ VULNIFY_HOOK_CHECK_READS: 'true' })).action, 'READ_DATA');
});

test('the PreToolUse config points at the hook and has no key', () => {
  const settings = JSON.parse(readFileSync(new URL('./.claude/settings.json', import.meta.url), 'utf8'));
  const hook = settings.hooks.PreToolUse[0];
  assert.match(hook.matcher, /Bash/);
  assert.equal(hook.hooks[0].command, 'node');
  assert.match(hook.hooks[0].args[0], /vulnify-hook\.mjs/);
  assert.equal(hook.hooks[0].onFailure, 'block');
  assert.equal(JSON.stringify(settings).includes('vln_'), false);
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('.env')));
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('.ssh')));
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('.aws')));
});
