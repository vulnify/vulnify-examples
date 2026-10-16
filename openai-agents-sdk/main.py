import asyncio
import os
import sys

from agents import set_tracing_disabled
from vulnify import Vulnify

import agent

set_tracing_disabled(True)  # the stub model needs no OpenAI account

if not os.environ.get("VULNIFY_API_KEY"):
    sys.exit("Set VULNIFY_API_KEY (see .env.example)")
for tool, target, output in asyncio.run(agent.run(Vulnify(api_key=os.environ["VULNIFY_API_KEY"]))):
    print(f"{tool} {target}: {output}")
print("side effects:", agent.EXECUTED)
