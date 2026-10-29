# OpenAI Agents SDK (TypeScript) + Vulnify

Shows: tool configs wrapped with `guardOpenAIAgentsTool` from `@vulnify/sdk`, then passed to `tool()` and an `Agent` from `@openai/agents`. The runner calls `execute` only when Vulnify returns ALLOW. On REVIEW or BLOCK the model receives the reason text and `execute` does not run.

The model is `ScriptedModel` from `@openai/agents/testing`, so there is no OpenAI key. Drop that option and set a model name on the agent when you want a live model.

| Tool | What Vulnify is told | Result |
|---|---|---|
| `read_file` | `READ_DATA` on `Project Files`, 1 record | ALLOW. The file is read. |
| `export_customers` | `EXPORT_DATA` of 800 records to `EXTERNAL_EMAIL` | REVIEW. Held for a person. The export does not run. |
| `delete_production_database` | `DELETE_DATA` on `Production Database` | BLOCK. The delete does not run. |

A person approves or denies a REVIEW in the [Vulnify app](https://app.vulnify.io) or in Slack. Pass `{ wait: { timeoutMs: 120000 } }` as the fourth argument of `guardOpenAIAgentsTool` when this process should wait for that answer.

## Setup

1. Sign up at https://app.vulnify.io and create a TEST key. Copy `.env.example` to `.env` (gitignored) and paste the key there.
2. Install the pinned packages: `npm install`
3. Run it:

```bash
npm start            # mock mode when .env has no real key; live when VULNIFY_API_KEY is set
node --env-file-if-exists=.env index.mjs --mock
npm test             # offline
```

Mock mode does not call the API. It applies the demo policy in `mock.mjs`, so you see all three outcomes.

With a TEST key, the same three descriptions go to `https://api.vulnify.io` through `Vulnify.guard`. On a new organization the risk engine allows the read and sends the 800-record external export to REVIEW. A production delete is BLOCK once a DELETE policy in the app says so. Until that policy exists, the API's own score decides, and the mock is what shows BLOCK. Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.

Packages: `@openai/agents@0.21.0`, `@vulnify/sdk@0.3.3`, `zod@4.6.7`.
