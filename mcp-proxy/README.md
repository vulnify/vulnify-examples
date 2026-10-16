# MCP proxy: Vulnify in front of any MCP server

Shows: a small stdio MCP proxy. Your client (Claude Desktop, Cursor, Claude Code) connects to the proxy, and the proxy connects to the real server. `tools/list` passes through unchanged. Each `tools/call` is first sent to Vulnify's MCP gateway (`POST /v1/gateway/mcp`), which maps the tool name to an action, records the decision and runs nothing. The proxy forwards the call upstream only on ALLOW. Otherwise the client gets an error with the reasons. If Vulnify is unreachable, the proxy fails closed.

> **Real MCP, real Vulnify, demo upstream.** `demo-upstream.mjs` is a tiny stand-in server with three customer tools, and `demo.mjs` is a stand-in MCP client. No LLM is involved. Point the proxy at any stdio server, e.g. `node proxy.mjs npx -y @modelcontextprotocol/server-filesystem ./data`.

## Run it (2 minutes)

```bash
npm install
cp .env.example .env   # add a TEST key from app.vulnify.io/api-keys
npm start
npm test               # offline, no key needed
```

The gateway does not register new names, so `VULNIFY_AGENT` and `VULNIFY_RESOURCE` must already exist in your org (Agents and Resources in app.vulnify.io).

## Expected output

```
tools: read_customer, export_customers, delete_customers
read_customer: ok - customer ana@example.com: plan TEAM
export_customers: STOPPED - Vulnify REVIEW (event 2adf3544-…): Export operation; External destination; Large data volume (800 records). The tool was not run.
delete_customers: ok - UPSTREAM RAN: deleted 3 customers
```

## Use it with your client

```json
{ "mcpServers": { "crm-guarded": {
  "command": "node",
  "args": ["/path/to/mcp-proxy/proxy.mjs", "npx", "-y", "your-mcp-server"],
  "env": { "VULNIFY_API_KEY": "vln_test_…", "VULNIFY_AGENT": "support-agent", "VULNIFY_RESOURCE": "customers" }
} } }
```

Keep the key in your local config only, and never paste it into a chat.

The gateway maps tool names containing `send` to `SEND_EMAIL`, `export` or `download` to `EXPORT_DATA`, `delete` or `remove` to `DELETE_DATA`, `write`, `update` or `create` to `WRITE_DATA`, and everything else to `READ_DATA`. The proxy sets `destination` to `EXTERNAL_EMAIL` when the arguments carry an outside `to` address and to `INTERNAL` otherwise, and takes `recordsAffected` from `count`.

Tested live on 2026-10-16 against a Vulnify TEST organization with `@modelcontextprotocol/sdk@1.32.1`.
