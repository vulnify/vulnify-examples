#!/usr/bin/env node
/**
 * npx @vulnify/cli hook claude-code [--user] [--uninstall] [--yes]
 * npx @vulnify/cli audit [--json] [--fail-on <severity>] [--dir <path>]
 *
 * Installs the fail-closed Vulnify PreToolUse hook into Claude Code settings.
 * The API key comes from VULNIFY_API_KEY or a hidden prompt, and is never printed.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { audit, format, shouldFail, SEVERITIES, CTA } from '../lib/audit.mjs';

const HOOK_FILE = 'vulnify-hook.mjs';
const MATCHER = 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.*';
const DOCS = 'https://docs.vulnify.io/mcp/claude-code-hook/';
const here = dirname(fileURLToPath(import.meta.url));

export function paths({ user = false, cwd = process.cwd(), home = homedir() } = {}) {
  const base = user ? join(home, '.claude') : join(resolve(cwd), '.claude');
  return {
    base,
    hook: join(base, 'hooks', HOOK_FILE),
    settings: join(base, 'settings.json'),
    // Project scope keeps the key out of the committed settings.json.
    keyFile: user ? join(base, 'settings.json') : join(base, 'settings.local.json'),
    hookArg: user ? join(base, 'hooks', HOOK_FILE) : `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${HOOK_FILE}`,
  };
}

function readJson(file) {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new Error(`${file} is not valid JSON. Fix it first; nothing was changed.`);
}

function writeJson(file, value, secret = false) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, secret ? { mode: 0o600 } : undefined);
  if (secret) chmodSync(file, 0o600);
}

const isVulnify = (h) => typeof h === 'object' && h && [h.command, ...(Array.isArray(h.args) ? h.args : [])].some((x) => typeof x === 'string' && x.includes(HOOK_FILE));

/** Remove every Vulnify hook entry from settings.hooks.PreToolUse. Returns true when something changed. */
export function removeHook(settings) {
  const list = settings.hooks?.PreToolUse;
  if (!Array.isArray(list)) return false;
  let changed = false;
  const next = [];
  for (const group of list) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const kept = hooks.filter((h) => !isVulnify(h));
    if (kept.length !== hooks.length) changed = true;
    if (kept.length) next.push({ ...group, hooks: kept });
    else if (!hooks.length) next.push(group);
  }
  if (!changed) return false;
  if (next.length) settings.hooks.PreToolUse = next;
  else delete settings.hooks.PreToolUse;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return true;
}

export function addHook(settings, hookArg) {
  removeHook(settings);
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  settings.hooks.PreToolUse.push({
    matcher: MATCHER,
    hooks: [{ type: 'command', command: 'node', args: [hookArg], timeout: 30, onFailure: 'block' }],
  });
  return settings;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the key is typed.
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      done(answer.trim());
    });
  });
}

function ensureGitignored(cwd, entry) {
  if (!existsSync(join(cwd, '.git'))) return;
  const file = join(cwd, '.gitignore');
  const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (body.split(/\r?\n/).some((l) => l.trim() === entry)) return;
  appendFileSync(file, `${body && !body.endsWith('\n') ? '\n' : ''}${entry}\n`);
}

export async function install({ user, yes, cwd = process.cwd(), home = homedir(), env = process.env, prompt = ask, log = console.log, interactive = !!process.stdin.isTTY }) {
  const p = paths({ user, cwd, home });
  const settings = readJson(p.settings);
  const keySettings = p.keyFile === p.settings ? settings : readJson(p.keyFile);

  let key = '';
  let saveKey = false;
  if (env.VULNIFY_API_KEY) {
    log('Using VULNIFY_API_KEY from your environment (not saved; keep it exported where you start Claude Code).');
  } else if (keySettings.env?.VULNIFY_API_KEY) {
    log(`Keeping the API key already saved in ${p.keyFile}.`);
  } else if (yes || !interactive) {
    throw new Error('No API key. Export VULNIFY_API_KEY (a TEST key from app.vulnify.io/api-keys works) and run again.');
  } else {
    key = await prompt('Vulnify API key (input hidden, from app.vulnify.io/api-keys): ', { hidden: true });
    if (!key) throw new Error('No API key entered; nothing was changed.');
    if (!/^vln_/.test(key)) log('Note: Vulnify keys usually start with vln_. Saving it anyway.');
    saveKey = true;
  }

  mkdirSync(dirname(p.hook), { recursive: true });
  copyFileSync(join(here, '..', 'hook', HOOK_FILE), p.hook);
  addHook(settings, p.hookArg);
  if (saveKey) {
    keySettings.env = { ...(keySettings.env || {}), VULNIFY_API_KEY: key };
  }
  writeJson(p.settings, settings, p.keyFile === p.settings && saveKey);
  if (saveKey && p.keyFile !== p.settings) {
    writeJson(p.keyFile, keySettings, true);
    ensureGitignored(cwd, '.claude/settings.local.json');
  }
  log(`Installed the Vulnify hook (${user ? 'user' : 'project'} scope):`);
  log(`  hook      ${p.hook}`);
  log(`  settings  ${p.settings}`);
  if (saveKey) log(`  API key   saved in ${p.keyFile} (file mode 600${p.keyFile !== p.settings ? ', git-ignored' : ''})`);
  log('Fail closed: if Vulnify cannot be reached, checked tool calls are held. Restart Claude Code, then run /hooks to confirm.');
  log(`Docs: ${DOCS}`);
}

