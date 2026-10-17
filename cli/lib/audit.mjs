/**
 * vulnify audit: a local, read-only audit of the AI agents configured on this machine
 * and in the current project. It reads config files, never writes, never runs a server,
 * and makes no network calls. Secrets are always masked (first 4 characters + ***).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, posix, relative, resolve, sep, win32 } from 'node:path';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const WEIGHT = { critical: 25, high: 15, medium: 7, low: 3 };
const MAX_BYTES = 2 * 1024 * 1024;

export const mask = (s) => `${String(s).slice(0, 4)}***`;

// ---------- secret patterns ----------
const TOKEN_PATTERNS = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Vulnify key', /\bvln_(?:live|test)_[A-Za-z0-9_]{12,}/],
  ['Private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
];
export function findToken(text) {
  for (const [name, re] of TOKEN_PATTERNS) {
    const m = re.exec(String(text));
    if (m) return { name, value: m[0] };
  }
  return null;
}
const SECRET_NAME = /(?:^|_|-)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|AUTH|CREDENTIALS?|PRIVATE)(?:$|_|-)/i;
const isReference = (v) => /^\$\{?[A-Za-z_][\w:.-]*\}?$|^\$\{(?:env|input):[^}]+\}$|^<.*>$|^your[-_ ]|^xxx|^\*+$|^(?:changeme|placeholder|todo|none|null|true|false)$/i.test(String(v).trim());

// ---------- tiny TOML reader (enough for ~/.codex/config.toml) ----------
export function parseToml(text) {
  const root = {};
  let cur = root;
  const setPath = (obj, keys) => keys.reduce((o, k) => (o[k] ??= {}), obj);
  const splitKey = (k) => (k.match(/"[^"]*"|'[^']*'|[^.\s]+/g) || []).map((p) => p.replace(/^["']|["']$/g, ''));
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const t = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (t) { cur = setPath(root, splitKey(t[1])); continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let raw = line.slice(eq + 1).trim();
    // Multi-line arrays / triple-quoted strings
    const opens = (s) => (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
    if (raw.startsWith('[')) { while (opens(stripStrings(raw)) > 0 && i + 1 < lines.length) raw += '\n' + lines[++i]; }
    else if (/^("""|''')/.test(raw)) { const q = raw.slice(0, 3); while (!raw.slice(3).includes(q) && i + 1 < lines.length) raw += '\n' + lines[++i]; }
    const keys = splitKey(key);
    setPath(cur, keys.slice(0, -1))[keys.at(-1)] = tomlValue(raw);
  }
  return root;
}
function stripStrings(s) { return s.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""').replace(/#.*$/gm, ''); }
function tomlValue(raw) {
  raw = raw.trim();
  if (/^("""|''')/.test(raw)) return raw.slice(3, raw.lastIndexOf(raw.slice(0, 3)));
  if (raw.startsWith('"')) { const m = raw.match(/^"((?:\\.|[^"\\])*)"/); try { return JSON.parse(`"${m ? m[1] : ''}"`); } catch { return m ? m[1] : ''; } }
  if (raw.startsWith("'")) { const m = raw.match(/^'([^']*)'/); return m ? m[1] : ''; }
  if (raw.startsWith('[')) return splitTop(raw.slice(1, raw.lastIndexOf(']'))).map(tomlValue);
  if (raw.startsWith('{')) {
    const o = {};
    for (const part of splitTop(raw.slice(1, raw.lastIndexOf('}')))) {
      const eq = part.indexOf('=');
      if (eq > 0) o[part.slice(0, eq).trim().replace(/^["']|["']$/g, '')] = tomlValue(part.slice(eq + 1));
    }
    return o;
  }
  const v = raw.replace(/\s+#.*$/, '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  return /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}
function splitTop(s) {
  const out = []; let depth = 0, q = null, buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { buf += c; if (c === '\\' && q === '"') { buf += s[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; buf += c; continue; }
    if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// ---------- discovery ----------
/** Every config location we know, per tool. Paths confirmed against each tool's docs (Oct 2026). */
export function locations({ home = homedir(), cwd = process.cwd(), platform = process.platform, env = process.env } = {}) {
  // Build paths for the target OS, not the host (so a simulated win32/darwin run is correct anywhere).
  const join = (platform === 'win32' ? win32 : posix).join;
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  const desktop = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude')
    : platform === 'win32' ? join(appData, 'Claude') : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude');
  const vscodeUser = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Code', 'User')
    : platform === 'win32' ? join(appData, 'Code', 'User') : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Code', 'User');
  const managed = platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json' : '/etc/claude-code/managed-settings.json';
  const p = (rel) => join(cwd, rel);
  return [
    // Claude Code
    { tool: 'Claude Code', kind: 'claude-settings', scope: 'user', path: join(claudeHome, 'settings.json') },
    { tool: 'Claude Code', kind: 'claude-settings', scope: 'managed', path: managed },
    { tool: 'Claude Code', kind: 'claude-settings', scope: 'project', path: p('.claude/settings.json') },
    { tool: 'Claude Code', kind: 'claude-settings', scope: 'project', path: p('.claude/settings.local.json') },
    { tool: 'Claude Code', kind: 'claude-json', scope: 'user', path: join(home, '.claude.json') },
    { tool: 'Claude Code', kind: 'mcp', scope: 'project', path: p('.mcp.json') },
    { tool: 'Claude Code', kind: 'instructions', scope: 'user', path: join(claudeHome, 'CLAUDE.md') },
    { tool: 'Claude Code', kind: 'instructions', scope: 'project', path: p('CLAUDE.md') },
    { tool: 'Claude Code', kind: 'instructions', scope: 'project', path: p('CLAUDE.local.md') },
    { tool: 'Claude Code', kind: 'instructions', scope: 'project', path: p('.claude/CLAUDE.md') },
    // Cursor
    { tool: 'Cursor', kind: 'mcp', scope: 'user', path: join(home, '.cursor', 'mcp.json') },
    { tool: 'Cursor', kind: 'mcp', scope: 'project', path: p('.cursor/mcp.json') },
    { tool: 'Cursor', kind: 'cursor-cli', scope: 'user', path: join(home, '.cursor', 'cli-config.json') },
    { tool: 'Cursor', kind: 'instructions', scope: 'project', path: p('.cursorrules') },
    { tool: 'Cursor', kind: 'instructions-dir', scope: 'project', path: p('.cursor/rules') },
    // Codex
    { tool: 'Codex', kind: 'codex', scope: 'user', path: join(codexHome, 'config.toml') },
    { tool: 'Codex', kind: 'codex', scope: 'project', path: p('.codex/config.toml') },
    { tool: 'Codex', kind: 'instructions', scope: 'user', path: join(codexHome, 'AGENTS.md') },
    { tool: 'Codex', kind: 'instructions', scope: 'project', path: p('AGENTS.md') },
    // Claude Desktop
    { tool: 'Claude Desktop', kind: 'mcp', scope: 'user', path: join(desktop, 'claude_desktop_config.json') },
    // VS Code / Copilot
    { tool: 'VS Code', kind: 'mcp', scope: 'project', path: p('.vscode/mcp.json') },
    { tool: 'VS Code', kind: 'mcp', scope: 'user', path: join(vscodeUser, 'mcp.json') },
    { tool: 'VS Code', kind: 'mcp', scope: 'user', path: join(env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json') },
    { tool: 'VS Code', kind: 'instructions', scope: 'project', path: p('.github/copilot-instructions.md') },
  ];
}

function readText(path) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { text: readFileSync(path, 'utf8'), mode: st.mode };
  } catch { return null; }
}
const parseJsonLoose = (t) => {
  try { return JSON.parse(t); } catch { /* JSONC: drop comments and trailing commas */ }
  try { return JSON.parse(t.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '').replace(/,(\s*[}\]])/g, '$1')); } catch { return undefined; }
};

