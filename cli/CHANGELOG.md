# Changelog

## 0.3.0

- audit: closing CTA now links to https://www.vulnify.io/?utm_source=cli&utm_medium=tool&utm_campaign=audit (also in `--json` as `cta`).
- audit: new rule `mcp-injection` flags prompt-injection text or invisible Unicode in MCP server `description` / `instructions` / `prompt`.
- audit: VS Code user and workspace `settings.json` are scanned (`mcp` servers, `chat.tools.autoApprove`).
- audit: masking is now first 4 characters + `****`; values under 12 characters are fully masked.
- Top-level `--help` lists both commands.
- Tests: read-only guarantee (no file created or modified), no network modules, UTM link.

## 0.2.0

- `audit`: local, read-only audit of Claude Code, Cursor, Codex, Claude Desktop and VS Code configs, with masked secrets, `--json`, `--fail-on` and `--dir`.

## 0.1.x

- `hook claude-code`: install the fail-closed Vulnify PreToolUse hook into Claude Code.
