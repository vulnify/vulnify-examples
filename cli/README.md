# @vulnify/cli

Install the fail-closed [Vulnify](https://www.vulnify.io) PreToolUse hook into Claude Code:

```bash
npx @vulnify/cli hook claude-code            # this project (.claude/)
npx @vulnify/cli hook claude-code --user     # every project (~/.claude/)
npx @vulnify/cli hook claude-code --uninstall [--user]
```

The API key comes from `VULNIFY_API_KEY`, or a hidden prompt. It is never printed. A prompted key is saved in `.claude/settings.local.json` (git-ignored, mode 600) for a project, or in `~/.claude/settings.json` with `--user`.

Before each shell command, file write, web fetch or MCP tool call, Claude Code asks Vulnify. ALLOW runs, REVIEW waits for a person, BLOCK stops it, and if Vulnify can't be reached the call is held.

Docs: https://docs.vulnify.io/mcp/claude-code-hook/
