#!/usr/bin/env node
/**
 * Vulnify PreToolUse hook for Claude Code.
 *
 * Reads the PreToolUse JSON from stdin, maps the tool call to a Vulnify event,
 * calls POST /v1/events, and prints a Claude Code hook decision:
 *   ALLOW  -> no decision (Claude Code's normal permission flow), or "allow" with VULNIFY_HOOK_ALLOW_MODE=allow
 *   REVIEW -> deny: waiting for approval in Vulnify (optionally waits VULNIFY_HOOK_REVIEW_WAIT_MS)
 *   BLOCK  -> deny with the reasons
 * Errors fail closed (deny) unless VULNIFY_HOOK_FAIL_OPEN=true.
 * No dependencies. Node 18+.
 */

const DEFAULT_SKIP = [
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'Task', 'Agent', 'WebSearch',
  'BashOutput', 'KillShell', 'KillBash', 'ExitPlanMode', 'AskUserQuestion', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
];

// Bash commands that only read. A command is skipped only when every part of it is in this list.
const SAFE_BASH = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'pwd', 'echo', 'printf',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'stat', 'file', 'which', 'whoami', 'date', 'env', 'printenv', 'tree',
  'du', 'df', 'true', 'false', 'test', 'cd', 'jq', 'basename', 'dirname', 'realpath', 'type', 'uname', 'sleep',
]);
const SAFE_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'remote', 'fetch', 'grep', 'describe', 'tag']);
const SAFE_NPM = new Set(['test', 'run', 'ls', 'view', 'outdated', 'audit']);