export function uninstall({ user, cwd = process.cwd(), home = homedir(), log = console.log }) {
  const p = paths({ user, cwd, home });
  const settings = readJson(p.settings);
  const removed = removeHook(settings);
  let keyRemoved = false;
  const keySettings = p.keyFile === p.settings ? settings : readJson(p.keyFile);
  if (keySettings.env?.VULNIFY_API_KEY) {
    delete keySettings.env.VULNIFY_API_KEY;
    if (!Object.keys(keySettings.env).length) delete keySettings.env;
    keyRemoved = true;
  }
  if (removed || (keyRemoved && p.keyFile === p.settings)) writeJson(p.settings, settings);
  if (keyRemoved && p.keyFile !== p.settings) writeJson(p.keyFile, keySettings, true);
  const hadFile = existsSync(p.hook);
  if (hadFile) rmSync(p.hook);
  log(removed || hadFile || keyRemoved ? `Removed the Vulnify hook (${user ? 'user' : 'project'} scope)${keyRemoved ? ' and the saved API key' : ''}.` : 'No Vulnify hook found here.');
}

const AUDIT_HELP = `Usage: npx @vulnify/cli audit [options]

Read-only audit of the AI agents on this machine and in this project
(Claude Code, Cursor, Codex, Claude Desktop, VS Code). No network calls;
secrets are always masked.

Options:
  --json                 machine-readable output
  --fail-on <severity>   exit 1 if any finding is at or above: ${SEVERITIES.join(', ')}
  --dir <path>           project folder to check (default: current folder)
  -h, --help             show this help`;

export function runAudit(argv, { log = console.log, err = console.error, home, cwd = process.cwd(), env = process.env, platform = process.platform, color = !!process.stdout.isTTY && !env.NO_COLOR } = {}) {
  let json = false, failOn = null, dir = cwd;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { log(AUDIT_HELP); return 0; }
    else if (a === '--json') json = true;
    else if (a === '--fail-on' || a.startsWith('--fail-on=')) failOn = (a.includes('=') ? a.split('=')[1] : argv[++i] || '').toLowerCase();
    else if (a === '--dir' || a.startsWith('--dir=')) dir = resolve(cwd, a.includes('=') ? a.split('=')[1] : argv[++i] || '.');
    else { err(`Unknown option: ${a}\n\n${AUDIT_HELP}`); return 2; }
  }
  if (failOn !== null && !SEVERITIES.includes(failOn)) { err(`--fail-on must be one of: ${SEVERITIES.join(', ')}`); return 2; }
  const h = home || homedir();
  const result = audit({ home: h, cwd: dir, env, platform });
  if (json) log(JSON.stringify({ ...result, cta: CTA }, null, 2));
  else log(format(result, { home: h, cwd: dir, color }));
  return shouldFail(result, failOn) ? 1 : 0;
}

const HELP = `Usage: npx @vulnify/cli hook claude-code [options]
       npx @vulnify/cli audit [--json] [--fail-on <severity>]

Installs the fail-closed Vulnify PreToolUse hook into Claude Code.

Options:
  --user        install in ~/.claude (every project) instead of ./.claude
  --uninstall   remove the hook (and a key this tool saved)
  --yes         no prompts; needs VULNIFY_API_KEY in the environment
  -h, --help    show this help

Docs: ${DOCS}`;

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'audit') return runAudit(argv.slice(1));
  const flags = new Set(argv.filter((a) => a.startsWith('-')));
  const words = argv.filter((a) => !a.startsWith('-'));
  if (flags.has('-h') || flags.has('--help') || words[0] !== 'hook' || words[1] !== 'claude-code') {
    console.log(HELP);
    return words.length && !(flags.has('-h') || flags.has('--help')) ? 1 : 0;
  }
  const unknown = [...flags].filter((f) => !['--user', '--uninstall', '--yes', '-y', '--project'].includes(f));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.join(' ')}\n\n${HELP}`);
    return 1;
  }
  const opts = { user: flags.has('--user'), yes: flags.has('--yes') || flags.has('-y') };
  if (flags.has('--uninstall')) uninstall(opts);
  else await install(opts);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]).replace(/\\/g, '/').match(/vulnify-cli(\.mjs)?$/)) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`vulnify-cli: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
