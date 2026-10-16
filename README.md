# Vulnify examples

Short, runnable examples of putting [Vulnify](https://www.vulnify.io) in front of AI agent actions. Each one has a 2-minute run, its expected output, a `.env.example` with placeholders only, and an offline test. Every example was run live against a Vulnify TEST organization.

| Example | Stack | What it shows | Model |
|---|---|---|---|
| [vercel-ai-sdk/](vercel-ai-sdk/) | Node, `ai` v7 | `guardAiSdkTools`: a tool call is checked before `execute()`; an 800-record external export gets REVIEW and never runs | Stub (`MockLanguageModelV3`) |
| [claude-agent-sdk/](claude-agent-sdk/) | Node, Claude Agent SDK | `canUseTool` asks Vulnify before sending email or `rm` | Scripted tool requests |
| [openai-agents-sdk/](openai-agents-sdk/) | Python, OpenAI Agents SDK | `tool_input_guardrail` rejects tool calls Vulnify doesn't allow | Stub `Model` |
| [tinyfish/](tinyfish/) | Python, TinyFish | A web agent fills out a form only after a Vulnify check | Real TinyFish run |

Where an example uses a stub model, the Vulnify checks are still real API calls. Each README says so.

Keys are read from the environment. Use a TEST key from app.vulnify.io/api-keys and never commit real keys.
