# Claude Agent SDK + Vulnify

Shows: a [`canUseTool`](https://docs.claude.com/en/api/agent-sdk/permissions) callback that asks Vulnify before Claude **sends an email** or **deletes files** (`rm` in Bash). On ALLOW the tool runs. On REVIEW or BLOCK, Claude gets a deny message with the reasons and the event id.

> **Scripted tool requests, real Vulnify.** `npm start` feeds `canUseTool` the exact tool requests Claude would make, so you don't need an Anthropic key. The Vulnify checks are real API calls. `npm run real` wires the same callback into `query()` from `@anthropic-ai/claude-agent-sdk`. That needs `ANTHROPIC_API_KEY` and Claude Code, and it was not part of our live test.

## Run it (2 minutes)

```bash
npm install
cp .env.example .env   # add a TEST key from app.vulnify.io/api-keys
npm start
npm test               # offline, no key needed
```

Set `VULNIFY_AGENT` to an agent that already exists in your org. New names register on first use and count toward your plan's agent limit.

## Expected output

```
mcp__mail__send_email team@acme.internal: ALLOW
mcp__mail__send_email someone@gmail.com: DENY - Vulnify REVIEW (event …): Write operation; Sensitive data detected in content: CPF, EMAIL; External destination; …
Bash rm -rf ./exports/customers: ALLOW
Read README.md: ALLOW
```

- The external email contains a CPF and an email address, so Vulnify sends it to REVIEW. The content is scanned in memory and not stored.
- On a fresh org, deleting local files scores below the REVIEW threshold. To gate every delete, add a policy in app.vulnify.io (for example, `DELETE_DATA` goes to REVIEW).
- Tools Vulnify doesn't need to see (like `Read`) are allowed without a call.

## Mapping

| Tool request | Vulnify action | destination |
|---|---|---|
| `*send_email` to your domain | `SEND_EMAIL` | `INTERNAL` |
| `*send_email` anywhere else | `SEND_EMAIL` | `EXTERNAL_EMAIL` |
| `Bash` with `rm` | `DELETE_DATA` | `INTERNAL` |

Tested live on 2026-10-16 against a Vulnify TEST organization with `@anthropic-ai/claude-agent-sdk@0.3.301` and `@vulnify/sdk@0.3.3`.
