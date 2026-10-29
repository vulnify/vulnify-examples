# Vulnify examples

Copy-paste setups that put [Vulnify](https://www.vulnify.io) in front of an agent tool call. Vulnify is a runtime authorization layer: each action comes back ALLOW, REVIEW, or BLOCK, and the decision is written to the audit log.

REVIEW holds the action. A person approves or denies it in the [Vulnify app](https://app.vulnify.io) or in Slack. BLOCK stops it. ALLOW runs it.

Each folder has a README, a gitignored `.env` for a TEST key from https://app.vulnify.io, pinned dependencies, and a mock mode that runs with no key. The first six rows use one scenario: reading a file is ALLOW, exporting 800 records to an external email is REVIEW, and deleting a production database is BLOCK. The Claude Code hook maps that export to `EXTERNAL_API` because the tool call is a file upload, and it only checks the file read when `VULNIFY_HOOK_CHECK_READS=true`.

| Example | Stack | What it shows |
|---|---|---|
| [langgraph/](langgraph/) | Python, LangChain tools, LangGraph | `langgraph_tool_guard` on a `ToolNode`. REVIEW and BLOCK become an error tool message. |
| [crewai/](crewai/) | Python, CrewAI | `guard_crewai_tool` on three `BaseTool`s attached to an `Agent` and a `Crew`. |
| [vercel-ai-sdk/](vercel-ai-sdk/) | Node, Vercel AI SDK | `guardAiSdkTools` before `execute`. A blocked call returns `{ blocked: true }` to the model. |
| [openai-agents-sdk/](openai-agents-sdk/) | Python, OpenAI Agents SDK | `guard_openai_agents_tool` on each `function_tool`. The `Runner` gets the reason text instead of a result. |
| [openai-agents-ts/](openai-agents-ts/) | Node, OpenAI Agents SDK | The same guard, with `tool()` and a scripted model from `@openai/agents/testing`. |
| [claude-code-hook/](claude-code-hook/) | Node, Claude Code | `PreToolUse` hook config plus `vulnify-hook.mjs`. Also `npx @vulnify/cli audit`, which stays on this machine. |
| [claude-agent-sdk/](claude-agent-sdk/) | Node, Claude Agent SDK | `canUseTool` asks Vulnify before sending email or `rm`. |
| [mcp-proxy/](mcp-proxy/) | Node, MCP SDK | A stdio proxy. Calls are forwarded only on ALLOW. |
| [slack-review/](slack-review/) | Python | An 800-record external export gets REVIEW, then waits for Approve or Deny in Slack. |
| [tinyfish/](tinyfish/) | Python, TinyFish | A web agent fills out a form only after a Vulnify check. |

Mock mode does not call the API. It applies a local demo rule, so the production delete is BLOCK. A TEST key does not do that. The risk engine ALLOWs the read and sends the 800-record external export to REVIEW. The delete is `DELETE_DATA` with `records_affected` 1, and that score is often ALLOW until a policy BLOCKs `DELETE_DATA`.

The SDK clients have no method that creates a policy. In the app at https://app.vulnify.io, open Policies and create `block-deletes`: action family `DELETE`, resource type `ANY`, condition action `DELETE_DATA`, decision `BLOCK`, mode `ENFORCE`. The file is [policies/block-deletes.yaml](policies/block-deletes.yaml). It matches every `DELETE_DATA`, not only the resource name `Production Database`. A policy file has no field for that name. A rule that only blocks large deletes does not match these demos.

`apply` needs an org-wide LIVE key. The TEST key used to run an example is not enough.

```bash
npx -p @vulnify/sdk@0.3.3 vulnify policies validate policies/block-deletes.yaml
npx -p @vulnify/sdk@0.3.3 vulnify policies apply policies/block-deletes.yaml
```

Python: `pip install "vulnify[cli]==0.4.2"`, then `vulnify policies validate policies/block-deletes.yaml` and `vulnify policies apply policies/block-deletes.yaml`. Run the example again with the TEST key. The delete comes back BLOCK.

Keys stay in `.env`. Do not commit them.

## Claude skill

[skills/vulnify-guard-actions/SKILL.md](skills/vulnify-guard-actions/SKILL.md) tells Claude to call Vulnify `decide_action` before a consequential action and to act on ALLOW, REVIEW, or BLOCK. Copy the folder into `~/.claude/skills/` or upload it as a skill. It is guidance for the model. The Claude Code hook above is the enforced path.