function envList(name, env = process.env) {
  return (env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function config(env = process.env) {
  const skip = new Set([...(env.VULNIFY_HOOK_SKIP_DEFAULTS === 'false' ? [] : DEFAULT_SKIP), ...envList('VULNIFY_HOOK_SKIP', env)]);
  return {
    apiKey: env.VULNIFY_API_KEY || '',
    baseUrl: (env.VULNIFY_BASE_URL || 'https://api.vulnify.io').replace(/\/+$/, ''),
    agent: env.VULNIFY_AGENT || 'claude-code',
    skip,
    checkReads: env.VULNIFY_HOOK_CHECK_READS === 'true',
    failOpen: env.VULNIFY_HOOK_FAIL_OPEN === 'true',
    allowMode: env.VULNIFY_HOOK_ALLOW_MODE === 'allow' ? 'allow' : 'defer',
    timeoutMs: Number(env.VULNIFY_HOOK_TIMEOUT_MS) || 8000,
    reviewWaitMs: Math.min(Number(env.VULNIFY_HOOK_REVIEW_WAIT_MS) || 0, 120000),
    sendContent: ['never', 'risky', 'always'].includes(env.VULNIFY_HOOK_SEND_CONTENT) ? env.VULNIFY_HOOK_SEND_CONTENT : 'risky',
  };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

function bashParts(command) {
  return command.split(/&&|\|\||[;|\n]/).map((p) => p.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);
}

function classifyBash(command) {
  const c = command;
  if (/(^|[\s;&|(])(rm|rmdir|shred|unlink)\s/.test(c) || /\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from)\b/i.test(c)
    || /git\s+(push\s+.*(--force|-f\b)|reset\s+--hard|clean\s+-\w*f|branch\s+-D)/.test(c)) {
    return { action: 'DELETE_DATA', destination: 'INTERNAL' };
  }
  if (/\b(sendmail|mailx?|mutt)\b/.test(c)) return { action: 'SEND_EMAIL', destination: 'EXTERNAL_EMAIL' };
  if (/\b(curl|wget|http|httpie)\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)|\s(-d|--data\S*|-F|--form|-T|--upload-file|--json)\b)/i.test(c)
    || /\b(scp|rsync|sftp|ftp)\b/.test(c) || /git\s+push\b/.test(c) || /\b(npm|pnpm|yarn)\s+publish\b/.test(c)
    || /\b(aws\s+s3\s+(cp|sync|mv)|gsutil\s+(cp|rsync)|rclone)\b/.test(c)) {
    return { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  }
  const parts = bashParts(c);
  const readOnly = parts.length > 0 && parts.every((p) => {
    if (/[^>]>[^&]|^>|>>/.test(p)) return false; // redirect writes a file
    const [cmd, sub] = p.split(/\s+/);
    if (cmd === 'git') return SAFE_GIT.has(sub);
    if (cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') return SAFE_NPM.has(sub);
    return SAFE_BASH.has(cmd);
  });
  if (readOnly) return { action: 'READ_DATA', destination: 'INTERNAL' };
  return { action: 'WRITE_DATA', destination: 'INTERNAL' };
}

function classifyMcp(toolName) {
  const [, server = 'mcp', ...rest] = toolName.split('__');
  const rawTool = rest.join('__');
  const tool = rawTool.toLowerCase();
  const words = rawTool.split(/[^A-Za-z0-9]+|(?=[A-Z])/).map((w) => w.toLowerCase());
  const has = (re) => words.some((w) => re.test(w));
  const mailish = /mail|gmail|outlook/i.test(server) || /mail/.test(tool);
  let out;
  if (has(/^(delete|remove|drop|purge|destroy|trash|archive|revoke|cancel)/)) out = { action: 'DELETE_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(send|reply|forward|post|message|notify|email|dm|chat)/)) out = mailish ? { action: 'SEND_EMAIL', destination: 'EXTERNAL_EMAIL' } : { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(export|share|upload|publish|invite|transfer|pay|charge|refund|payout|deploy)/)) out = { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(get|list|search|read|fetch|query|find|describe|lookup|view|show|check|count|retrieve|download)$/)) out = { action: 'READ_DATA', destination: 'EXTERNAL_API' };
  else out = { action: 'WRITE_DATA', destination: 'EXTERNAL_API' };
  return { ...out, resource: clip(`mcp:${server}`, 100) };
}

/** Map a PreToolUse input to a Vulnify event body, or null when the tool is skipped. */
export function describe(input, cfg = config()) {
  const name = String(input.tool_name || '');
  const ti = input.tool_input || {};
  if (!name || cfg.skip.has(name)) return null;
  if (/^mcp__vulnify__/.test(name)) return null; // Vulnify's own tools
  let ev;
  let content = '';
  if (name === 'Bash' || name === 'PowerShell') {
    const command = String(ti.command || '');
    ev = { ...classifyBash(command), resource: 'shell' };
    content = command;
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    ev = { action: 'WRITE_DATA', destination: 'INTERNAL', resource: 'local files' };
    content = String(ti.content ?? ti.new_string ?? ti.new_source ?? '');
  } else if (name === 'WebFetch') {
    ev = { action: 'READ_DATA', destination: 'EXTERNAL_API', resource: 'web' };
    content = String(ti.url || '');
  } else if (name.startsWith('mcp__')) {
    ev = classifyMcp(name);
    content = JSON.stringify(ti);
  } else {
    ev = { action: 'WRITE_DATA', destination: 'INTERNAL', resource: clip(`tool:${name}`, 100) };
    content = JSON.stringify(ti);
  }
  if (ev.action === 'READ_DATA' && !cfg.checkReads && name !== 'WebFetch') return null;
  const body = { agent: cfg.agent, action: ev.action, resource: ev.resource, destination: ev.destination, recordsAffected: 1 };
  const risky = ['SEND_EMAIL', 'EXPORT_DATA', 'DELETE_DATA'].includes(ev.action) || name === 'WebFetch';
  if (content && (cfg.sendContent === 'always' || (cfg.sendContent === 'risky' && risky))) body.content = clip(content, 20000);
  return body;
}

function out(decision, reason, extra = {}) {
  const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason };
  return { hookSpecificOutput, ...extra };
}

async function call(cfg, fetchImpl, method, path, body, idem) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const headers = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'vulnify-claude-code-hook/0.1' };
    if (idem) headers['Idempotency-Key'] = idem;
    const res = await fetchImpl(cfg.baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}${json.message ? `: ${String(json.message).slice(0, 200)}` : ''}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** Decide one PreToolUse input. Returns the JSON to print, or null for "no decision". */
export async function decide(input, { cfg = config(), fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const body = describe(input, cfg);
  if (!body) return null;
  const degraded = (why) => cfg.failOpen
    ? { systemMessage: `Vulnify degraded (${why}); ${input.tool_name} ran without a check because VULNIFY_HOOK_FAIL_OPEN=true.` }
    : out('deny', `Vulnify could not check this action (${why}), so it was held (fail closed). Tell the user; do not try to work around it.`);
  if (!cfg.apiKey) return degraded('VULNIFY_API_KEY is not set');
  let d;
  try {
    d = await call(cfg, fetchImpl, 'POST', '/v1/events', body, input.tool_use_id ? `cc-${input.tool_use_id}` : undefined);
    let final = d.finalDecision ?? d.decision;
    const deadline = Date.now() + cfg.reviewWaitMs;
    while (final === 'REVIEW' && d.id && Date.now() < deadline) {
      await sleep(Math.min(3000, Math.max(0, deadline - Date.now())));
      d = await call(cfg, fetchImpl, 'GET', `/v1/events/${encodeURIComponent(d.id)}`);
      final = d.finalDecision ?? d.decision;
    }
  } catch (e) {
    return degraded(e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200));
  }
  const final = d.finalDecision ?? d.decision;
  const reasons = Array.isArray(d.reasons) && d.reasons.length ? d.reasons.join('; ') : 'no reasons given';
  const tag = `${body.action}${body.destination ? ` -> ${body.destination}` : ''}`;
  if (final === 'ALLOW') return cfg.allowMode === 'allow' ? out('allow', `Vulnify ALLOW (${tag}, event ${d.id})`) : null;
  if (final === 'REVIEW') {
    return out('deny', `Vulnify REVIEW (${tag}, event ${d.id}): waiting for approval in Vulnify. Reasons: ${reasons}. Tell the user a person must approve it at app.vulnify.io/approvals, then retry after approval.`);
  }
  if (final === 'BLOCK') return out('deny', `Vulnify BLOCK (${tag}, event ${d.id}): ${reasons}. Do not retry or work around this; tell the user.`);
  return degraded(`unexpected decision ${String(final).slice(0, 40)}`);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    const cfg = config();
    if (cfg.failOpen) return;
    process.stderr.write('Vulnify hook: could not parse PreToolUse input; holding the action (fail closed).\n');
    process.exit(2);
  }
  const result = await decide(input);
  if (result) process.stdout.write(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('vulnify-hook.mjs')) {
  main().catch((e) => {
    if (process.env.VULNIFY_HOOK_FAIL_OPEN === 'true') return;
    process.stderr.write(`Vulnify hook failed: ${String(e?.message || e).slice(0, 200)}. Holding the action (fail closed).\n`);
    process.exit(2);
  });
}
