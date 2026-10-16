# LangGraph + Vulnify: REVIEW pauses for a human

Shows: a graph where every proposed action passes a `vulnify_check` node. ALLOW goes straight to `execute`. BLOCK goes to `stop`. REVIEW goes to a `human_approval` node that calls LangGraph's `interrupt()`, so the run pauses until a person answers and is resumed with `Command(resume=...)`.

```
START -> plan -> vulnify_check --ALLOW--> execute -> END
                               --REVIEW-> human_approval --yes--> execute
                               --BLOCK--> stop          --no---> stop
```

> **Stub planner, real Vulnify.** `plan` is a stand-in for an LLM node that always proposes exporting 800 customers to an outside email. The Vulnify check is a real API call. The human answer here is collected inside the graph, and the Vulnify event stays in your review queue at app.vulnify.io. To let reviewers decide in Vulnify (or Slack) instead, replace the `interrupt()` with `vulnify.wait_for_review(event_id)`.

## Run it (2 minutes)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a   # add a TEST key from app.vulnify.io/api-keys
python main.py              # the human denies
python main.py --approve    # the human approves
pytest -q                   # offline, no key needed
```

Set `VULNIFY_AGENT` to an agent that already exists in your org. New names register on first use and count toward your plan's agent limit.

## Expected output

```
PAUSED for a human: Vulnify REVIEW, event 290c4a87-…
  reasons: Export operation; External destination; Large data volume (800 records)
  human answers: deny
result: not executed (REVIEW, denied by human) | side effects: []
```

With `--approve`, the last line is `result: executed | side effects: ['EXPORT_DATA 800 customers -> EXTERNAL_EMAIL']`.

Tested live on 2026-10-16 against a Vulnify TEST organization with `langgraph==1.2.15` and `vulnify==0.4.2`.
