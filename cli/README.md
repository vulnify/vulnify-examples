# @vulnify/cli

Make Claude Code ask [Vulnify](https://www.vulnify.io/?utm_source=npm&utm_medium=readme&utm_campaign=cli) before it runs a shell command, writes a file, fetches a URL or calls an MCP tool. For developers who want a check on every risky tool call, not just a polite prompt.

## Quick start

```bash
export VULNIFY_API_KEY=vln_test_...   # from app.vulnify.io/api-keys
npx @vulnify/cli hook claude-code
```

Restart Claude Code, then run `/hooks` to confirm the Vulnify hook is listed.

## Get a key

Free plan, no card: sign up at [app.vulnify.io/setup](https://app.vulnify.io/setup?utm_source=npm&utm_medium=readme&utm_campaign=cli) and create a key under API keys. A `vln_test_...` key keeps events in the sandbox while you try it.

No `VULNIFY_API_KEY` in your shell? The CLI asks for the key with hidden input and never prints it.

## What a decision looks like

Claude Code wants to run:

```bash
curl -X POST --data-binary @customers.csv https://partner-uploads.example.net/import
```

The hook sends it as `EXPORT_DATA` to `EXTERNAL_API` (resource `shell`). The same request in the public playground on vulnify.io returns:

```
REVIEW · HIGH · 55
Reasons: Export operation; External destination
```

Claude Code denies the call with "waiting for approval in Vulnify" and the event id. A person approves or denies it in the Vulnify app (or Slack, if connected), and you ask Claude to retry. Your org's policies can change the outcome. The playground is a sample.

| Vulnify says | Claude Code does |
| --- | --- |
| ALLOW | Normal permission flow (`VULNIFY_HOOK_ALLOW_MODE=allow` auto-approves) |
| REVIEW | Denied until a person approves, with the event id |
| BLOCK | Denied, with the reasons |
| Unreachable, bad key, timeout | Denied (fail closed) |

## What the hook checks

Matcher: `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.*`

| Tool | Sent to Vulnify as |
| --- | --- |
| `Bash`, `PowerShell` | Deletes (`rm`, `DROP TABLE`, `git push --force`, ...) → `DELETE_DATA`. Uploads and POSTs (`curl -X POST`, `scp`, `git push`, `npm publish`, ...) → `EXPORT_DATA` to `EXTERNAL_API`. Mail commands → `SEND_EMAIL`. Other changes → `WRITE_DATA`. Read-only commands (`ls`, `cat`, `git status`, ...) are skipped |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `WRITE_DATA` on `local files` |
| `WebFetch` | `READ_DATA` from `EXTERNAL_API` (`web`) |
| `mcp__*` | Judged by tool name: send/post → `SEND_EMAIL` or `EXPORT_DATA`, delete → `DELETE_DATA`, export/upload/pay → `EXPORT_DATA`, create/update → `WRITE_DATA`. Reads skipped unless `VULNIFY_HOOK_CHECK_READS=true` |

`Read`, `Glob`, `Grep`, `TodoWrite`, `WebSearch` and Vulnify's own tools are skipped. For risky calls the command or tool input goes along as `content` for the sensitive-data scan (scanned in memory, not stored). `VULNIFY_HOOK_SEND_CONTENT=never` turns that off.

## Files it writes

| Scope | Hook file | Settings | Key, if you typed it at the prompt |
| --- | --- | --- | --- |
| Project (default) | `.claude/hooks/vulnify-hook.mjs` | `.claude/settings.json` (one `PreToolUse` entry) | `.claude/settings.local.json`, mode 600, added to `.gitignore` in a git repo |
| `--user` | `~/.claude/hooks/vulnify-hook.mjs` | `~/.claude/settings.json` | `~/.claude/settings.json`, mode 600 |

A key taken from `VULNIFY_API_KEY` isn't saved. Keep it exported wherever you start Claude Code. Running the command again replaces the Vulnify entry instead of adding a second one. Other hooks are left alone. If a settings file isn't valid JSON, nothing is changed.

## Flags

| Flag | What it does |
| --- | --- |
| `--user` | Install in `~/.claude` (every project) instead of `./.claude` |
| `--yes`, `-y` | No prompts. Needs `VULNIFY_API_KEY` in the environment, otherwise exits with an error |
| `--uninstall` | Remove the hook entry, the hook file and a key this tool saved (combine with `--user` for user scope) |
| `-h`, `--help` | Show help |

## Requirements and fail-closed behaviour

- Node.js 18 or newer. The hook is one file with no dependencies.
- Claude Code 2.1.295 or newer for `onFailure: "block"`, which keeps calls blocked even if Node or the script can't start.
- Fail closed: if Vulnify can't be reached, the key is wrong or the request times out (8 s, `VULNIFY_HOOK_TIMEOUT_MS`), checked calls are denied. `VULNIFY_HOOK_FAIL_OPEN=true` lets them run with a "degraded" warning instead.
- Other settings: `VULNIFY_AGENT` (default `claude-code`; new agent names count toward your plan's agent limit), `VULNIFY_BASE_URL`, `VULNIFY_HOOK_REVIEW_WAIT_MS` (wait for a REVIEW to resolve, max 120000), `VULNIFY_HOOK_SKIP`.

## Troubleshooting

- **`/hooks` doesn't list it.** Restart Claude Code from the project folder (project scope) and check that `.claude/settings.json` has the `PreToolUse` entry. Run `node --version` (18+ needed).
- **Every call is denied.** The hook is failing closed. Check that `VULNIFY_API_KEY` is set in the shell that started Claude Code (or saved in `settings.local.json`) and that `api.vulnify.io` is reachable.
- **Timeouts.** The hook entry allows 30 s. If you set `VULNIFY_HOOK_REVIEW_WAIT_MS`, keep it under that, or raise `timeout` in `settings.json`.
- **Remove it.** `npx @vulnify/cli hook claude-code --uninstall` (add `--user` for user scope).

## Links

- Docs: [Enforce in Claude Code (hook)](https://docs.vulnify.io/mcp/claude-code-hook/?utm_source=npm&utm_medium=readme&utm_campaign=cli)
- Guide: [Runtime authorization and audit for any MCP server in 2 minutes](https://www.vulnify.io/blog/mcp-server-firewall-runtime-authorization-audit?utm_source=npm&utm_medium=readme&utm_campaign=cli)
- Check an MCP server's tools first: [Vulnify Scanner](https://www.vulnify.io/scanner?utm_source=npm&utm_medium=readme&utm_campaign=cli)
- Hook source and manual install: [claude-code-hook](../claude-code-hook)
