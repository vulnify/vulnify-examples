"""LangGraph + Vulnify: plan -> vulnify_check -> (REVIEW: human_approval interrupt) -> execute."""
import os
from typing import Optional, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []


class State(TypedDict, total=False):
    request: str
    action: dict
    decision: str
    event_id: Optional[str]
    reasons: list[str]
    approved: bool
    result: str


def plan(state: State) -> State:
    """Stub planner (stands in for an LLM): turns the request into one proposed action."""
    return {"action": dict(agent=AGENT, action="EXPORT_DATA", resource="customers",
                           destination="EXTERNAL_EMAIL", records_affected=800)}


def build(vulnify):
    def vulnify_check(state: State) -> State:
        d = vulnify.check(**state["action"])
        return {"decision": d.final_decision or d.decision, "event_id": d.id, "reasons": list(d.reasons)}

    def human_approval(state: State) -> State:
        # Pauses the graph. The run resumes with Command(resume={"approved": True|False}).
        answer = interrupt({"event_id": state["event_id"], "reasons": state["reasons"],
                            "question": "Vulnify says REVIEW. Approve this action?"})
        return {"approved": bool(answer.get("approved"))}

    def execute(state: State) -> State:
        a = state["action"]
        EXECUTED.append(f"{a['action']} {a['records_affected']} {a['resource']} -> {a['destination']}")
        return {"result": "executed"}

    def stop(state: State) -> State:
        return {"result": f"not executed ({state['decision']}{', denied by human' if state.get('decision') == 'REVIEW' else ''})"}

    def route(state: State) -> str:
        return {"ALLOW": "execute", "REVIEW": "human_approval"}.get(state["decision"], "stop")

    g = StateGraph(State)
    for name, fn in [("plan", plan), ("vulnify_check", vulnify_check), ("human_approval", human_approval),
                     ("execute", execute), ("stop", stop)]:
        g.add_node(name, fn)
    g.add_edge(START, "plan")
    g.add_edge("plan", "vulnify_check")
    g.add_conditional_edges("vulnify_check", route, ["execute", "human_approval", "stop"])
    g.add_conditional_edges("human_approval", lambda s: "execute" if s["approved"] else "stop", ["execute", "stop"])
    g.add_edge("execute", END)
    g.add_edge("stop", END)
    return g.compile(checkpointer=InMemorySaver())
