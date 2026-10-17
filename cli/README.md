# @vulnify/cli

## Audit the AI agents on your machine

```bash
npx @vulnify/cli audit                     # this machine + the current project
npx @vulnify/cli audit --json              # machine-readable
npx @vulnify/cli audit --fail-on high      # exit 1 in CI if anything is high or critical
npx @vulnify/cli audit --dir path/to/repo  # check another project folder
```

Local and read-only: it reads agent config files, never changes them, never starts an MCP server and makes no network calls. Secrets are always masked (first 4 characters + `***`), in text and in `--json`.

It checks Claude Code (`~/.claude/settings.json`, `.claude/settings*.json`, `~/.claude.json`, `.mcp.json`, `CLAUDE.md`, managed settings), Cursor (`~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.cursor/cli-config.json`, `.cursorrules`, `.cursor/rules/`), Codex (`~/.codex/config.toml`, `AGENTS.md`), Claude Desktop (`claude_desktop_config.json` on macOS, Windows and Linux) and VS Code / Copilot (`.vscode/mcp.json`, user `mcp.json`, `~/.copilot/mcp-config.json`, `.github/copilot-instructions.md`). `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `COPILOT_HOME` are honored.

| Rule | Severity |
| --- | --- |
| Approvals bypassed (`bypassPermissions`, Codex `danger-full-access`) or `Bash(*)` / wildcard allow | critical |
| Destructive command pre-approved (`rm`, `curl \| sh`, `git push --force`, `chmod`, `sudo`) | high |
| Plaintext secret in MCP `env`, `headers`, `args` or URL | high |
| Token (AWS, GitHub, OpenAI, Anthropic, Slack, Stripe, ...) in an agent config file | high |
| MCP server exposing shell / command execution | high |
| Filesystem MCP server with `/` or home access | high |
| Prompt injection in instruction files: "ignore the rules", "don't tell the user", exfiltration URLs, invisible Unicode, hidden HTML comments | high |
| Remote HTTP MCP server with no auth | medium |
| No Claude Code deny rules for `.env`, `~/.ssh`, `~/.aws` | medium |
| `.env` in the project | medium |
| Agent config with secrets readable by other users (POSIX) | medium |
| `npx` / `uvx` MCP server with no pinned version | low |

Each finding shows severity, `file:line`, why it matters and how to fix it, followed by a score out of 100.

## Install the Vulnify hook into Claude Code

```bash
npx @vulnify/cli hook claude-code            # this project (.claude/)
npx @vulnify/cli hook claude-code --user     # every project (~/.claude/)
npx @vulnify/cli hook claude-code --uninstall [--user]
```

The API key comes from `VULNIFY_API_KEY`, or a hidden prompt. It is never printed. A prompted key is saved in `.claude/settings.local.json` (git-ignored, mode 600) for a project, or in `~/.claude/settings.json` with `--user`.

Before each shell command, file write, web fetch or MCP tool call, Claude Code asks Vulnify. ALLOW runs, REVIEW waits for a person, BLOCK stops it, and if Vulnify can't be reached the call is held.

Docs: https://docs.vulnify.io/mcp/audit/ · https://docs.vulnify.io/mcp/claude-code-hook/
