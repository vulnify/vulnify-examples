"""OpenAI Agents SDK + Vulnify: a tool input guardrail asks Vulnify before each risky tool runs."""
import json
import os

from agents import (Agent, ModelResponse, Runner, ToolGuardrailFunctionOutput, Usage, function_tool,
                    tool_input_guardrail)
from agents.models.interface import Model
from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
INTERNAL_DOMAIN = os.environ.get("INTERNAL_EMAIL_DOMAIN", "acme.internal")
EXECUTED: list[str] = []  # the real side effects; here they only log


def describe(tool_name: str, args: dict) -> dict | None:
    """Map a tool call to a Vulnify action (valid enums only), or None if Vulnify doesn't need to see it."""
    if tool_name == "send_email":
        external = not str(args.get("to", "")).endswith("@" + INTERNAL_DOMAIN)
        return dict(agent=AGENT, action="SEND_EMAIL", resource="email",
                    destination="EXTERNAL_EMAIL" if external else "INTERNAL", records_affected=1,
                    content=f"{args.get('subject', '')}\n{args.get('body', '')}")
    if tool_name == "delete_records":
        return dict(agent=AGENT, action="DELETE_DATA", resource=args.get("table", "records"),
                    destination="INTERNAL", records_affected=int(args.get("count", 1)))
    return None


def make_guardrail(vulnify):
    @tool_input_guardrail
    def vulnify_check(data):
        ctx = data.context
        action = describe(ctx.tool_name, json.loads(ctx.tool_arguments or "{}"))
        if action is None:
            return ToolGuardrailFunctionOutput.allow()
        d = vulnify.check(**action)
        decision = getattr(d, "final_decision", None) or d.decision
        if decision == "ALLOW":
            return ToolGuardrailFunctionOutput.allow(output_info={"event": d.id})
        return ToolGuardrailFunctionOutput.reject_content(
            f"Vulnify {decision} (event {d.id}): {'; '.join(d.reasons)}. Not executed; ask the user.",
            output_info={"event": d.id, "decision": decision})
    return vulnify_check


def build_agent(vulnify, model):
    guard = make_guardrail(vulnify)

    @function_tool(tool_input_guardrails=[guard])
    def send_email(to: str, subject: str, body: str) -> str:
        """Send an email."""
        EXECUTED.append(f"send_email -> {to}")
        return "sent"

    @function_tool(tool_input_guardrails=[guard])
    def delete_records(table: str, count: int) -> str:
        """Delete records from a table."""
        EXECUTED.append(f"delete_records {count} from {table}")
        return "deleted"

    return Agent(name="Assistant", instructions="Use tools.", tools=[send_email, delete_records], model=model)


class StubModel(Model):
    """Scripted stand-in for an LLM (no OpenAI key): turn 1 calls the given tools, turn 2 answers."""

    def __init__(self, calls):
        self.calls, self.turn = calls, 0

    async def get_response(self, *args, **kwargs):
        self.turn += 1
        if self.turn == 1:
            out = [ResponseFunctionToolCall(type="function_call", id=f"fc{i}", call_id=f"call{i}", name=n,
                                            arguments=json.dumps(a)) for i, (n, a) in enumerate(self.calls)]
        else:
            out = [ResponseOutputMessage(type="message", id="m1", role="assistant", status="completed",
                                         content=[ResponseOutputText(type="output_text", text="Done.", annotations=[])])]
        return ModelResponse(output=out, usage=Usage(), response_id=None)

    def stream_response(self, *args, **kwargs):
        raise NotImplementedError


DEMO_CALLS = [
    ("send_email", {"to": "team@acme.internal", "subject": "Standup", "body": "Notes attached."}),
    ("send_email", {"to": "someone@gmail.com", "subject": "Customers", "body": "Ana Souza, CPF 123.456.789-09"}),
    ("delete_records", {"table": "customers", "count": 800}),
]


async def run(vulnify, calls=DEMO_CALLS):
    result = await Runner.run(build_agent(vulnify, StubModel(calls)), "Do the tasks.")
    outputs = [i for i in result.new_items if i.type == "tool_call_output_item"]
    return [(c[0], c[1].get("to") or c[1].get("table"), o.output) for c, o in zip(calls, outputs)]
