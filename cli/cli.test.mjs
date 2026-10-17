import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { install, uninstall } from './bin/vulnify-cli.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'vcli-'));
const KEY = 'vln_test_supersecret_123';

test('project install: hook + settings, key in git-ignored settings.local.json, never logged', async () => {
  const cwd = tmp();
  mkdirSync(join(cwd, '.git'));
  mkdirSync(join(cwd, '.claude'));
  writeFileSync(join(cwd, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] } }));
  const logs = [];
  await install({ user: false, cwd, home: tmp(), env: {}, interactive: true, prompt: async () => KEY, log: (s) => logs.push(s) });
  const s = JSON.parse(readFileSync(join(cwd, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.equal(s.hooks.PreToolUse[1].hooks[0].onFailure, 'block');
  assert.ok(!JSON.stringify(s).includes(KEY), 'key not in committed settings');
  const local = JSON.parse(readFileSync(join(cwd, '.claude/settings.local.json'), 'utf8'));
  assert.equal(local.env.VULNIFY_API_KEY, KEY);
  // Windows has no POSIX file modes.
  if (process.platform !== 'win32') assert.equal(statSync(join(cwd, '.claude/settings.local.json')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\.claude\/settings\.local\.json/);
  assert.ok(existsSync(join(cwd, '.claude/hooks/vulnify-hook.mjs')));
  assert.ok(!logs.join('\n').includes(KEY), 'key never printed');
  // Re-install is idempotent.
  await install({ user: false, cwd, home: tmp(), env: {}, prompt: async () => 'x', log: () => {} });
  assert.equal(JSON.parse(readFileSync(join(cwd, '.claude/settings.json'), 'utf8')).hooks.PreToolUse.length, 2);

  uninstall({ user: false, cwd, log: () => {} });
  const after = JSON.parse(readFileSync(join(cwd, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(after.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }]);
  assert.equal(JSON.parse(readFileSync(join(cwd, '.claude/settings.local.json'), 'utf8')).env, undefined);
  assert.ok(!existsSync(join(cwd, '.claude/hooks/vulnify-hook.mjs')));
});

test('user install with key from env saves no key', async () => {
  const home = tmp();
  await install({ user: true, cwd: tmp(), home, env: { VULNIFY_API_KEY: KEY }, log: () => {} });
  const raw = readFileSync(join(home, '.claude/settings.json'), 'utf8');
  assert.ok(!raw.includes(KEY));
  assert.ok(JSON.parse(raw).hooks.PreToolUse[0].hooks[0].args[0].startsWith(home));
});

test('--yes without a key fails without changing anything', async () => {
  const cwd = tmp();
  await assert.rejects(install({ user: false, yes: true, cwd, home: tmp(), env: {}, log: () => {} }), /VULNIFY_API_KEY/);
  assert.ok(!existsSync(join(cwd, '.claude')));
});
