"""CrewAI tools gated by guard_crewai_tool. The crew is built; the demo calls the tools."""
import os

from crewai import Agent, Crew, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
from vulnify.adapters import guard_crewai_tool

AGENT = os.environ.get("VULNIFY_AGENT", "support-agent")
EXECUTED: list[str] = []


class ReadFileInput(BaseModel):
    path: str = Field(description="Path of the file to read")


class ExportInput(BaseModel):
    email: str = Field(description="Address that receives the export")
    rows: int = Field(description="How many customer records to export")


class DeleteInput(BaseModel):
    confirm: bool = Field(description="Must be true to delete the production database")


class ReadFileTool(BaseTool):
    name: str = "read_file"
    description: str = "Read one file in the project."
    args_schema: type[BaseModel] = ReadFileInput

    def _run(self, path: str) -> str:
        EXECUTED.append(f"read_file {path}")
        return f"contents of {path}"


class ExportCustomersTool(BaseTool):
    name: str = "export_customers"
    description: str = "Export customer records and email them to an address."
    args_schema: type[BaseModel] = ExportInput

    def _run(self, email: str, rows: int) -> str:
        EXECUTED.append(f"export_customers {rows} -> {email}")
        return f"exported {rows} customers to {email}"


class DeleteProductionDatabaseTool(BaseTool):
    name: str = "delete_production_database"
    description: str = "Delete the production database."
    args_schema: type[BaseModel] = DeleteInput

    def _run(self, confirm: bool) -> str:
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


def guarded_tools(vulnify, wait=None):
    """Fresh tool instances. guard_crewai_tool wraps _run in place."""
    specs = [
        (ReadFileTool(), describe_read),
        (ExportCustomersTool(), describe_export),
        (DeleteProductionDatabaseTool(), describe_delete),
    ]
    return [guard_crewai_tool(vulnify, tool, describe, wait=wait) for tool, describe in specs]


def build_crew(tools):
    """The crew a model would run. kickoff() needs a model key; the demo does not call it."""
    worker = Agent(
        role="Ops assistant",
        goal="Read a file, export customers, and delete a database only when Vulnify allows it.",
        backstory="You call the tools you are given. You do not invent an approval.",
        tools=tools,
        verbose=False,
    )
    task = Task(
        description=(
            "Read README.md. Export 800 customers to partner@example.com. "
            "Delete the production database."
        ),
        expected_output="What ran, what is waiting on a person, and what was blocked.",
        agent=worker,
    )
    return Crew(agents=[worker], tasks=[task], verbose=False)


CALLS = [
    ("read_file", {"path": "README.md"}),
    ("export_customers", {"email": "partner@example.com", "rows": 800}),
    ("delete_production_database", {"confirm": True}),
]


def run(vulnify, wait=None):
    """The three calls the agent is set up to make. Each one goes through the guard."""
    EXECUTED.clear()
    tools = {tool.name: tool for tool in guarded_tools(vulnify, wait=wait)}
    return [(name, str(tools[name].run(**kwargs))) for name, kwargs in CALLS]
