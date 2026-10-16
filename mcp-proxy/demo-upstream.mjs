// A tiny stand-in for "any MCP server": three customer tools that only log. Replace with your own server.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const s = new McpServer({ name: 'demo-crm', version: '1.0.0' });
const text = (t) => ({ content: [{ type: 'text', text: t }] });
s.registerTool('read_customer', { description: 'Read one customer', inputSchema: { email: z.string() } }, async ({ email }) => text(`customer ${email}: plan TEAM`));
s.registerTool('export_customers', { description: 'Email a customer export', inputSchema: { to: z.string(), count: z.number() } }, async ({ to, count }) => text(`UPSTREAM RAN: exported ${count} customers to ${to}`));
s.registerTool('delete_customers', { description: 'Delete customers', inputSchema: { count: z.number() } }, async ({ count }) => text(`UPSTREAM RAN: deleted ${count} customers`));
await s.connect(new StdioServerTransport());