/** 1-based line of the first needle, then each following needle after it. */
export function lineOf(text, ...needles) {
  let at = 0, found = -1;
  for (const n of needles.filter(Boolean)) {
    const i = text.indexOf(n, at);
    if (i < 0) break;
    found = i; at = i + n.length;
  }
  return found < 0 ? 1 : text.slice(0, found).split('\n').length;
}

// ---------- rules ----------
const FIX_CTA = 'Vulnify can hold this at runtime: npx @vulnify/cli hook claude-code';
const R = {
  'mcp-remote-no-auth': { severity: 'medium', title: 'Remote MCP server with no auth', why: 'Anyone who knows the URL can use it, and you cannot tell who is on the other side or revoke access.', fix: 'Use an MCP server that requires OAuth or a bearer token (headers / bearer_token_env_var), or remove it.' },
  'mcp-unpinned': { severity: 'low', title: 'MCP server runs an unpinned package', why: 'npx/uvx downloads the latest version on every start, so a compromised release runs on your machine with no review (supply chain).', fix: 'Pin a version, e.g. "@scope/server@1.2.3" or "pkg==1.2.3", and update on purpose.' },
  'mcp-fs-broad': { severity: 'high', title: 'Filesystem MCP server can reach your whole disk or home', why: 'The agent can read ~/.ssh, ~/.aws, browser profiles and every repo, and can overwrite them.', fix: 'Limit it to the project folder (e.g. "${workspaceFolder}" or "."), never "/" or "~".' },
  'mcp-shell': { severity: 'high', title: 'MCP server exposes shell / command execution', why: 'Any prompt injection that reaches the agent can run arbitrary commands, outside the agent\'s own permission prompts.', fix: 'Remove it or gate it with per-call approval. ' + FIX_CTA },
  'mcp-plaintext-secret': { severity: 'high', title: 'Plaintext secret in MCP server config', why: 'The key sits in a config file that gets synced, backed up, pasted into issues and read by other tools and agents.', fix: 'Move it to an env var or OS keychain and reference it (${env:NAME}, ${input:...}, bearer_token_env_var), then rotate the key.' },
  'perm-bypass': { severity: 'critical', title: 'Approvals are bypassed or every command is allowed', why: 'The agent runs any shell command and edits any file without asking, so one bad prompt is enough to do damage.', fix: 'Remove bypass mode / wildcard allow rules and allow only the specific commands you need. ' + FIX_CTA },
  'perm-dangerous-allow': { severity: 'high', title: 'Destructive command pre-approved', why: 'rm, curl|sh, git push --force, chmod and sudo can destroy work or open the machine, and they run with no prompt.', fix: 'Delete the allow rule (or move it to "ask"), so a person confirms each time.' },
  'perm-no-deny-secrets': { severity: 'medium', title: 'No deny rules for secret files', why: 'Nothing stops the agent from reading .env, ~/.ssh or ~/.aws and putting them into a prompt, a commit or a web request.', fix: 'Add to permissions.deny: "Read(./.env)", "Read(./.env.*)", "Read(~/.ssh/**)", "Read(~/.aws/**)".' },
  'project-dotenv': { severity: 'medium', title: '.env file in the project', why: 'Agents working here can read it unless denied, and it ends up in context, logs and generated code.', fix: 'Keep it git-ignored, deny Read(./.env*) for agents, and prefer a secrets manager for real credentials.' },
  'config-token': { severity: 'high', title: 'Token in an agent config file', why: 'Agent configs are often committed, synced and readable by every agent and extension on the machine.', fix: 'Remove the token from the file, load it from the environment or a keychain, and rotate it.' },
  'instructions-injection': { severity: 'high', title: 'Suspicious text in an agent instruction file', why: 'Instruction files are obeyed on every session. Hidden or "ignore the rules" text is how repos hijack agents and exfiltrate data.', fix: 'Read the file, remove the text, and check where it came from (cloned repo, PR, package).' },
  'config-world-readable': { severity: 'medium', title: 'Agent config readable by other users', why: 'Other accounts and processes on this machine can read the config and any keys or tokens in it.', fix: 'chmod 600 the file (and 700 its folder).' },
};
export const RULES = R;

