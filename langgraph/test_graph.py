from types import SimpleNamespace

from langgraph.types import Command

import graph


class Fake:
    def __init__(self, decision):
        self.decision = decision

    def check(self, **a):
        return SimpleNamespace(id="evt", decision=self.decision, final_decision=self.decision, reasons=["test"])


def run(decision, resume=None):
    graph.EXECUTED.clear()
    app, cfg = graph.build(Fake(decision)), {"configurable": {"thread_id": decision + str(resume)}}
    out = app.invoke({"request": "x"}, cfg)
    if resume is not None:
        assert "__interrupt__" in out
        out = app.invoke(Command(resume={"approved": resume}), cfg)
    return out


def test_review_pauses_and_only_runs_when_approved():
    assert run("REVIEW", True)["result"] == "executed" and len(graph.EXECUTED) == 1
    assert run("REVIEW", False)["result"].startswith("not executed") and graph.EXECUTED == []


def test_allow_runs_and_block_stops_without_a_human():
    assert run("ALLOW")["result"] == "executed"
    assert run("BLOCK")["result"] == "not executed (BLOCK)"
