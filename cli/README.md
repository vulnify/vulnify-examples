# @vulnify/cli

## Audit the AI agents on your machine

```bash
npx @vulnify/cli audit                     # this machine + the current project
npx @vulnify/cli audit --json              # machine-readable
npx @vulnify/cli audit --fail-on high      # exit 1 in CI if anything is high or critical
npx @vulnify/cli audit --dir path/to/repo  # check another project folder
```

### Privacy guarantee

- **Local:** the audit makes no network calls. Nothing leaves your machine (you can verify with `unshare -rn npx @vulnify/cli audit` after a first run).
- **Read-only:** it only reads config files. It never writes, never starts an MCP server, never runs the commands it finds. Installing the hook is a separate, explicit command.
- **Masked:** secrets are never printed in full: first 4 characters + `****` (values under 12 characters show only `****`), in text and in `--json`.

### Exit codes

`0` by default, even with findings. With `--fail-on <low|medium|high|critical>`, exit `1` if any finding is at or above that severity. `2` for a bad option.

It checks Claude Code (`~/.claude/settings.json`, `.claude/settings*.json`, `~/.claude.json`, `.mcp.json`, `CLAUDE.md`, managed settings), Cursor (`~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.cursor/cli-config.json`, `.cursorrules`, `.cursor/rules/`), Codex (`~/.codex/config.toml`, `AGENTS.md`), Claude Desktop (`claude_desktop_config.json` in `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux) and VS Code / Copilot (`.vscode/mcp.json`, user `mcp.json`, user and workspace `settings.json` (`mcp` block and `chat.tools.autoApprove`), `~/.copilot/mcp-config.json`, `.github/copilot-instructions.md`). `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `COPILOT_HOME` are honored.

| Rule | Severity |
| --- | --- |
| Approvals bypassed (`bypassPermissions`, Codex `danger-full-access`, VS Code `chat.tools.autoApprove`) or `Bash(*)` / wildcard allow | critical |
| Destructive command pre-approved (`rm`, `curl \| sh`, `git push --force`, `chmod`, `sudo`) | high |
| Plaintext secret in MCP `env`, `headers`, `args` or URL | high |
| Token (AWS, GitHub, OpenAI, Anthropic, Slack, Stripe, ...) in an agent config file | high |
| MCP server exposing shell / command execution | high |
| Filesystem MCP server with `/` or home access | high |
| Prompt injection in instruction files: "ignore the rules", "don't tell the user", exfiltration URLs, invisible Unicode, hidden HTML comments | high |
| Prompt injection in an MCP server `description` / `instructions` | high |
| Remote HTTP MCP server with no auth | medium |
| No Claude Code deny rules for `.env`, `~/.ssh`, `~/.aws` | medium |
| `.env` in the project | medium |
| Agent config with secrets readable by other users (POSIX) | medium |
| `npx` / `uvx` MCP server with no pinned version | low |

Each finding shows severity, `file:line`, why it matters and how to fix it, followed by a score out of 100.

### Sample output (excerpt)

```text
Vulnify audit  read-only, nothing left this machine
Checked 10 config files (Claude Code, Cursor, Codex, Claude Desktop, VS Code)

CRITICAL Approvals are bypassed or every command is allowed
  ~/.claude/settings.json:1  allow rule "Bash(*)"
  ~/.codex/config.toml:2  approval_policy = "never" with sandbox_mode = "danger-full-access"
  Why: The agent runs any shell command and edits any file without asking, so one bad prompt is enough to do damage.
  Fix: Remove bypass mode / wildcard allow rules and allow only the specific commands you need.

HIGH     Plaintext secret in MCP server config
  ./.mcp.json:1  server "gh", GITHUB_TOKEN = ghp_****
  Why: The key sits in a config file that gets synced, backed up, pasted into issues and read by other tools and agents.
  Fix: Move it to an env var or OS keychain and reference it, then rotate the key.

LOW      MCP server runs an unpinned package
  ./.mcp.json:1  server "gh": npx @modelcontextprotocol/server-github
  ...

Score 0/100 (F)  4 critical, 13 high, 7 medium, 7 low
Turn these findings into enforced runtime policies with Vulnify: https://www.vulnify.io/?utm_source=cli&utm_medium=tool&utm_campaign=audit
```

## Install the Vulnify hook into Claude Code

```bash
npx @vulnify/cli hook claude-code            # this project (.claude/)
npx @vulnify/cli hook claude-code --user     # every project (~/.claude/)
npx @vulnify/cli hook claude-code --uninstall [--user]
```

The API key comes from `VULNIFY_API_KEY`, or a hidden prompt. It is never printed. A prompted key is saved in `.claude/settings.local.json` (git-ignored, mode 600) for a project, or in `~/.claude/settings.json` with `--user`.

Before each shell command, file write, web fetch or MCP tool call, Claude Code asks Vulnify. ALLOW runs, REVIEW waits for a person, BLOCK stops it, and if Vulnify can't be reached the call is held.

Docs: https://docs.vulnify.io/mcp/audit/ · https://docs.vulnify.io/mcp/claude-code-hook/
