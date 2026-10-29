"""LangChain tools inside a LangGraph agent. Vulnify gates every tool call."""
import os
from typing import Annotated

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from typing_extensions import TypedDict
from vulnify.adapters import langgraph_tool_guard

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []

PROMPT = (
    "Read README.md, export 800 customer records to partner@example.com, "
    "and delete the production database."
)


class State(TypedDict):
    messages: Annotated[list, add_messages]


@tool
def read_file(path: str) -> str:
    """Read one file in the project."""
    EXECUTED.append(f"read_file {path}")
    return f"contents of {path}"


@tool
def export_customers(email: str, rows: int) -> str:
    """Export customer records and email them to an address."""
    EXECUTED.append(f"export_customers {rows} -> {email}")
    return f"exported {rows} customers to {email}"


@tool
def delete_production_database(confirm: bool) -> str:
    """Delete the production database."""
    if not confirm:
        return "not deleted"
    EXECUTED.append("delete_production_database")
    return "deleted production database"


def describe_read(_args: dict) -> dict:
    return {
        "agent": AGENT,
        "action": "READ_DATA",
        "resource": "Project Files",
        "destination": "INTERNAL",
        "records_affected": 1,
    }


def describe_export(args: dict) -> dict:
    return {
        "agent": AGENT,
        "action": "EXPORT_DATA",
        "resource": "Customer Database",
        "destination": "EXTERNAL_EMAIL",
        "records_affected": int(args.get("rows") or 0),
    }


def describe_delete(_args: dict) -> dict:
    return {
        "agent": AGENT,
        "action": "DELETE_DATA",
        "resource": "Production Database",
        "records_affected": 1,
    }


DESCRIBE = {
    "read_file": describe_read,
    "export_customers": describe_export,
    "delete_production_database": describe_delete,
}

TOOLS = [read_file, export_customers, delete_production_database]

PLANNED = [
    {"name": "read_file", "args": {"path": "README.md"}, "id": "c1"},
    {"name": "export_customers", "args": {"email": "partner@example.com", "rows": 800}, "id": "c2"},
    {"name": "delete_production_database", "args": {"confirm": True}, "id": "c3"},
]


def build(vulnify, wait=None):
    """A two-node agent. The planner is scripted so the demo needs no model key.

    ``wait={"timeout": 120}`` holds a REVIEW until a person approves it in Vulnify
    or in Slack. Omit it and REVIEW comes back immediately, with the tool unrun.
    """
    guard = langgraph_tool_guard(vulnify, DESCRIBE, wait=wait)

    def plan(state: State) -> dict:
        if any(isinstance(message, ToolMessage) for message in state["messages"]):
            return {"messages": [AIMessage(content="Done.")]}
        return {"messages": [AIMessage(content="", tool_calls=PLANNED)]}

    graph = StateGraph(State)
    graph.add_node("agent", plan)
    graph.add_node("tools", ToolNode(TOOLS, wrap_tool_call=guard))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", tools_condition, ["tools", END])
    graph.add_edge("tools", "agent")
    return graph.compile()


def run(vulnify, wait=None):
    EXECUTED.clear()
    result = build(vulnify, wait=wait).invoke({"messages": [HumanMessage(content=PROMPT)]})
    rows = []
    for message in result["messages"]:
        if isinstance(message, ToolMessage):
            rows.append({"tool": message.name, "output": message.content, "status": message.status})
    return rows
