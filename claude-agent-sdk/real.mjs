// The same callback wired into a real Claude agent. Needs ANTHROPIC_API_KEY and Claude Code installed. (Not part of the live test.)
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Vulnify } from '@vulnify/sdk';
import { vulnifyCanUseTool } from './guard.mjs';

const canUseTool = vulnifyCanUseTool(new Vulnify({ apiKey: process.env.VULNIFY_API_KEY, failMode: 'closed' }));
for await (const msg of query({ prompt: process.argv[2] ?? 'Clean up ./exports', options: { canUseTool, permissionMode: 'default' } })) {
  if (msg.type === 'result') console.log(msg.subtype === 'success' ? msg.result : msg);
}
