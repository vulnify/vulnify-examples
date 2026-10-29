"""Offline: a fake Vulnify; the stub model drives the real Agents SDK runner."""
import asyncio

import agent
from mock_client import MockVulnify


def test_read_runs_export_is_held_delete_is_blocked():
    agent.EXECUTED.clear()
    fake = MockVulnify()
    rows = dict(asyncio.run(agent.run(fake)))
    assert rows["read_file"] == "contents of README.md"
    assert "Vulnify REVIEW" in rows["export_customers"]
    assert "800" in rows["export_customers"]
    assert "Vulnify BLOCK" in rows["delete_production_database"]
    assert agent.EXECUTED == ["read_file README.md"]
    assert [call["action"] for call in fake.seen] == ["READ_DATA", "EXPORT_DATA", "DELETE_DATA"]
    assert fake.seen[1]["records_affected"] == 800
    assert fake.seen[1]["destination"] == "EXTERNAL_EMAIL"
