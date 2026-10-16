# Vercel AI SDK + Vulnify

Shows: every tool call is checked by Vulnify **before** its `execute()` runs, using `guardAiSdkTools` from [`@vulnify/sdk`](https://www.npmjs.com/package/@vulnify/sdk). A customer lookup is allowed. Exporting 800 customers to an outside email gets REVIEW, so the export never runs, and the model gets a "blocked" tool result instead.

> **Stub model, real Vulnify.** The LLM here is the AI SDK's `MockLanguageModelV3` scripted to request both tools, so you need no model API key. The Vulnify checks are real API calls. To use a real model, pass e.g. `openai('gpt-4.1')` to `run()`.

## Run it (2 minutes)

```bash
npm install
cp .env.example .env   # add a TEST key from app.vulnify.io/api-keys
npm start
npm test               # offline, no key needed
```

Set `VULNIFY_AGENT` to an agent that already exists in your org. A new name registers on first use and counts toward your plan's agent limit.

## Expected output

```
lookupCustomer: ran -> {"email":"ana@example.com","plan":"TEAM"}
exportCustomers: NOT RUN, Vulnify REVIEW (event 606a8eec-…): Export operation; External destination; Large data volume (800 records)
side effects: [ 'lookupCustomer ana@example.com' ]
```

On a fresh org the score is 65 (export 30 + external 25 + over 100 records 10), which means REVIEW. With a policy that blocks external exports you get BLOCK. Open the event in app.vulnify.io to approve or deny it. To wait for that review instead of failing fast, pass `{ wait: { timeoutMs } }` as the guard options.

## How it works

```js
const tools = guardAiSdkTools(vulnify, rawTools, {
  exportCustomers: ({ count }) => ({ agent, action: 'EXPORT_DATA', resource: 'customers', destination: 'EXTERNAL_EMAIL', recordsAffected: count }),
});
```

The valid values for `action` are `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA` and `SEND_EMAIL`. The valid values for `destination` are `INTERNAL`, `EXTERNAL_EMAIL` and `EXTERNAL_API`.

Tested live on 2026-10-16 against a Vulnify TEST organization with `ai@7.0.143` and `@vulnify/sdk@0.3.3`.
