"""TinyFish + Vulnify: the agent asks before it submits a portal form.

Flow
1. Ask Vulnify about the form submit (WRITE_DATA to EXTERNAL_API) (metadata only, plus optional content scan).
2. ALLOW  -> TinyFish fills and submits the form.
   REVIEW -> nothing is submitted; we wait for a person (e.g. Slack Approve/Deny).
   BLOCK  -> nothing is submitted.
3. If Vulnify cannot be reached, the SDK fails closed (BLOCK, degraded=True).

Env: VULNIFY_API_KEY, TINYFISH_API_KEY. Use --dry-run to skip the real TinyFish call.
"""
import argparse, json, os, sys

import requests
from vulnify import Vulnify

TINYFISH_RUN = "https://agent.tinyfish.ai/v1/automation/run"


def tinyfish_submit(url: str, fields: dict, api_key: str) -> dict:
    lines = "\n".join(f'- {k}: "{v}"' for k, v in fields.items())
    goal = (f"Fill in the form on this page:\n{lines}\n"
            "Then click the Submit button and extract the confirmation message.")
    r = requests.post(TINYFISH_RUN, headers={"X-API-Key": api_key},
                      json={"url": url, "goal": goal, "browser_profile": "lite"}, timeout=330)
    r.raise_for_status()
    return r.json()


def run(url, fields, vulnify, submit, wait_seconds=300):
    host = requests.utils.urlparse(url).hostname or url
    decision = vulnify.check(
        agent="PortalAgent",
        action="WRITE_DATA",
        resource=f"Portal form ({host})",
        destination="EXTERNAL_API",
        records_affected=1,
        content=json.dumps(fields),  # optional: scanned for sensitive data, not stored
    )
    outcome = decision.final_decision or decision.decision
    print(f"Vulnify: {outcome} (event {decision.id}, degraded={decision.degraded})")
    for reason in decision.reasons:
        print("  reason:", reason)

    if outcome == "REVIEW" and decision.id:
        print(f"Waiting up to {wait_seconds}s for a person to approve...")
        outcome = vulnify.wait_for_review(decision.id, timeout=wait_seconds)
        print("Review outcome:", outcome)
        outcome = "ALLOW" if outcome in ("ALLOW", "APPROVED") else "BLOCK"

    if outcome != "ALLOW":
        print("Form NOT submitted.")
        return {"submitted": False, "decision": outcome}
    return {"submitted": True, "result": submit(url, fields)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="https://example.com/contact")
    p.add_argument("--field", action="append", default=[], help="name=value")
    p.add_argument("--dry-run", action="store_true", help="don't call TinyFish")
    p.add_argument("--wait", type=int, default=300)
    a = p.parse_args()
    fields = dict(f.split("=", 1) for f in a.field) or {
        "Name": "Jane Doe", "Email": "jane@example.com", "Message": "Requesting a quote."}

    vkey = os.environ.get("VULNIFY_API_KEY")
    if not vkey:
        sys.exit("Set VULNIFY_API_KEY (a TEST key keeps events in the sandbox).")
    if a.dry_run:
        submit = lambda u, f: {"dry_run": True, "would_submit": f, "url": u}
    else:
        tkey = os.environ.get("TINYFISH_API_KEY") or sys.exit("Set TINYFISH_API_KEY or use --dry-run.")
        submit = lambda u, f: tinyfish_submit(u, f, tkey)
    print(json.dumps(run(a.url, fields, Vulnify(api_key=vkey), submit, a.wait), indent=2))


if __name__ == "__main__":
    main()
