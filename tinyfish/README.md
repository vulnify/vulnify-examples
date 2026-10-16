# TinyFish + Vulnify: ask before the agent submits a portal form

TinyFish's web agent can log into portals, fill in forms and submit them. A submit is a side effect you can't take back, so this example asks Vulnify first:

- **ALLOW**: TinyFish fills in the form and submits it.
- **REVIEW**: nothing is submitted until a person approves (for example with Approve/Deny in Slack).
- **BLOCK**: nothing is submitted.
- If Vulnify can't be reached, the SDK fails closed and returns BLOCK with `degraded=True`.

Each decision is added to the Vulnify audit log.

## Run

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export VULNIFY_API_KEY=...      # create one in app.vulnify.io (a TEST key keeps events in the sandbox)
export TINYFISH_API_KEY=...     # from the TinyFish API Keys page

python portal_submit.py --dry-run                      # Vulnify decision only, no browser
python portal_submit.py --url https://example.com/contact \
  --field Name="Jane Doe" --field Email=jane@example.com --field Message="Requesting a quote."
```

Add a policy in app.vulnify.io that sends `WRITE_DATA` to an external destination (`EXTERNAL_API`) to REVIEW to see the approval path.

## How it works

1. `vulnify.check(action="WRITE_DATA", destination="EXTERNAL_API", resource="Portal form (<host>)", records_affected=1, content=<fields as JSON>)`. The `content` field is optional. The server scans it for sensitive data and doesn't store it.
2. On REVIEW, `wait_for_review()` polls until a person approves or denies it, or until it times out (a timeout counts as not submitted).
3. Only after ALLOW does it call `POST https://agent.tinyfish.ai/v1/automation/run` with a natural-language goal: fill in the fields, click Submit, return the confirmation.

## Tests

`python -m pytest -q` runs 7 offline tests. They cover ALLOW, BLOCK, REVIEW approved/denied/timeout, the shape of the check payload, and fail-closed when the API is unreachable. They use no keys and need no network.

## Status / notes
- Tested 16/10/2026: 7/7 offline tests pass. The live `api.vulnify.io` answers, and a dummy key gets 401 "Invalid API key". A rejected key raises `VulnifyError` and does not fall back to BLOCK. The script exits without submitting.
- Not tested yet: a real Vulnify decision and a real TinyFish run. Both need keys from the PM (see blockers).
- The TinyFish endpoint and body follow docs.tinyfish.ai (agent API reference, form-filling example). The response shape hasn't been checked against a live run.
- Possible next step: a two-run variant where TinyFish first fills in the form *without* submitting and extracts the values, so the reviewer approves the exact values before the submit run.

## Tested

Live-tested on 2026-10-16 against https://httpbin.org/forms/post with a TEST-scoped Vulnify key. Vulnify returned ALLOW (new agent, monitor mode), and the TinyFish run finished `COMPLETED` in 5 steps.
