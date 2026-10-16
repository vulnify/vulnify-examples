import { generateText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { guardAiSdkTools } from '@vulnify/sdk';
import { z } from 'zod';

const AGENT = process.env.VULNIFY_AGENT || 'support-agent';

/** The real side effects. In this example they only log, so nothing leaves your machine. */
export const executed = [];

const rawTools = {
  lookupCustomer: tool({
    description: 'Read one customer record',
    inputSchema: z.object({ email: z.string() }),
    execute: async ({ email }) => { executed.push(`lookupCustomer ${email}`); return { email, plan: 'TEAM' }; },
  }),
  exportCustomers: tool({
    description: 'Export customer records to an email address',
    inputSchema: z.object({ to: z.string(), count: z.number() }),
    execute: async ({ to, count }) => { executed.push(`exportCustomers ${count} -> ${to}`); return { sent: count }; },
  }),
};

/** Each guarded tool is described to Vulnify as an action before execute() runs. */
export function guardTools(vulnify) {
  return guardAiSdkTools(vulnify, rawTools, {
    lookupCustomer: () => ({ agent: AGENT, action: 'READ_DATA', resource: 'customers', destination: 'INTERNAL', recordsAffected: 1 }),
    exportCustomers: ({ count }) => ({ agent: AGENT, action: 'EXPORT_DATA', resource: 'customers', destination: 'EXTERNAL_EMAIL', recordsAffected: count }),
  });
}

/**
 * Stub LLM (no model API key needed): step 1 asks for both tools, step 2 answers.
 * Swap in any real model, e.g. openai('gpt-4.1'), and the guard works the same.
 */
export function stubModel() {
  let step = 0;
  const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
  return new MockLanguageModelV3({
    doGenerate: async () => (step++ === 0
      ? { content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'lookupCustomer', input: JSON.stringify({ email: 'ana@example.com' }) },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'exportCustomers', input: JSON.stringify({ to: 'partner@example.net', count: 800 }) },
        ], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] }
      : { content: [{ type: 'text', text: 'Done.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
  });
}

export async function run(vulnify, model = stubModel()) {
  const result = await generateText({ model, tools: guardTools(vulnify), stopWhen: stepCountIs(3), prompt: 'Look up ana@example.com, then send all 800 customers to partner@example.net' });
  return result.steps.flatMap((s) => s.toolResults).map((r) => ({ tool: r.toolName, output: r.output }));
}
