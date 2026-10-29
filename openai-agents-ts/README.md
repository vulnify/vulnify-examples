# OpenAI Agents SDK (TypeScript) + Vulnify

Shows: tool configs wrapped with `guardOpenAIAgentsTool` from `@vulnify/sdk`, then passed to `tool()` and an `Agent` from `@openai/agents`. The runner calls `execute` only when Vulnify returns ALLOW. On REVIEW or BLOCK the model receives the reason text and `execute` does not run.

The model is `ScriptedModel` from `@openai/agents/testing`, set on the `Agent` as `model`. The runner uses that and does not ask for `OPENAI_API_KEY`. Set a model name on the agent when you want a live model.

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

Mock mode (`node index.mjs --mock`, or no key) does not call the API. `mock.mjs` BLOCKs a delete whose resource name contains "production", so this run shows BLOCK with no policy.

Live mode (`npm start` with a real `VULNIFY_API_KEY`) posts the three checks through `Vulnify.guard`. On a new organization the risk engine ALLOWs the read and sends the 800-record external export to REVIEW. It does not BLOCK the production delete. That call is `DELETE_DATA` on `Production Database` with `recordsAffected` 1, and a small delete is often ALLOW. BLOCK shows up only after a policy matches it.

The Node client has no method that creates a policy. In the app at https://app.vulnify.io, open Policies and create:

| Field | Value |
|---|---|
| Name | `block-deletes` |
| Action family | `DELETE` |
| Resource type | `ANY` |
| Condition action | `DELETE_DATA` |
| Decision | `BLOCK` |
| Mode | `ENFORCE` |

The same rule is [policies/block-deletes.yaml](../policies/block-deletes.yaml). It matches every `DELETE_DATA`, not only the name `Production Database`. A policy file has no field for that name (`spec.resource` is a type such as `ANY`). A rule that only blocks large deletes does not match this demo, because `recordsAffected` is 1.

Apply the file with an org-wide LIVE key. The TEST key in `.env` runs the checks and is not enough for `apply`. From the repo root:

```bash
npx -p @vulnify/sdk@0.3.3 vulnify policies validate policies/block-deletes.yaml
npx -p @vulnify/sdk@0.3.3 vulnify policies apply policies/block-deletes.yaml
```

Run `npm start` again. The delete comes back BLOCK.

Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.

Packages: `@openai/agents@0.21.0`, `@vulnify/sdk@0.3.3`, `zod@4.6.7`.