const HOME_LIKE = /^(?:\/|~\/?|\$HOME\/?|\$\{(?:env:)?(?:HOME|USERPROFILE|userHome)\}\/?|[A-Za-z]:\\?|\/(?:Users|home)\/[^/]+\/?|[A-Za-z]:\\Users\\[^\\]+\\?|\/root\/?)$/;
const SHELL_NAME = /(?:^|[-_@/ ])(?:shell|bash|zsh|powershell|terminal|exec|cmd|command|commands|run[-_]?command|desktop-commander|ssh|process)(?:$|[-_/ @.])/i;

function* servers(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  for (const key of ['mcpServers', 'servers', 'mcp_servers']) {
    const s = cfg[key];
    if (s && typeof s === 'object' && !Array.isArray(s)) for (const [name, def] of Object.entries(s)) if (def && typeof def === 'object') yield [name, def];
  }
}

function pkgOf(command, args) {
  const cmd = basename(String(command || '')).replace(/\.(cmd|exe)$/i, '').toLowerCase();
  if (!['npx', 'uvx', 'bunx', 'pnpx'].includes(cmd) && !(cmd === 'pnpm' && args[0] === 'dlx') && !(cmd === 'uv' && args[0] === 'tool')) return null;
  const rest = args.filter((a) => typeof a === 'string');
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (['dlx', 'tool', 'run'].includes(a) && i < 2) continue;
    if (a === '--from' || a === '-p' || a === '--package') return { cmd, pkg: rest[i + 1] || '' };
    if (a.startsWith('-')) continue;
    return { cmd, pkg: a };
  }
  return null;
}
export function isPinned(cmd, pkg) {
  if (!pkg) return true;
  if (/^(?:\.|\/|[A-Za-z]:\\|git\+|https?:|file:)/.test(pkg)) return true;
  if (cmd === 'uvx' || cmd === 'uv') return /==\d|@\d/.test(pkg);
  const at = pkg.startsWith('@') ? pkg.indexOf('@', 1) : pkg.indexOf('@');
  if (at < 0) return false;
  const ver = pkg.slice(at + 1);
  return /^\d/.test(ver) && !/[\^~*x]|latest|next/.test(ver);
}

