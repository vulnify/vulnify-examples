import agent
from mock_client import MockVulnify


def test_read_runs_export_is_held_delete_is_blocked():
    fake = MockVulnify()
    rows = dict(agent.run(fake))
    assert rows["read_file"] == "contents of README.md"
    assert rows["export_customers"].startswith("Vulnify REVIEW")
    assert "800" in rows["export_customers"]
    assert rows["delete_production_database"].startswith("Vulnify BLOCK")
    assert agent.EXECUTED == ["read_file README.md"]
    assert {call["action"] for call in fake.seen} == {"READ_DATA", "EXPORT_DATA", "DELETE_DATA"}
    export = next(call for call in fake.seen if call["action"] == "EXPORT_DATA")
    assert export["records_affected"] == 800
    assert export["destination"] == "EXTERNAL_EMAIL"


def test_guarded_tools_attach_to_a_crew():
    tools = agent.guarded_tools(MockVulnify())
    crew = agent.build_crew(tools)
    assert [tool.name for tool in crew.agents[0].tools] == [
        "read_file",
        "export_customers",
        "delete_production_database",
    ]
