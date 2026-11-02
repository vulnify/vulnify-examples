"""Google ADK agent. Vulnify checks every tool call in before_tool_callback."""
import os

from google.adk.agents import Agent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import PrivateAttr
from vulnify import VulnifyBlockedError

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []

PROMPT = (
    "Read README.md, export 800 customer records to partner@example.com, "
    "and delete the production database."
)

INSTRUCTION = (
    "You are an ops assistant. Call the tools you are given, one for each "
    "task the user names. A separate check decides whether each call may run. "
    "Do not skip a tool, and do not invent an approval. "
    "Call read_file with path README.md, export_customers with email "
    "partner@example.com and rows 800, and delete_production_database with "
    "confirm true. After the tool results, reply with one short sentence."
)


def read_file(path: str) -> str:
    """Read one file in the project."""
    EXECUTED.append(f"read_file {path}")
    return f"contents of {path}"


def export_customers(email: str, rows: int) -> str:
    """Export customer records and email them to an address."""
    EXECUTED.append(f"export_customers {rows} -> {email}")
    return f"exported {rows} customers to {email}"


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

DEMO_CALLS = [
    ("read_file", {"path": "README.md"}),
    ("export_customers", {"email": "partner@example.com", "rows": 800}),
    ("delete_production_database", {"confirm": True}),
]


def _refusal(err: VulnifyBlockedError) -> dict:
    """Text the model sees when the tool must not run."""
    decision = err.result.final_decision or err.result.decision
    text = str(err)
    if decision == "REVIEW":
        text = f"{text}. Pending human review."
    elif decision == "BLOCK":
        text = f"{text}. Refused."
    return {"result": text}


def guard_tool_calls(vulnify, wait=None):
    """ADK before_tool_callback. Parameter names are the ones ADK passes.

    ``None`` lets the tool run. Any dict, including this refusal, is the tool
    result and the function does not run. ``wait={"timeout": 120}`` holds a
    REVIEW on the real client until a person answers. Omit it and REVIEW
    returns immediately, with the tool unrun.
    """

    def before_tool_callback(tool, args, tool_context):
        # ADK passes these names by keyword. The decision is keyed by tool.name.
        del tool_context
        describe = DESCRIBE.get(getattr(tool, "name", ""))
        if describe is None:
            return None
        payload = dict(args or {})
        try:
            vulnify.guard(lambda: None, wait=wait, **describe(payload))
        except VulnifyBlockedError as err:
            return _refusal(err)
        return None

    return before_tool_callback


def _saw_tool_result(llm_request) -> bool:
    for content in llm_request.contents or []:
        for part in content.parts or []:
            if part.function_response:
                return True
    return False


class ScriptedModel(BaseLlm):
    """Turn 1 requests the demo tools. The next turn stops. No model API key."""

    _calls: list = PrivateAttr()

    def __init__(self, calls):
        super().__init__(model="scripted-demo")
        self._calls = list(calls)

    async def generate_content_async(self, llm_request, stream=False):
        del stream
        if _saw_tool_result(llm_request):
            parts = [types.Part(text="Done.")]
        else:
            parts = [
                types.Part(
                    function_call=types.FunctionCall(id=f"call{index}", name=name, args=arguments)
                )
                for index, (name, arguments) in enumerate(self._calls)
            ]
        # Zero counts satisfy ADK's usage check. This model does not call an API.
        yield LlmResponse(
            content=types.Content(role="model", parts=parts),
            finish_reason=types.FinishReason.STOP,
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=0,
                candidates_token_count=0,
            ),
        )


def build(vulnify, model=None, wait=None, calls=None):
    """An LlmAgent whose before_tool_callback asks Vulnify before each tool runs.

    ``model`` is a model name, for example ``gemini-3.5-flash``, when a live
    model should choose the calls. Omit it and ``ScriptedModel`` requests the
    three demo calls.
    """
    calls = DEMO_CALLS if calls is None else calls
    llm = ScriptedModel(calls) if model is None else model
    return Agent(
        name="ops_assistant",
        description="Reads a file, exports customers, and deletes a database only when Vulnify allows it.",
        instruction=INSTRUCTION,
        tools=[read_file, export_customers, delete_production_database],
        before_tool_callback=guard_tool_calls(vulnify, wait=wait),
        model=llm,
    )


def tool_names(agent) -> list[str]:
    names = []
    for tool in agent.tools:
        names.append(getattr(tool, "name", None) or getattr(tool, "__name__", ""))
    return names


async def run(vulnify, calls=None, wait=None, model=None):
    """Run one user turn. Returns ``(tool name, response dict)`` for each call."""
    EXECUTED.clear()
    runner = InMemoryRunner(agent=build(vulnify, model=model, wait=wait, calls=calls), app_name="vulnify_google_adk")
    try:
        session = await runner.session_service.create_session(app_name=runner.app_name, user_id="user")
        rows = []
        message = types.Content(role="user", parts=[types.Part(text=PROMPT)])
        async for event in runner.run_async(user_id="user", session_id=session.id, new_message=message):
            for response in event.get_function_responses():
                rows.append((response.name, response.response))
        return rows
    finally:
        await runner.close()