function checkServer(add, file, text, name, def) {
  const args = Array.isArray(def.args) ? def.args.map(String) : [];
  const url = def.url || def.serverUrl || def.httpUrl;
  const at = (...n) => lineOf(text, `"${name}"`, ...n) || lineOf(text, name);
  const where = (...n) => (file.endsWith('.toml') ? lineOf(text, `mcp_servers.${name}`, ...n) : at(...n));
  // remote, no auth
  if (url && /^https?:/i.test(url) && !/^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(url)) {
    const headers = def.headers || def.http_headers || def.env_http_headers || {};
    const hasAuth = Object.keys(headers).some((h) => /auth|token|key/i.test(h)) || def.bearer_token_env_var || def.bearer_token || def.oauth || def.auth || /[?&](?:key|token|api_key|apikey)=/i.test(url);
    if (!hasAuth) add('mcp-remote-no-auth', file, where('url'), `server "${name}" → ${url.replace(/[?#].*$/, '')}`);
  }
  // unpinned
  const p = pkgOf(def.command, args);
  if (p && !isPinned(p.cmd, p.pkg)) add('mcp-unpinned', file, where(p.pkg), `server "${name}": ${p.cmd} ${p.pkg}`);
  // filesystem broad
  const ident = `${name} ${def.command || ''} ${args.join(' ')}`;
  if (/filesystem|file-system|\bfs\b|fs-mcp|mcp-fs/i.test(ident)) {
    const broad = args.find((a) => HOME_LIKE.test(a.trim()));
    if (broad) add('mcp-fs-broad', file, where(broad), `server "${name}" can access "${broad}"`);
  }
  // shell / exec
  if (SHELL_NAME.test(name) || (p && SHELL_NAME.test(p.pkg)) || /mcp-server-commands|desktop-commander|mcp-shell|shell-mcp|terminal-mcp|mcp-server-shell/i.test(args.join(' ')))
    add('mcp-shell', file, where(), `server "${name}"${p ? ` (${p.pkg})` : ''}`);
  // plaintext secrets
  const env = { ...(def.env || {}), ...(def.headers || {}), ...(def.http_headers || {}) };
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || !v.trim() || isReference(v)) continue;
    const tok = findToken(v);
    const bearer = /^Bearer\s+(\S{8,})$/i.exec(v);
    if (tok || bearer || (SECRET_NAME.test(k) && v.length >= 8 && !/\$\{/.test(v)))
      add('mcp-plaintext-secret', file, where(k), `server "${name}", ${k} = ${mask(tok ? tok.value : bearer ? bearer[1] : v)}`, (tok || bearer || { value: v }).value);
  }
  const done = new Set();
  args.forEach((a, i) => {
    const tok = findToken(a);
    const kv = /^--?(?:api[-_]?key|token|secret|password|auth)(?:=(.+))?$/i.exec(a);
    const val = tok ? tok.value : kv ? kv[1] || args[i + 1] : null;
    if (val && !done.has(val) && !isReference(val) && val.length >= 8 && done.add(val)) add('mcp-plaintext-secret', file, where(val), `server "${name}", args[${i}] = ${mask(val)}`, val);
  });
  if (url) { const t = findToken(url) || (/[?&](?:key|token|api_key|apikey)=([^&]{8,})/i.exec(url) || [])[1] && { value: /[?&](?:key|token|api_key|apikey)=([^&]+)/i.exec(url)[1] }; if (t) add('mcp-plaintext-secret', file, where('url'), `server "${name}", key in URL = ${mask(t.value)}`, t.value); }
}

