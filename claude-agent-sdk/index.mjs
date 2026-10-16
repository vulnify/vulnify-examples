// Offline-model demo: the tool requests below are what Claude would send to canUseTool. The Vulnify checks are real.
import { Vulnify } from '@vulnify/sdk';
import { vulnifyCanUseTool } from './guard.mjs';

if (!process.env.VULNIFY_API_KEY) { console.error('Set VULNIFY_API_KEY (see .env.example)'); process.exit(1); }
const canUseTool = vulnifyCanUseTool(new Vulnify({ apiKey: process.env.VULNIFY_API_KEY, failMode: 'closed' }));
const requests = [
  ['mcp__mail__send_email', { to: 'team@acme.internal', subject: 'Standup notes', body: 'Notes attached.' }],
  ['mcp__mail__send_email', { to: 'someone@gmail.com', subject: 'Customer list', body: 'Ana Souza, CPF 123.456.789-09, ana@example.com' }],
  ['Bash', { command: 'rm -rf ./exports/customers' }],
  ['Read', { file_path: 'README.md' }],
];
const signal = new AbortController().signal;
for (const [tool, input] of requests) {
  const r = await canUseTool(tool, input, { signal });
  console.log(`${tool} ${input.to ?? input.command ?? input.file_path}: ${r.behavior.toUpperCase()}${r.message ? ` - ${r.message}` : ''}`);
}
