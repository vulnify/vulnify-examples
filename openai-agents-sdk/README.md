# OpenAI Agents SDK (Python) + Vulnify

Shows: each `function_tool` wrapped with `guard_openai_agents_tool` from `vulnify.adapters`, then handed to an `Agent`. The real `Runner` executes the tool only when Vulnify returns ALLOW. On REVIEW or BLOCK the model receives the reason text and the tool body does not run.

`StubModel` requests the three calls, so there is no OpenAI key. Pass `model="gpt-4.1"` to `Agent(...)` when you want a live model.

| Tool | What Vulnify is told | Result |
|---|---|---|
| `read_file` | `READ_DATA` on `Project Files`, 1 record | ALLOW. The file is read. |
| `export_customers` | `EXPORT_DATA` of 800 records to `EXTERNAL_EMAIL` | REVIEW. Held for a person. The export does not run. |
| `delete_production_database` | `DELETE_DATA` on `Production Database` | BLOCK. The delete does not run. |

A person approves or denies a REVIEW in the [Vulnify app](https://app.vulnify.io) or in Slack. Pass `wait={"timeout": 120}` to `guard_openai_agents_tool` when this process should wait for that answer.

## Setup

1. Sign up at https://app.vulnify.io and create a TEST key. Copy `.env.example` to `.env` (gitignored) and paste the key there.
2. Install the pinned packages:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

3. Run it:

```bash
python main.py     # mock mode when .env has no real key; live when VULNIFY_API_KEY is set
python main.py --mock
pytest -q          # offline
```

Mock mode does not call the API. It applies the demo policy in `mock_client.py`, so you see all three outcomes.

With a TEST key, the same three descriptions go to `https://api.vulnify.io` through `Vulnify.guard`. On a new organization the risk engine allows the read and sends the 800-record external export to REVIEW. A production delete is BLOCK once a DELETE policy in the app says so. Until that policy exists, the API's own score decides, and the mock is what shows BLOCK. Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.
