"""An agent's export job that pauses on REVIEW until a person approves it in Slack (or in app.vulnify.io)."""
import os
import sys

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []


def export_customers(to: str, count: int) -> str:
    EXECUTED.append(f"exported {count} customers to {to}")  # the real side effect; here it only logs
    return "exported"


def run(vulnify, to="partner@example.net", count=800, timeout=600.0, log=print):
    d = vulnify.check(agent=AGENT, action="EXPORT_DATA", resource="customers",
                      destination="EXTERNAL_EMAIL", records_affected=count)
    decision = d.final_decision or d.decision
    log(f"Vulnify {decision} (event {d.id}, risk {d.risk_score}): {'; '.join(d.reasons)}")
    if decision == "ALLOW":
        return export_customers(to, count)
    if decision != "REVIEW":
        return "not exported (BLOCK)"
    log("Waiting for a reviewer: the review card is in your Slack channel and in app.vulnify.io/reviews ...")
    outcome = vulnify.wait_for_review(d.id, timeout=timeout)
    log(f"Review outcome: {outcome}")
    # The SDK returns the effective decision (ALLOW or BLOCK) when the API sends one, else APPROVED, DENIED, EXPIRED or TIMEOUT.
    return export_customers(to, count) if outcome in ("ALLOW", "APPROVED") else f"not exported ({outcome})"


if __name__ == "__main__":
    from vulnify import Vulnify

    if not os.environ.get("VULNIFY_API_KEY"):
        sys.exit("Set VULNIFY_API_KEY (see .env.example)")
    print("result:", run(Vulnify(api_key=os.environ["VULNIFY_API_KEY"]), timeout=float(os.environ.get("REVIEW_TIMEOUT", "600"))))
    print("side effects:", EXECUTED)