const DANGER = [
  [/\brm\b/, 'rm'], [/\b(?:curl|wget)\b.*\|\s*(?:ba|z)?sh\b|\|\s*(?:ba|z)?sh\b/, 'curl | sh'],
  [/\bgit\s+push\b.*(?:--force|-f\b|\*)/, 'git push --force'], [/\bchmod\b/, 'chmod'], [/\bsudo\b/, 'sudo'],
  [/\bRemove-Item\b/i, 'Remove-Item'],
];
function checkPermissions(add, file, text, allow, toolName = 'Bash') {
  for (const rule of allow) {
    if (typeof rule !== 'string') continue;
    const r = rule.trim();
    const m = /^(\w+)(?:\((.*)\))?$/s.exec(r);
    const tool = m?.[1] || '';
    const arg = (m?.[2] ?? '').trim();
    if (r === '*' || ((/^(?:Bash|Shell|PowerShell)$/i.test(tool)) && (m[2] === undefined || /^[*:\s]*$/.test(arg) || arg === '**'))) {
      add('perm-bypass', file, lineOf(text, JSON.stringify(rule)), `allow rule ${JSON.stringify(rule)}`); continue;
    }
    if (!/^(?:Bash|Shell|PowerShell)$/i.test(tool)) continue;
    const hit = DANGER.find(([re]) => re.test(arg));
    if (hit) add('perm-dangerous-allow', file, lineOf(text, JSON.stringify(rule)), `allow rule ${JSON.stringify(rule)} (${hit[1]})`);
  }
}

