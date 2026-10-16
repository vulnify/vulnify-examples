"""Offline: a fake Vulnify; the stub model drives the real Agents SDK runner."""
import asyncio
from types import SimpleNamespace

import agent


class FakeVulnify:
    def __init__(self):
        self.seen = []

    def check(self, **a):
        self.seen.append(a)
        decision = "REVIEW" if a["destination"] != "INTERNAL" or a["records_affected"] > 100 else "ALLOW"
        return SimpleNamespace(id="evt", decision=decision, final_decision=decision, reasons=["test"])


def test_only_allowed_tools_execute():
    agent.EXECUTED.clear()
    fake = FakeVulnify()
    out = asyncio.run(agent.run(fake))
    assert [s["action"] for s in fake.seen] == ["SEND_EMAIL", "SEND_EMAIL", "DELETE_DATA"]
    assert agent.EXECUTED == ["send_email -> team@acme.internal"]
    assert "Vulnify REVIEW" in out[1][2] and "Vulnify REVIEW" in out[2][2]
