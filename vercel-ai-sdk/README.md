# Vercel AI SDK + Vulnify

Shows: tools passed to `generateText`, wrapped with `guardAiSdkTools` from [`@vulnify/sdk`](https://www.npmjs.com/package/@vulnify/sdk). Vulnify answers before `execute` runs. ALLOW returns the tool result. REVIEW and BLOCK return `{ blocked: true, decision, reasons, eventId, message }` and `execute` does not run.

The model is `MockLanguageModelV3`, scripted to request three tools, so there is no model API key. Pass a real model, for example `openai('gpt-4.1')`, to `run()` when you want one.

| Tool | What Vulnify is told | Result |
|---|---|---|
| `readFile` | `READ_DATA` on `Project Files`, 1 record | ALLOW. The file is read. |
| `exportCustomers` | `EXPORT_DATA` of 800 records to `EXTERNAL_EMAIL` | REVIEW. Held for a person. The export does not run. |
| `deleteProductionDatabase` | `DELETE_DATA` on `Production Database` | BLOCK. The delete does not run. |

A person approves or denies a REVIEW in the [Vulnify app](https://app.vulnify.io) or in Slack. Pass `{ wait: { timeoutMs: 120000 } }` as the fourth argument of `guardAiSdkTools` when this process should wait for that answer. This demo omits `wait`, so REVIEW returns at once.

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

With a TEST key, the same three descriptions go to `https://api.vulnify.io` through `Vulnify.guard`. On a new organization the risk engine allows the read and sends the 800-record external export to REVIEW (measured score 65: export, external destination, 800 records). A production delete is BLOCK once a DELETE policy in the app says so. Until that policy exists, the API's own score decides, and the mock is what shows BLOCK. Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.

Packages: `@vulnify/sdk@0.3.3`, `ai@7.0.143`, `zod@4.6.7`.
