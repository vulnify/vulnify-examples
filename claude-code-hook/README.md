# Claude Code + Vulnify (PreToolUse hook)

Shows: a [`PreToolUse` hook](https://code.claude.com/docs/en/hooks) that asks Vulnify before Claude Code runs a shell command, writes a file, fetches a URL, or calls an MCP tool. Claude Code runs the hook itself, before the tool. The hook is `vulnify-hook.mjs` (Node 18+, no dependencies). The config is [`.claude/settings.json`](.claude/settings.json).

| Vulnify result | What Claude Code does |
|---|---|
| `ALLOW` | Normal permission flow (set `VULNIFY_HOOK_ALLOW_MODE=allow` to auto-approve instead) |
| `REVIEW` | Denied, with the event id, until a person approves in the Vulnify app or in Slack. Then ask Claude to retry |
| `BLOCK` | Denied with Vulnify's reasons |
| Vulnify unreachable, bad key, timeout | Denied (fail closed). `VULNIFY_HOOK_FAIL_OPEN=true` lets it run and shows a "Vulnify degraded" warning |

`demo.mjs` feeds three tool calls through that hook:

| Tool call | What the hook sends | Mock result |
|---|---|---|
| `cat README.md` | `READ_DATA` (only when `VULNIFY_HOOK_CHECK_READS=true`; the demo sets this) | ALLOW. Claude Code continues its normal permission flow. |
| `curl -F file=@customers.csv --limit 800 https://files.example.com/up` | `EXPORT_DATA` to `EXTERNAL_API`, 800 records | REVIEW. The hook denies it until a person approves. |
| `psql -c "DROP DATABASE production"` | `DELETE_DATA`, the command text included | BLOCK. The hook denies it. |

The Read tool itself is not sent. Read-only shell commands are skipped unless `VULNIFY_HOOK_CHECK_READS=true`. The hook classifies that curl upload as `EXTERNAL_API`, not `EXTERNAL_EMAIL`. The other examples in this repo send the export as `EXTERNAL_EMAIL` because the tool argument is an address. Both are held on REVIEW in mock mode.

## Setup

1. Sign up at https://app.vulnify.io and create a TEST key. Copy `.env.example` to `.env` (gitignored) and paste the key there.
2. Nothing to install for the hook. Node 18 or newer runs `vulnify-hook.mjs`. To put it in a project, copy `vulnify-hook.mjs` to `.claude/hooks/vulnify-hook.mjs` and use [`.claude/settings.json`](.claude/settings.json), or run `npx @vulnify/cli hook claude-code` (add `--user` for every project, `--uninstall` to remove). That command reads `VULNIFY_API_KEY` or asks for it, and does not print the key.
3. Run the demo, the offline test, and the local audit (no API key, nothing is uploaded):

```bash
node --env-file-if-exists=.env demo.mjs          # mock unless VULNIFY_API_KEY is a real key
node --env-file-if-exists=.env demo.mjs --mock
npm test
npx @vulnify/cli audit
```

Mock mode (`node demo.mjs --mock`, or no key) does not call the API. `demo.mjs` BLOCKs the command `DROP DATABASE production`, so this run shows BLOCK with no policy.

Live mode (`node --env-file-if-exists=.env demo.mjs` with a real `VULNIFY_API_KEY`) posts the three events. The read is ALLOW and the 800-record upload is REVIEW from the risk engine. The drop is `DELETE_DATA` on resource `shell` (the hook estimates about 10000 records). It is not BLOCK until a policy matches `DELETE_DATA`. Until then the risk engine decides.

The hook script has no method that creates a policy. In the app at https://app.vulnify.io, open Policies and create:

| Field | Value |
|---|---|
| Name | `block-deletes` |
| Action family | `DELETE` |
| Resource type | `ANY` |
| Condition action | `DELETE_DATA` |
| Decision | `BLOCK` |
| Mode | `ENFORCE` |

The same rule is [policies/block-deletes.yaml](../policies/block-deletes.yaml). It matches every `DELETE_DATA`, including this drop. A policy file has no field for the words "production database" (`spec.resource` is a type such as `ANY`).

Apply the file with an org-wide LIVE key. The TEST key in `.env` runs the hook and is not enough for `apply`. From the repo root:

```bash
npx -p @vulnify/sdk@0.3.3 vulnify policies validate policies/block-deletes.yaml
npx -p @vulnify/sdk@0.3.3 vulnify policies apply policies/block-deletes.yaml
```

Run the demo again with the TEST key. The drop comes back BLOCK.

The audit checks the agent config files on this machine and in the current directory. It does not use an API key.

## Set it up by hand


1. Copy `vulnify-hook.mjs` into your project as `.claude/hooks/vulnify-hook.mjs`.
2. Export a key in the shell you start Claude Code from (don't commit it): `export VULNIFY_API_KEY=vln_...`. A TEST key from app.vulnify.io/api-keys works for trying it out.
3. Add this to `.claude/settings.json` (or `~/.claude/settings.json` for every project):

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.*",
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
| `Bash` with `curl -X DELETE`, `aws s3 rm`, `kubectl delete` | `DELETE_DATA` | `EXTERNAL_API` |
| `Bash` with `mail`/`sendmail`/`swaks`/`msmtp`, `curl smtp(s)://`/`--mail-rcpt`, `aws ses send-email`, SendGrid/Mailgun/Resend/Postmark APIs, `smtplib` | `SEND_EMAIL` | `EXTERNAL_EMAIL` |
| `Bash` with `curl -X POST`/`-d`/`-F`/`-T`, `wget --post-file`, `scp`, `rsync`, `nc`, `git push`, `npm publish`, `aws s3 cp`, `gh release upload`, Slack/Discord webhooks | `EXPORT_DATA` | `EXTERNAL_API` |
| Other `Bash` that may change things | `WRITE_DATA` | `INTERNAL` |
| Read-only `Bash` (`ls`, `cat`, `grep`, `git status`, ...) | skipped | |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `WRITE_DATA` (resource `local files`) | `INTERNAL` |
| `WebFetch` | `READ_DATA` (resource `web`) | `EXTERNAL_API` |
| `mcp__<server>__send_*` / `reply` / `post*` | `SEND_EMAIL` for mail servers or when `to`/`cc`/`recipients` hold email addresses, else `EXPORT_DATA` | `EXTERNAL_EMAIL` / `EXTERNAL_API` |
| `mcp__<server>__delete_*` / `remove` / `cancel` | `DELETE_DATA` | `EXTERNAL_API` |
| `mcp__<server>__export_*` / `share` / `upload` / `pay` | `EXPORT_DATA` | `EXTERNAL_API` |
| `mcp__<server>__create_*` / `update_*` / other | `WRITE_DATA` | `EXTERNAL_API` |
| `mcp__<server>__get_*` / `list_*` / `search_*` | skipped (`VULNIFY_HOOK_CHECK_READS=true` to check) | |
| `Read`, `Glob`, `Grep`, `TodoWrite`, `Task`, `WebSearch`, `mcp__vulnify__*` | skipped | |

`recordsAffected` is estimated: SQL `LIMIT n`, `--limit`/`-n`/`--count n`, `DELETE`/`UPDATE` without `WHERE` or `DROP`/`TRUNCATE` (10,000), the files given to `rm`/`scp` (100 when recursive or a glob), email recipients, and for MCP calls `limit`/`count` fields and the length of id or recipient lists. Otherwise 1.

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
