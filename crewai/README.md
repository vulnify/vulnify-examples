# CrewAI + Vulnify

Shows: CrewAI `BaseTool`s wrapped with `guard_crewai_tool` from `vulnify.adapters`, then attached to an `Agent` and a `Crew`. The tool's `_run` executes only when Vulnify returns ALLOW. On REVIEW or BLOCK the agent receives Vulnify's reasons and the tool body does not run.

The demo does not call a model. It runs the three calls the crew is set up to make:

| Tool | What Vulnify is told | Result |
|---|---|---|
| `read_file` | `READ_DATA` on `Project Files`, 1 record | ALLOW. The file is read. |
| `export_customers` | `EXPORT_DATA` of 800 records to `EXTERNAL_EMAIL` | REVIEW. Held for a person. The export does not run. |
| `delete_production_database` | `DELETE_DATA` on `Production Database` | BLOCK. The delete does not run. |

A person approves or denies a REVIEW in the [Vulnify app](https://app.vulnify.io) or in Slack. Pass `wait={"timeout": 120}` to `guarded_tools()` when this process should wait for that answer.

`crew.kickoff()` is how a model drives the same tools. It needs a model key, and the model may not request every tool, so the default run calls the tools directly.

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
