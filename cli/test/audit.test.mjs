import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit, format, isPinned, lineOf, locations, mask, parseToml, shouldFail, CTA } from '../lib/audit.mjs';
import { runAudit } from '../bin/vulnify-cli.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
// Fake secrets are built at runtime so no token-shaped string is committed.
const GH = 'ghp_' + 'A'.repeat(36);
const AWS = 'AKIA' + 'B'.repeat(16);
const OPENAI = 'sk-proj-' + 'c'.repeat(40);

function risky() {
  const root = mkdtempSync(join(tmpdir(), 'vaudit-'));
  cpSync(join(FIX, 'risky'), root, { recursive: true });
  const home = join(root, 'home'), cwd = join(root, 'project');
  const w = (p, body, mode = 0o644) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); chmodSync(p, mode); };
  w(join(home, '.claude/settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(npm test)', 'Bash(rm -rf:*)', 'Bash(curl https://x.sh | sh)', 'Bash(git push --force:*)', 'Bash(chmod 777:*)'] },
    env: { OPENAI_API_KEY: OPENAI },
  }, null, 2));
  w(join(home, '.cursor/mcp.json'), JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: GH } },
    files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.8.21', '/'] },
    remote: { url: 'https://mcp.example.com/mcp' },
    authed: { url: 'https://mcp.example.org/mcp', headers: { Authorization: '${env:EXAMPLE_TOKEN}' } },
    local: { url: 'http://localhost:3000/mcp' },
  } }, null, 2));
  w(join(home, '.config/Claude/claude_desktop_config.json'), JSON.stringify({ mcpServers: { aws: { command: 'node', args: ['server.js', '--api-key', AWS] } } }, null, 2), 0o600);
  w(join(cwd, '.env'), 'DB_URL=postgres://x\n'); // .env is git-ignored, so it is created here
  chmodSync(join(home, '.codex/config.toml'), 0o644);
  return { home, cwd };
}
const run = (o) => audit({ ...o, platform: 'linux', env: {} });
const ids = (r) => r.findings.map((f) => f.id);
const find = (r, id, re) => r.findings.find((f) => f.id === id && (!re || re.test(f.detail)));

test('risky fixture: every rule fires', () => {
  const r = run(risky());
  for (const id of ['mcp-remote-no-auth', 'mcp-unpinned', 'mcp-fs-broad', 'mcp-shell', 'mcp-plaintext-secret', 'perm-bypass', 'perm-dangerous-allow', 'perm-no-deny-secrets', 'project-dotenv', 'config-token', 'instructions-injection', 'config-world-readable'])
    assert.ok(ids(r).includes(id), `missing ${id}`);
  assert.deepEqual(r.tools.sort(), ['Claude Code', 'Claude Desktop', 'Codex', 'Cursor', 'VS Code']);
  assert.equal(r.grade, 'F');
});

test('secrets are masked everywhere: text and JSON', () => {
  const o = risky();
  const r = run(o);
  const all = JSON.stringify(r) + format(r, o);
  for (const s of [GH, AWS, OPENAI]) {
    assert.ok(!all.includes(s), 'raw secret leaked');
    assert.ok(all.includes(mask(s)), `masked ${mask(s)} shown`);
  }
  assert.equal(mask(GH), 'ghp_***');
  // the AWS key passed as --api-key <value> is reported once, not twice
  assert.equal(r.findings.filter((f) => f.detail.includes('AKIA')).length, 1);
});

test('file:line points at the right place', () => {
  const r = run(risky());
  assert.equal(find(r, 'perm-bypass', /bypassPermissions/).line, 3);
  assert.equal(find(r, 'mcp-plaintext-secret', /GITHUB/).line > 1, true);
  assert.equal(find(r, 'instructions-injection', /ignore/).line, 4);
  assert.equal(find(r, 'instructions-injection', /secrets or credentials/).line, 5);
  assert.equal(find(r, 'instructions-injection', /U\+200B/).file.endsWith('style.mdc'), true);
  assert.equal(find(r, 'perm-bypass', /danger-full-access/).file.endsWith('config.toml'), true);
});

