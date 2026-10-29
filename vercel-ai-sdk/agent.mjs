import { generateText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { guardAiSdkTools } from '@vulnify/sdk';
import { z } from 'zod';

const AGENT = process.env.VULNIFY_AGENT || 'support-agent';

/** The real side effects. In this example they only record a string, so nothing leaves the machine. */
export const executed = [];

const rawTools = {
  readFile: tool({
    description: 'Read one file in the project',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => { executed.push(`readFile ${path}`); return { path, text: `contents of ${path}` }; },
  }),
  exportCustomers: tool({
    description: 'Export customer records to an email address',
    inputSchema: z.object({ email: z.string(), rows: z.number() }),
    execute: async ({ email, rows }) => { executed.push(`exportCustomers ${rows} -> ${email}`); return { sent: rows }; },
  }),
  deleteProductionDatabase: tool({
    description: 'Delete the production database',
    inputSchema: z.object({ confirm: z.boolean() }),
    execute: async ({ confirm }) => { executed.push(`deleteProductionDatabase ${confirm}`); return { deleted: confirm }; },
  }),
};

/** Each tool is described to Vulnify before execute() runs. */
export function guardTools(vulnify, wait) {
  return guardAiSdkTools(vulnify, rawTools, {
    readFile: () => ({ agent: AGENT, action: 'READ_DATA', resource: 'Project Files', destination: 'INTERNAL', recordsAffected: 1 }),
    exportCustomers: ({ rows }) => ({ agent: AGENT, action: 'EXPORT_DATA', resource: 'Customer Database', destination: 'EXTERNAL_EMAIL', recordsAffected: rows }),
    deleteProductionDatabase: () => ({ agent: AGENT, action: 'DELETE_DATA', resource: 'Production Database', recordsAffected: 1 }),
  }, wait ? { wait } : undefined);
}

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };

/**
 * Stub LLM (no model API key): step 1 asks for the three tools, step 2 answers.
 * Swap in any real model, for example openai('gpt-4.1'), and the guard works the same.
 */
export function stubModel() {
  let step = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => (step++ === 0
      ? { content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'readFile', input: JSON.stringify({ path: 'README.md' }) },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'exportCustomers', input: JSON.stringify({ email: 'partner@example.com', rows: 800 }) },
          { type: 'tool-call', toolCallId: 'c3', toolName: 'deleteProductionDatabase', input: JSON.stringify({ confirm: true }) },
        ], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] }
      : { content: [{ type: 'text', text: 'Done.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
  });
}

export async function run(vulnify, model = stubModel()) {
  executed.length = 0;
  const result = await generateText({
    model,
    tools: guardTools(vulnify),
    stopWhen: stepCountIs(3),
    prompt: 'Read README.md, export 800 customers to partner@example.com, and delete the production database.',
  });
  return result.steps.flatMap((step) => step.toolResults).map((row) => ({ tool: row.toolName, output: row.output }));
}
