// Vulnify in front of any stdio MCP server: `node proxy.mjs <upstream command...>`. Clients connect to this proxy instead.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ask } from './gate.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('usage: node proxy.mjs <upstream command> [args...]'); process.exit(2); }
const upstream = new Client({ name: 'vulnify-proxy', version: '1.0.0' });
await upstream.connect(new StdioClientTransport({ command, args, stderr: 'inherit' }));

const server = new Server({ name: 'vulnify-proxy', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: input = {} } = req.params;
  const v = await ask(name, input);
  if (!v.allowed) {
    return { isError: true, content: [{ type: 'text', text: `Vulnify ${v.decision}${v.eventId ? ` (event ${v.eventId})` : ''}: ${v.reasons.join('; ')}. The tool was not run.` }] };
  }
  return upstream.callTool({ name, arguments: input });
});
await server.connect(new StdioServerTransport());
