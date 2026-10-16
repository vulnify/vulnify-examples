# Slack review: approve an 800-record export in Slack

Shows: an agent job asks Vulnify before exporting 800 customers to an outside email. Vulnify answers REVIEW, so the job waits (`wait_for_review`). The Vulnify Slack app posts the review with **Approve** and **Deny** buttons. The export runs only after an approval, and a denial, a block or a timeout means it never runs.

## Set up Slack (once)

In app.vulnify.io, go to **Integrations > Slack**, install the Slack app, and pick the channel for reviews (review alerts are on by default). Approvers answer in the message. Reviews also appear at app.vulnify.io/reviews.

## Run it (2 minutes)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a   # add a TEST key from app.vulnify.io/api-keys
python export_job.py      # then click Approve in Slack
pytest -q                 # offline, no key needed
```

Set `VULNIFY_AGENT` to an agent that already exists in your org. New names register on first use and count toward your plan's agent limit.

## Expected output

```
Vulnify REVIEW (event ce38d6aa-…, risk 65): Export operation; External destination; Large data volume (800 records)
Waiting for a reviewer: the review card is in your Slack channel and in app.vulnify.io/reviews ...
Review outcome: ALLOW
result: exported
side effects: ['exported 800 customers to partner@example.net']
```

`wait_for_review` returns the effective decision (`ALLOW` or `BLOCK`) once a reviewer answers, or `TIMEOUT`. Only `ALLOW` (or `APPROVED`) lets the export run.

> **What we tested live.** The REVIEW decision, the wait and the export after approval all ran against a real Vulnify TEST organization on 2026-10-16. In that test, the approval was made through the Vulnify reviews API as an org admin (the same action the Slack button performs), because the test org has no Slack workspace connected. The Slack button itself was not part of our live test.
