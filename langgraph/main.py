import os
import sys

from langgraph.types import Command
from vulnify import Vulnify

import graph

if not os.environ.get("VULNIFY_API_KEY"):
    sys.exit("Set VULNIFY_API_KEY (see .env.example)")
approve = "--approve" in sys.argv
app = graph.build(Vulnify(api_key=os.environ["VULNIFY_API_KEY"]))
cfg = {"configurable": {"thread_id": "demo-1"}}
out = app.invoke({"request": "Send all customers to partner@example.net"}, cfg)
if "__interrupt__" in out:
    info = out["__interrupt__"][0].value
    print(f"PAUSED for a human: Vulnify REVIEW, event {info['event_id']}")
    print("  reasons:", "; ".join(info["reasons"]))
    print(f"  human answers: {'approve' if approve else 'deny'}")
    out = app.invoke(Command(resume={"approved": approve}), cfg)
print("result:", out["result"], "| side effects:", graph.EXECUTED)
