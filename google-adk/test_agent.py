"""Offline: a fake Vulnify; a scripted model drives the real ADK runner."""
import asyncio

from vulnify import Vulnify

import agent
import main
from mock_client import MockVulnify


def _text(response):
    if isinstance(response, dict):
        return str(response.get("result", response))
    return str(response)


def test_read_runs_export_is_held_delete_is_blocked():
    fake = MockVulnify()
    rows = dict(asyncio.run(agent.run(fake)))
    assert _text(rows["read_file"]) == "contents of README.md"
    export = _text(rows["export_customers"])
    assert export.startswith("Vulnify REVIEW")
    assert "Pending human review" in export
    assert "800" in export
    delete = _text(rows["delete_production_database"])
    assert delete.startswith("Vulnify BLOCK")
    assert "Refused" in delete
    assert agent.EXECUTED == ["read_file README.md"]
    assert [call["action"] for call in fake.seen] == ["READ_DATA", "EXPORT_DATA", "DELETE_DATA"]
    assert fake.seen[1]["records_affected"] == 800
    assert fake.seen[1]["destination"] == "EXTERNAL_EMAIL"


def test_callback_is_attached_and_does_not_run_the_tool():
    built = agent.build(MockVulnify())
    assert built.before_tool_callback is not None
    assert agent.tool_names(built) == [
        "read_file",
        "export_customers",
        "delete_production_database",
    ]
    callback = built.before_tool_callback

    class _Tool:
        def __init__(self, name):
            self.name = name

    class _Context:
        agent_name = "ops_assistant"

    agent.EXECUTED.clear()
    allowed = callback(_Tool("read_file"), {"path": "README.md"}, _Context())
    assert allowed is None
    held = callback(_Tool("export_customers"), {"email": "partner@example.com", "rows": 800}, _Context())
    blocked = callback(_Tool("delete_production_database"), {"confirm": True}, _Context())
    assert "Vulnify REVIEW" in held["result"]
    assert "Pending human review" in held["result"]
    assert "Vulnify BLOCK" in blocked["result"]
    assert "Refused" in blocked["result"]
    assert agent.EXECUTED == []


def test_missing_or_placeholder_keys_stay_in_mock(monkeypatch, capsys):
    monkeypatch.setattr(main, "load_env", lambda path=".env": None)
    monkeypatch.delenv("VULNIFY_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["main.py"])
    client, model = main.client_and_model()
    assert isinstance(client, MockVulnify)
    assert model is None

    monkeypatch.setenv("VULNIFY_API_KEY", "vln_test_your_key_here")
    monkeypatch.setenv("GOOGLE_API_KEY", "your_google_api_key_here")
    client, model = main.client_and_model()
    assert isinstance(client, MockVulnify)
    assert model is None

    monkeypatch.setenv("VULNIFY_API_KEY", "vln_test_example")
    monkeypatch.setattr("sys.argv", ["main.py", "--mock"])
    client, model = main.client_and_model()
    assert isinstance(client, MockVulnify)
    assert model is None
    assert "Mock mode" in capsys.readouterr().out


def test_live_key_without_a_model_key_keeps_the_scripted_planner(monkeypatch, capsys):
    monkeypatch.setattr(main, "load_env", lambda path=".env": None)
    monkeypatch.setenv("VULNIFY_API_KEY", "vln_test_example")
    monkeypatch.setenv("GOOGLE_API_KEY", "your_google_api_key_here")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["main.py"])
    client, model = main.client_and_model()
    assert isinstance(client, Vulnify)
    assert model is None
    assert "Live mode" in capsys.readouterr().out
