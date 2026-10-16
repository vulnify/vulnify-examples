// An MCP client (stand-in for Claude/Cursor) talking to the proxy, which wraps demo-upstream.mjs.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (!process.env.VULNIFY_API_KEY) { console.error('Set VULNIFY_API_KEY (see .env.example)'); process.exit(1); }
const c = new Client({ name: 'demo-client', version: '1.0.0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ['proxy.mjs', process.execPath, 'demo-upstream.mjs'], env: process.env }));
console.log('tools:', (await c.listTools()).tools.map((t) => t.name).join(', '));
for (const [name, args] of [['read_customer', { email: 'ana@example.com' }], ['export_customers', { to: 'partner@example.net', count: 800 }], ['delete_customers', { count: 3 }]]) {
  const r = await c.callTool({ name, arguments: args });
  console.log(`${name}: ${r.isError ? 'STOPPED' : 'ok'} - ${r.content[0].text}`);
}
await c.close();