const INJECTION = [
  [/\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|system|safety|security|user'?s?)\b[^.\n]{0,20}\b(?:instructions?|rules?|prompts?|guidelines?|polic(?:y|ies))\b/i, 'tells the agent to ignore its rules'],
  [/\b(?:do not|don'?t|never)\s+(?:tell|inform|mention|show|reveal|notify|ask)\b[^.\n]{0,30}\b(?:user|human|developer|anyone|owner)\b/i, 'tells the agent to hide actions from the user'],
  [/\b(?:silently|secretly|covertly|without (?:telling|asking|notifying|informing))\b/i, 'asks for silent or covert actions'],
  [/\b(?:curl|wget|fetch|invoke-webrequest|iwr|nc)\b[^\n]{0,120}(?:\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASS)|\.env\b|\.ssh|\.aws|id_rsa|credentials)/i, 'sends secrets or credentials to a URL'],
  [/\b(?:send|post|upload|exfiltrate|forward|copy)\b[^.\n]{0,60}\b(?:env|secrets?|credentials?|tokens?|keys?|\.env|ssh)\b[^.\n]{0,60}https?:\/\//i, 'asks to send secrets to an external URL'],
  [/https?:\/\/[^\s)"']*(?:webhook\.site|requestbin|pipedream\.net|ngrok(?:-free)?\.(?:io|app)|pastebin\.com|interact\.sh|oast\.|burpcollaborator|trycloudflare\.com)/i, 'points to a known data-capture endpoint'],
];
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;
function checkInstructions(add, file, text) {
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const inv = INVISIBLE.exec(l.replace(/^\uFEFF/, i === 0 ? '' : '\uFEFF'));
    if (inv) add('instructions-injection', file, i + 1, `invisible Unicode U+${inv[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    for (const [re, label] of INJECTION) if (re.test(l)) { add('instructions-injection', file, i + 1, label); break; }
  });
  const hidden = /<!--[\s\S]*?-->/g; let m;
  while ((m = hidden.exec(text))) if (INJECTION.some(([re]) => re.test(m[0])) || /\b(?:instruction|agent|assistant|AI)\b/i.test(m[0])) add('instructions-injection', file, text.slice(0, m.index).split('\n').length, 'instructions hidden in an HTML comment');
}

function listDir(dir, depth = 2) {
  const out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory() && depth > 0) out.push(...listDir(f, depth - 1));
      else if (e.isFile() && /\.(md|mdc|txt)$/i.test(e.name)) out.push(f);
    }
  } catch { /* unreadable */ }
  return out;
}

// ---------- main ----------
export function audit({ home = homedir(), cwd = process.cwd(), platform = process.platform, env = process.env } = {}) {
  home = resolve(home); cwd = resolve(cwd);
  const findings = []; const seen = new Set(); const files = []; const tools = new Set();
  const add = (id, file, line, detail, secret) => {
    const key = `${id}|${file}|${line}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (secret && detail.includes(secret)) throw new Error('internal: unmasked secret');
    findings.push({ id, severity: R[id].severity, title: R[id].title, file, line, detail, why: R[id].why, fix: R[id].fix });
  };
  let claudeSeen = false; const claudeDeny = []; const claudeFiles = [];
  const visited = new Set();
  for (const loc of locations({ home, cwd, platform, env })) {
    const paths = loc.kind === 'instructions-dir' ? listDir(loc.path) : [loc.path];
    for (const path of paths) {
      if (visited.has(path)) continue; visited.add(path);
      const r = readText(path);
      if (!r) continue;
      const { text, mode } = r;
      files.push({ tool: loc.tool, scope: loc.scope, path });
      tools.add(loc.tool);
      const isInstr = loc.kind.startsWith('instructions');
      if (isInstr) { checkInstructions(add, path, text); continue; }
      let cfg;
      if (loc.kind === 'codex') cfg = parseToml(text); else cfg = parseJsonLoose(text);
      // tokens anywhere in the file (MCP-specific findings come first and win dedupe below)
      const before = findings.length;
      if (cfg) {
        for (const [name, def] of servers(cfg)) checkServer(add, path, text, name, def);
        if (loc.kind === 'claude-json') {
          const proj = cfg.projects?.[cwd] || cfg.projects?.[cwd.split(sep).join('/')];
          if (proj) for (const [name, def] of servers(proj)) checkServer(add, path, text, name, def);
        }
        if (loc.kind === 'claude-settings') {
          claudeSeen = true; claudeFiles.push(path);
          const perm = cfg.permissions || {};
          const deny = Array.isArray(perm.deny) ? perm.deny : [];
          claudeDeny.push(...deny);
          if (perm.defaultMode === 'bypassPermissions' && (loc.scope === 'user' || loc.scope === 'managed')) add('perm-bypass', path, lineOf(text, 'defaultMode'), 'permissions.defaultMode = "bypassPermissions"');
          if (cfg.skipDangerousModePermissionPrompt === true) add('perm-bypass', path, lineOf(text, 'skipDangerousModePermissionPrompt'), 'skipDangerousModePermissionPrompt = true');
          checkPermissions(add, path, text, Array.isArray(perm.allow) ? perm.allow : []);
          for (const [k, v] of Object.entries(cfg.env || {})) {
            if (typeof v === 'string' && !isReference(v) && (findToken(v) || (SECRET_NAME.test(k) && v.length >= 12))) add('config-token', path, lineOf(text, `"${k}"`), `env.${k} = ${mask(findToken(v)?.value || v)}`, findToken(v)?.value || v);
          }
        }
        if (loc.kind === 'claude-json' && cfg.bypassPermissionsModeAccepted === true) { /* informational only */ }
        if (loc.kind === 'cursor-cli') checkPermissions(add, path, text, Array.isArray(cfg.permissions?.allow) ? cfg.permissions.allow : [], 'Shell');
        if (loc.kind === 'codex') {
          const ap = cfg.approval_policy, sb = cfg.sandbox_mode;
          if (ap === 'never' && sb === 'danger-full-access') add('perm-bypass', path, lineOf(text, 'sandbox_mode'), 'approval_policy = "never" with sandbox_mode = "danger-full-access"');
          else if (sb === 'danger-full-access') add('perm-bypass', path, lineOf(text, 'sandbox_mode'), 'sandbox_mode = "danger-full-access" (no sandbox)');
          for (const [pname, prof] of Object.entries(cfg.profiles || {})) if (prof?.sandbox_mode === 'danger-full-access') add('perm-bypass', path, lineOf(text, `profiles.${pname}`, 'sandbox_mode'), `profile "${pname}": sandbox_mode = "danger-full-access"`);
        }
      }
      // generic token scan for every config file, skipping lines already reported as a secret
      const reported = new Set(findings.slice(before).filter((f) => f.id === 'mcp-plaintext-secret' || f.id === 'config-token').map((f) => f.line));
      text.split('\n').forEach((l, i) => {
        if (reported.has(i + 1)) return;
        const t = findToken(l);
        if (t) add('config-token', path, i + 1, `${t.name} = ${mask(t.value)}`, t.value);
      });
      // POSIX permissions: home-dir agent configs readable by group/others
      if (platform !== 'win32' && (loc.scope === 'user') && (mode & 0o044)) {
        const secretInside = findings.some((f) => f.file === path && (f.id === 'config-token' || f.id === 'mcp-plaintext-secret'));
        if (secretInside || loc.kind === 'claude-json') add('config-world-readable', path, 1, `mode ${(mode & 0o777).toString(8)}${secretInside ? ', contains secrets' : ', holds your sign-in session'}`);
      }
    }
  }
  // Claude Code deny rules for secret files (only if Claude Code settings exist)
  if (claudeSeen) {
    const d = claudeDeny.join(' ');
    const missing = [['.env', /\.env/], ['~/.ssh', /\.ssh/], ['~/.aws', /\.aws/]].filter(([, re]) => !re.test(d)).map(([n]) => n);
    if (missing.length) add('perm-no-deny-secrets', claudeFiles[0], 1, `no deny rule for ${missing.join(', ')}`);
  }
  // .env in the project (top level and one level down)
  if (cwd !== home) {
    const envs = [];
    const scan = (dir, depth) => {
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && /^\.env(?:\.(?!example$|sample$|template$|dist$|defaults$)[\w.-]+)?$/.test(e.name)) envs.push(join(dir, e.name));
          else if (e.isDirectory() && depth > 0 && !/^(?:node_modules|\.git|dist|build|\.venv|venv|vendor)$/.test(e.name) && !e.name.startsWith('.')) scan(join(dir, e.name), depth - 1);
        }
      } catch { /* unreadable */ }
    };
    scan(cwd, 1);
    for (const f of envs) add('project-dotenv', f, 1, relative(cwd, f));
  }
  findings.sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.file.localeCompare(b.file) || a.line - b.line);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  // Each rule costs its full weight once, then 2 points per extra occurrence.
  const byRule = {};
  for (const f of findings) byRule[f.id] = (byRule[f.id] || 0) + 1;
  const score = Math.max(0, 100 - Object.entries(byRule).reduce((n, [id, k]) => n + WEIGHT[R[id].severity] + 2 * (k - 1), 0));
  return { score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F', counts, tools: [...tools], files, findings };
}

// ---------- output ----------
export const CTA = 'Turn these into enforced policies: npx @vulnify/cli hook claude-code / vulnify.io';
export function format(result, { home = homedir(), cwd = process.cwd(), color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const SEV = { critical: '1;31', high: '31', medium: '33', low: '36' };
  const under = (p, base) => p.startsWith(base + sep) || p.startsWith(base + '/');
  const short = (p) => (under(p, cwd) && cwd !== home ? '.' + p.slice(cwd.length) : under(p, home) ? '~' + p.slice(home.length) : p);
  const out = [c('1', 'Vulnify audit') + c('2', '  read-only, nothing left this machine')];
  out.push(c('2', `Checked ${result.files.length} config file${result.files.length === 1 ? '' : 's'}` + (result.tools.length ? ` (${result.tools.join(', ')})` : ' (no AI agent configs found)')));
  out.push('');
  if (!result.findings.length) out.push(c('32', 'No findings.'), '');
  const groups = new Map();
  for (const f of result.findings) groups.set(f.id, [...(groups.get(f.id) || []), f]);
  for (const [, fs] of groups) {
    const f = fs[0];
    out.push(`${c(SEV[f.severity], f.severity.toUpperCase().padEnd(8))} ${c('1', f.title)}`);
    for (const x of fs) out.push(`  ${short(x.file)}:${x.line}  ${c('2', x.detail)}`);
    out.push(`  Why: ${f.why}`, `  Fix: ${f.fix}`, '');
  }
  const parts = SEVERITIES.slice().reverse().filter((s) => result.counts[s]).map((s) => `${result.counts[s]} ${s}`);
  out.push(`${c('1', `Score ${result.score}/100 (${result.grade})`)}${parts.length ? '  ' + parts.join(', ') : ''}`);
  out.push(CTA);
  return out.join('\n');
}

export function shouldFail(result, failOn) {
  if (!failOn) return false;
  const min = SEVERITIES.indexOf(failOn);
  return result.findings.some((f) => SEVERITIES.indexOf(f.severity) >= min);
}
