"""OpenAI Agents SDK + Vulnify: guard_openai_agents_tool around each function tool."""
import json
import os

from agents import Agent, ModelResponse, Runner, Usage, function_tool
from agents.models.interface import Model
from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText
from vulnify.adapters import guard_openai_agents_tool

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []


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


def build_agent(vulnify, model, wait=None):
    @function_tool
    def read_file(path: str) -> str:
        """Read one file in the project."""
        EXECUTED.append(f"read_file {path}")
        return f"contents of {path}"

    @function_tool
    def export_customers(email: str, rows: int) -> str:
        """Export customer records and email them to an address."""
        EXECUTED.append(f"export_customers {rows} -> {email}")
        return f"exported {rows} customers to {email}"

    @function_tool
    def delete_production_database(confirm: bool) -> str:
        """Delete the production database."""
        if not confirm:
            return "not deleted"
        EXECUTED.append("delete_production_database")
        return "deleted production database"

    tools = [
        guard_openai_agents_tool(vulnify, read_file, describe_read, wait=wait),
        guard_openai_agents_tool(vulnify, export_customers, describe_export, wait=wait),
        guard_openai_agents_tool(vulnify, delete_production_database, describe_delete, wait=wait),
    ]
    return Agent(name="Ops assistant", instructions="Use the tools you are given.", tools=tools, model=model)


class StubModel(Model):
    """Scripted stand-in for an LLM: turn 1 calls the given tools, turn 2 answers."""

    def __init__(self, calls):
        self.calls, self.turn = calls, 0

    async def get_response(self, *args, **kwargs):
        self.turn += 1
        if self.turn == 1:
            out = [
                ResponseFunctionToolCall(
                    type="function_call", id=f"fc{i}", call_id=f"call{i}", name=name, arguments=json.dumps(arguments)
                )
                for i, (name, arguments) in enumerate(self.calls)
            ]
        else:
            out = [
                ResponseOutputMessage(
                    type="message",
                    id="m1",
                    role="assistant",
                    status="completed",
                    content=[ResponseOutputText(type="output_text", text="Done.", annotations=[])],
                )
            ]
        return ModelResponse(output=out, usage=Usage(), response_id=None)

    def stream_response(self, *args, **kwargs):
        raise NotImplementedError


DEMO_CALLS = [
    ("read_file", {"path": "README.md"}),
    ("export_customers", {"email": "partner@example.com", "rows": 800}),
    ("delete_production_database", {"confirm": True}),
]


async def run(vulnify, calls=None, wait=None):
    calls = DEMO_CALLS if calls is None else calls
    EXECUTED.clear()
    result = await Runner.run(build_agent(vulnify, StubModel(calls), wait=wait), "Do the three tasks.")
    outputs = [item for item in result.new_items if item.type == "tool_call_output_item"]
    return [(name, output.output) for (name, _args), output in zip(calls, outputs)]