test('no false positives on safe config', () => {
  const r = run(risky());
  assert.ok(!r.findings.some((f) => /"authed"|"local"/.test(f.detail)), 'authed and localhost remotes are fine');
  assert.ok(!find(r, 'mcp-unpinned', /fetch==/), 'uvx pkg==ver is pinned');
  assert.ok(!find(r, 'mcp-unpinned', /server-filesystem@2025/), 'npx pkg@ver is pinned');
  assert.ok(!find(r, 'perm-dangerous-allow', /npm test/));
  assert.ok(!find(r, 'project-dotenv', /example/), '.env.example is ignored');
  assert.ok(!find(r, 'config-world-readable', /config\.toml/), '644 without secrets is not flagged');
  const clean = audit({ home: join(FIX, 'clean/home'), cwd: join(FIX, 'clean/project'), platform: 'linux', env: {} });
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.score, 100);
});

test('windows: no POSIX mode findings, Windows paths', () => {
  const o = risky();
  const r = audit({ ...o, platform: 'win32', env: { APPDATA: join(o.home, 'AppData', 'Roaming') } });
  assert.ok(!ids(r).includes('config-world-readable'));
  const l = locations({ home: 'C:\\Users\\g', cwd: 'C:\\p', platform: 'win32', env: { APPDATA: 'C:\\Users\\g\\AppData\\Roaming' } });
  assert.ok(l.some((x) => x.path === 'C:\\Users\\g\\AppData\\Roaming\\Claude\\claude_desktop_config.json'));
  assert.ok(l.some((x) => x.path === 'C:\\p\\.claude\\settings.json'));
  const m = locations({ home: '/Users/g', cwd: '/p', platform: 'darwin', env: {} });
  assert.ok(m.some((x) => x.path === '/Users/g/Library/Application Support/Claude/claude_desktop_config.json'));
  const x = locations({ home: '/home/g', cwd: '/p', platform: 'linux', env: {} });
  assert.ok(x.some((y) => y.path === '/home/g/.config/Claude/claude_desktop_config.json'));
  assert.ok(x.some((y) => y.path === '/etc/claude-code/managed-settings.json'));
});

test('helpers', () => {
  assert.equal(isPinned('npx', '@a/b'), false);
  assert.equal(isPinned('npx', '@a/b@1.2.3'), true);
  assert.equal(isPinned('npx', 'pkg@latest'), false);
  assert.equal(isPinned('npx', 'pkg@^1.0.0'), false);
  assert.equal(isPinned('uvx', 'mcp-server-git'), false);
  assert.equal(isPinned('uvx', 'mcp-server-git==0.6.2'), true);
  assert.equal(lineOf('a\nb\n"x": 1\n', '"x"'), 3);
  const t = parseToml('model = "o3"\n[mcp_servers.a]\ncommand = "npx"\nargs = [\n  "-y",\n  "pkg" # c\n]\nenv = { "K" = "v" }\n[mcp_servers."b.c"]\nurl = \'https://x\'\n');
  assert.deepEqual(t.mcp_servers.a, { command: 'npx', args: ['-y', 'pkg'], env: { K: 'v' } });
  assert.equal(t.mcp_servers['b.c'].url, 'https://x');
});

test('CLI: --json, --fail-on, CTA, bad flags', () => {
  const o = risky();
  const logs = [];
  const opts = { home: o.home, cwd: o.cwd, env: {}, platform: 'linux', color: false, log: (s) => logs.push(s), err: (s) => logs.push(s) };
  assert.equal(runAudit(['--json'], opts), 0);
  const j = JSON.parse(logs.pop());
  assert.equal(typeof j.score, 'number');
  assert.equal(j.cta, CTA);
  assert.ok(j.findings.every((f) => f.severity && f.file && f.line && f.why && f.fix));
  assert.equal(runAudit(['--fail-on', 'critical'], opts), 1);
  assert.ok(logs.pop().endsWith(CTA));
  assert.equal(runAudit(['--fail-on=low', '--dir', join(FIX, 'clean/project')], { ...opts, home: join(FIX, 'clean/home') }), 0);
  assert.equal(runAudit(['--fail-on', 'nope'], opts), 2);
  assert.equal(runAudit(['--wat'], opts), 2);
  assert.equal(shouldFail({ findings: [{ severity: 'medium' }] }, 'high'), false);
});
