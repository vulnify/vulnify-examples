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

Mock mode (`python main.py --mock`, or no key) does not call the API. `mock_client.py` BLOCKs a delete whose resource name contains "production", so this run shows BLOCK with no policy.

Live mode (`python main.py` with a real `VULNIFY_API_KEY`) posts the three checks through `Vulnify.guard`. On a new organization the risk engine ALLOWs the read and sends the 800-record external export to REVIEW. It does not BLOCK the production delete. That call is `DELETE_DATA` on `Production Database` with `records_affected` 1, and a small delete is often ALLOW. BLOCK shows up only after a policy matches it.

`Vulnify` has no method that creates a policy. In the app at https://app.vulnify.io, open Policies and create:

| Field | Value |
|---|---|
| Name | `block-deletes` |
| Action family | `DELETE` |
| Resource type | `ANY` |
| Condition action | `DELETE_DATA` |
| Decision | `BLOCK` |
| Mode | `ENFORCE` |

The same rule is [policies/block-deletes.yaml](../policies/block-deletes.yaml). It matches every `DELETE_DATA`, not only the name `Production Database`. A policy file has no field for that name (`spec.resource` is a type such as `ANY`). A rule that only blocks large deletes does not match this demo, because `records_affected` is 1.

Apply the file with an org-wide LIVE key. The TEST key in `.env` runs the checks and is not enough for `apply`.

```bash
pip install "vulnify[cli]==0.4.2"
vulnify policies validate ../policies/block-deletes.yaml
vulnify policies apply ../policies/block-deletes.yaml
```

From the repo root, `npx -p @vulnify/sdk@0.3.3 vulnify policies validate policies/block-deletes.yaml` and the same command with `apply` do the same thing. Run `python main.py` again. The delete comes back BLOCK.

Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.
