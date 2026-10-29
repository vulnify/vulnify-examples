import os
import sys

from vulnify import Vulnify

import agent
from mock_client import MockVulnify


def load_env(path=".env"):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def client():
    load_env()
    key = os.environ.get("VULNIFY_API_KEY", "").strip()
    if key in ("", "vln_test_your_key_here", "vln_test_your_key") or "--mock" in sys.argv:
        print("Mock mode: no API call. A file read is ALLOW, the export is REVIEW, the delete is BLOCK.")
        return MockVulnify()
    print("Live mode: decisions come from https://api.vulnify.io")
    return Vulnify(api_key=key, fail_mode="closed")


def main():
    vulnify = client()
    tools = agent.guarded_tools(vulnify)
    crew = agent.build_crew(tools)
    print(f"Crew ready: {crew.agents[0].role} with tools {[tool.name for tool in tools]}")
    print("Scripted tool calls through the guard:")
    for name, output in agent.run(vulnify):
        print(f"{name}: {output}")
    print("side effects:", agent.EXECUTED)
    print("To let a model choose the calls, set a model key and run crew.kickoff().")


if __name__ == "__main__":
    main()
