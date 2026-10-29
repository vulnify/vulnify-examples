from langchain_core.messages import ToolMessage

import graph
from mock_client import MockVulnify


def test_read_is_allowed_export_is_held_delete_is_blocked():
    fake = MockVulnify()
    rows = graph.run(fake)
    by_tool = {row["tool"]: row["output"] for row in rows}
    assert by_tool["read_file"] == "contents of README.md"
    assert by_tool["export_customers"].startswith("Vulnify REVIEW")
    assert "800" in by_tool["export_customers"]
    assert by_tool["delete_production_database"].startswith("Vulnify BLOCK")
    assert graph.EXECUTED == ["read_file README.md"]
    assert {call["action"] for call in fake.seen} == {"READ_DATA", "EXPORT_DATA", "DELETE_DATA"}
    assert next(call["records_affected"] for call in fake.seen if call["action"] == "EXPORT_DATA") == 800


def test_blocked_tool_message_is_an_error():
    result = graph.build(MockVulnify()).invoke({"messages": []})
    # The planner runs first and emits tool calls, so the graph always has tool results.
    statuses = {message.name: message.status for message in result["messages"] if isinstance(message, ToolMessage)}
    assert statuses["read_file"] != "error"
    assert statuses["export_customers"] == "error"
    assert statuses["delete_production_database"] == "error"
