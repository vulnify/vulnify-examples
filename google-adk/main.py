import asyncio
import os
import sys

from google.adk.agents.llm_agent import LlmAgent
from vulnify import Vulnify

import agent
from mock_client import MockVulnify

PLACEHOLDER_VULNIFY = ("", "vln_test_your_key_here", "vln_test_your_key")
PLACEHOLDER_MODEL = ("", "your_google_api_key_here", "your_key_here")


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


def _model_key():
    for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value not in PLACEHOLDER_MODEL:
            return value
    return ""


def client_and_model():
    """Mock with no keys. A real TEST key uses the API. A model key uses Gemini."""
    load_env()
    key = os.environ.get("VULNIFY_API_KEY", "").strip()
    scripted = "--scripted" in sys.argv or not _model_key()
    if key in PLACEHOLDER_VULNIFY or "--mock" in sys.argv:
        print("Mock mode: no API call. A file read is ALLOW, the export is REVIEW, the delete is BLOCK.")
        return MockVulnify(), None
    print("Live mode: decisions come from https://api.vulnify.io")
    vulnify = Vulnify(api_key=key, fail_mode="closed")
    if scripted:
        print("Scripted planner: no model call. Set GOOGLE_API_KEY to let Gemini choose the tools.")
        return vulnify, None
    model_name = os.environ.get("GOOGLE_MODEL", "").strip() or LlmAgent.DEFAULT_MODEL
    print(f"Model: {model_name}")
    return vulnify, model_name


def format_output(response):
    if isinstance(response, dict) and set(response) == {"result"}:
        return response["result"]
    return response


async def _main():
    vulnify, model = client_and_model()
    for name, response in await agent.run(vulnify, model=model):
        print(f"{name}: {format_output(response)}")
    print("side effects:", agent.EXECUTED)


def main():
    asyncio.run(_main())


if __name__ == "__main__":
    main()
