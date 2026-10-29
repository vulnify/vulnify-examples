"""Local stand-in for Vulnify.guard, used when no API key is set.

The real adapters call ``guard()`` and catch ``VulnifyBlockedError``. This client
raises that same error, so the LangGraph adapter behaves as it does against the API.
Decisions match the demo policy: a file read is ALLOW, an 800-record export to an
external email is REVIEW, and deleting the production database is BLOCK.
"""
from vulnify import Decision, VulnifyBlockedError


def outcome_for(action: dict) -> tuple[str, list[str]]:
    kind = action.get("action")
    resource = str(action.get("resource") or "")
    destination = str(action.get("destination") or "")
    records = int(action.get("records_affected") or 0)
    if kind == "DELETE_DATA" and "production" in resource.lower():
        return "BLOCK", ["Delete operation", "Production database"]
    if kind == "EXPORT_DATA" and destination == "EXTERNAL_EMAIL" and records >= 100:
        return "REVIEW", [
            "Export operation",
            "External destination",
            f"Large data volume ({records} records)",
        ]
    if kind == "READ_DATA":
        return "ALLOW", ["Read operation"]
    return "ALLOW", ["Allowed by the demo policy"]


class MockVulnify:
    def __init__(self):
        self.seen: list[dict] = []

    def guard(self, fn, wait=None, **action):
        self.seen.append(action)
        decision, reasons = outcome_for(action)
        if decision == "ALLOW":
            return fn()
        raise VulnifyBlockedError(Decision(
            id=f"evt-mock-{decision.lower()}",
            decision=decision,
            final_decision=decision,
            reasons=reasons,
            risk_score=90 if decision == "BLOCK" else 65,
            risk_level="CRITICAL" if decision == "BLOCK" else "HIGH",
            review={"status": "PENDING", "expiresAt": None, "decidedAt": None, "note": None} if decision == "REVIEW" else None,
        ))
