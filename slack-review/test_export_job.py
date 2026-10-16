from types import SimpleNamespace

import export_job


class Fake:
    def __init__(self, decision, outcome=None):
        self.decision, self.outcome, self.waited = decision, outcome, False

    def check(self, **a):
        assert a["action"] == "EXPORT_DATA" and a["destination"] == "EXTERNAL_EMAIL" and a["records_affected"] == 800
        return SimpleNamespace(id="evt", decision=self.decision, final_decision=self.decision, risk_score=65, reasons=["x"])

    def wait_for_review(self, event_id, timeout):
        self.waited = True
        return self.outcome


def go(*a):
    export_job.EXECUTED.clear()
    f = Fake(*a)
    return export_job.run(f, log=lambda *_: None), f


def test_review_waits_and_exports_only_when_approved():
    r, f = go("REVIEW", "APPROVED")
    assert f.waited and r == "exported" and len(export_job.EXECUTED) == 1
    r, _ = go("REVIEW", "ALLOW")  # effective decision after approval
    assert r == "exported"
    r, _ = go("REVIEW", "DENIED")
    assert r == "not exported (DENIED)" and export_job.EXECUTED == []
    for outcome in ("BLOCK", "EXPIRED", "TIMEOUT"):
        r, _ = go("REVIEW", outcome)
        assert r.startswith("not exported")
    r, _ = go("REVIEW", "EXPIRED")
    assert export_job.EXECUTED == []


def test_block_never_waits():
    r, f = go("BLOCK")
    assert not f.waited and r == "not exported (BLOCK)"
