# Google ADK + Vulnify

Shows: a Google ADK `LlmAgent` whose `before_tool_callback` asks Vulnify before each tool runs. The callback calls `Vulnify.guard`. ALLOW returns `None`, and ADK runs the tool. REVIEW and BLOCK return a dict, which ADK uses as the tool result, so the tool function does not run. The model sees that text.

ADK passes callback arguments by keyword. The parameters have to be named `tool`, `args`, and `tool_context`.

Mock mode uses `ScriptedModel`, a stand-in that requests three calls, so there is no Vulnify key and no model key. With a real `GOOGLE_API_KEY` (or `GEMINI_API_KEY`), the same callback sits in front of a Gemini model. `GOOGLE_MODEL` overrides the model name. The default is the ADK default, `gemini-3.5-flash`.

| Tool | What Vulnify is told | Result |
|---|---|---|
| `read_file` | `READ_DATA` on `Project Files`, 1 record | ALLOW. The file is read. |
| `export_customers` | `EXPORT_DATA` of 800 records to `EXTERNAL_EMAIL` | REVIEW. Held for a person. The export does not run. |
| `delete_production_database` | `DELETE_DATA` on `Production Database` | BLOCK. The delete does not run. |

A person approves or denies a REVIEW in the [Vulnify app](https://app.vulnify.io) or in Slack. Pass `wait={"timeout": 120}` to `run()` or `build()` when this process should wait for that answer. Without `wait`, REVIEW returns immediately and the tool stays unrun.

## Setup

Tested with Python 3.12, `google-adk` 2.13.0, `google-genai` 2.34.0, `vulnify` 0.4.2, and `pytest` 8.4.2. Those versions are pinned in `requirements.txt`.

1. Sign up at https://app.vulnify.io/signup?utm_source=github&utm_medium=examples&utm_campaign=google-adk and create a TEST key. Copy `.env.example` to `.env` (gitignored) and paste the key there. Paste a model key into `GOOGLE_API_KEY` when you want Gemini to choose the calls.
2. Install the pinned packages:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

3. Run it:

```bash
python main.py            # mock when .env has no real key; live Vulnify when VULNIFY_API_KEY is set
python main.py --mock     # scripted model, local decisions, no API call
python main.py --scripted # live Vulnify, scripted model, even if a model key is set
pytest -q                 # offline
```

## Expected output

`python main.py --mock` prints:

```
Mock mode: no API call. A file read is ALLOW, the export is REVIEW, the delete is BLOCK.
read_file: contents of README.md
export_customers: Vulnify REVIEW: Export operation; External destination; Large data volume (800 records). Pending human review.
delete_production_database: Vulnify BLOCK: Delete operation; Production database. Refused.
side effects: ['read_file README.md']
```

`side effects` lists tools whose functions ran. Only the read runs.

Mock mode (`python main.py --mock`, or no key) does not call the API. `mock_client.py` BLOCKs a delete whose resource name contains "production", so this run shows BLOCK with no policy.

Live mode (`python main.py` with a real `VULNIFY_API_KEY`) posts the three checks through `Vulnify.guard` when no model key is set, or when you pass `--scripted`. On a new organization the risk engine ALLOWs the read and sends the 800-record external export to REVIEW. It does not BLOCK the production delete. That call is `DELETE_DATA` on `Production Database` with `records_affected` 1, and a small delete is often ALLOW. BLOCK shows up only after a policy matches it.

With a real `GOOGLE_API_KEY` or `GEMINI_API_KEY` and no `--scripted`, Gemini chooses the tool calls. It may not request every tool. `--scripted` keeps the three calls and still uses the live Vulnify key.

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

From the repo root, `npx -p @vulnify/sdk@0.3.3 vulnify policies validate policies/block-deletes.yaml` and the same command with `apply` do the same thing. Run `python main.py --scripted` again. The delete comes back BLOCK.

Register `Project Files`, `Customer Database`, and `Production Database` if a check reports an unknown resource.

`action` is one of `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`. `destination` is one of `INTERNAL`, `EXTERNAL_EMAIL`, `EXTERNAL_API`.
