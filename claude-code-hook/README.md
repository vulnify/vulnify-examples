# Claude Code + Vulnify (PreToolUse hook)

Shows: real enforcement in Claude Code. A [`PreToolUse` hook](https://code.claude.com/docs/en/hooks) asks Vulnify before Claude runs a shell command, writes a file, fetches a URL, or calls an MCP tool. This doesn't rely on the model remembering to check: Claude Code runs the hook before every matching tool call.

| Vulnify result | What Claude Code does |
|---|---|
| `ALLOW` | Normal permission flow (set `VULNIFY_HOOK_ALLOW_MODE=allow` to auto-approve instead) |
| `REVIEW` | Denied with "waiting for approval in Vulnify" and the event id. Approve at app.vulnify.io/approvals, then ask Claude to retry |
| `BLOCK` | Denied with Vulnify's reasons |
| Vulnify unreachable, bad key, timeout | Denied (fail closed). `VULNIFY_HOOK_FAIL_OPEN=true` lets it run and shows a "Vulnify degraded" warning |

No dependencies: one Node 18+ script, `vulnify-hook.mjs`.

## Set it up (2 minutes)

1. Copy `vulnify-hook.mjs` into your project as `.claude/hooks/vulnify-hook.mjs`.
2. Export a key in the shell you start Claude Code from (don't commit it): `export VULNIFY_API_KEY=vln_...`. A TEST key from app.vulnify.io/api-keys works for trying it out.
3. Add this to `.claude/settings.json` (or `~/.claude/settings.json` for every project):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/vulnify-hook.mjs"],
            "timeout": 30,
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

`onFailure: "block"` (Claude Code 2.1.295+) keeps the hook fail closed even if Node or the script can't start. Run `/hooks` in Claude Code to confirm it is loaded.

## Mapping

| Tool call | Vulnify action | destination |
|---|---|---|
| `Bash` with `rm`, `DROP TABLE`, `git push --force`, `git reset --hard` | `DELETE_DATA` | `INTERNAL` |
| `Bash` with `curl -X POST`/`-d`, `scp`, `rsync`, `git push`, `npm publish` | `EXPORT_DATA` | `EXTERNAL_API` |
| `Bash` with `mail`/`sendmail` | `SEND_EMAIL` | `EXTERNAL_EMAIL` |
| Other `Bash` that may change things | `WRITE_DATA` | `INTERNAL` |
| Read-only `Bash` (`ls`, `cat`, `grep`, `git status`, ...) | skipped | |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `WRITE_DATA` (resource `local files`) | `INTERNAL` |
| `WebFetch` | `READ_DATA` (resource `web`) | `EXTERNAL_API` |
| `mcp__<server>__send_*` / `reply` / `post*` | `SEND_EMAIL` for mail servers, else `EXPORT_DATA` | `EXTERNAL_EMAIL` / `EXTERNAL_API` |
| `mcp__<server>__delete_*` / `remove` / `cancel` | `DELETE_DATA` | `EXTERNAL_API` |
| `mcp__<server>__export_*` / `share` / `upload` / `pay` | `EXPORT_DATA` | `EXTERNAL_API` |
| `mcp__<server>__create_*` / `update_*` / other | `WRITE_DATA` | `EXTERNAL_API` |
| `mcp__<server>__get_*` / `list_*` / `search_*` | skipped (`VULNIFY_HOOK_CHECK_READS=true` to check) | |
| `Read`, `Glob`, `Grep`, `TodoWrite`, `Task`, `WebSearch`, `mcp__vulnify__*` | skipped | |

The resource is `shell`, `local files`, `web`, or `mcp:<server>`. Add policies for those names in app.vulnify.io, for example "`DELETE_DATA` on `shell` goes to REVIEW".

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `VULNIFY_API_KEY` | required | Without it every checked call is denied (or allowed with a warning when fail-open) |
| `VULNIFY_AGENT` | `claude-code` | Agent name in Vulnify. New names register on first use and count toward your plan's agent limit |
| `VULNIFY_HOOK_ALLOW_MODE` | `defer` | `allow` auto-approves on ALLOW, skipping Claude Code's own prompt |
| `VULNIFY_HOOK_REVIEW_WAIT_MS` | `0` | Wait up to this long (max 120000) for a person to resolve a REVIEW before denying |
| `VULNIFY_HOOK_FAIL_OPEN` | `false` | `true` lets calls run when Vulnify can't be reached, with a "degraded" warning |
| `VULNIFY_HOOK_SKIP` | | Extra tool names to skip, comma-separated |
| `VULNIFY_HOOK_SKIP_DEFAULTS` | `true` | `false` checks the read-only tools too |
| `VULNIFY_HOOK_CHECK_READS` | `false` | `true` also checks read-only MCP tools |
| `VULNIFY_HOOK_SEND_CONTENT` | `risky` | Sends the command or tool input as `content` for the sensitive-data scan on send, export, delete, and WebFetch. `always` or `never`. Content is scanned in memory and not stored |
| `VULNIFY_HOOK_TIMEOUT_MS` | `8000` | Per request |
| `VULNIFY_BASE_URL` | `https://api.vulnify.io` | |

Each call sends `Idempotency-Key: cc-<tool_use_id>`, so a retried hook doesn't record a second event.

## Try it without Claude Code

```bash
export VULNIFY_API_KEY=vln_test_your_key
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__gmail__send_email","tool_input":{"to":"someone@gmail.com","body":"CPF 123.456.789-09"},"tool_use_id":"t1"}' | node vulnify-hook.mjs
npm test   # offline, no key needed
```

## Expected output (live run, 2026-10-16)

```
Read README.md                                  -> skipped, exit 0
Bash rm -rf ./tmp-build                         -> ALLOW, no decision (normal permission flow)
Write notes.md                                  -> ALLOW, no decision
mcp__gmail__send_email to someone@gmail.com     -> deny: Vulnify REVIEW (SEND_EMAIL -> EXTERNAL_EMAIL, event …): waiting for approval in Vulnify. Reasons: Write operation; Sensitive data detected in content: CPF, EMAIL; External destination; …
Bash curl -X POST … -d @customers.csv           -> deny: Vulnify REVIEW (EXPORT_DATA -> EXTERNAL_API, event …): …
Vulnify unreachable                             -> deny: Vulnify could not check this action (fetch failed), so it was held (fail closed)
Invalid API key                                 -> deny: … (HTTP 401: Invalid API key) …
```

On a fresh org, deleting local files scores below the REVIEW threshold. To gate every delete, add a policy. BLOCK comes from your policies; it is covered by the offline test.

Tested live on 2026-10-16 by piping Claude Code's PreToolUse JSON into the hook against a Vulnify TEST organization. It was not run inside a Claude Code session in our test.
