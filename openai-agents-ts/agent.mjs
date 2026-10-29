import { Agent, run, setTracingDisabled, tool } from '@openai/agents';
import { assistantMessage, functionCall, modelResponse, ScriptedModel } from '@openai/agents/testing';
import { guardOpenAIAgentsTool } from '@vulnify/sdk';
import { z } from 'zod';

const AGENT = process.env.VULNIFY_AGENT || 'support-agent';

/** The real side effects. In this example they only record a string. */
export const executed = [];

setTracingDisabled(true);

function guarded(vulnify, config, describe) {
  return tool(guardOpenAIAgentsTool(vulnify, config, describe));
}

export function buildAgent(vulnify, model) {
  const readFile = guarded(vulnify, {
    name: 'read_file',
    description: 'Read one file in the project.',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path }) => { executed.push(`read_file ${path}`); return `contents of ${path}`; },
  }, () => ({ agent: AGENT, action: 'READ_DATA', resource: 'Project Files', destination: 'INTERNAL', recordsAffected: 1 }));

  const exportCustomers = guarded(vulnify, {
    name: 'export_customers',
    description: 'Export customer records and email them to an address.',
    parameters: z.object({ email: z.string(), rows: z.number().int() }),
    execute: async ({ email, rows }) => { executed.push(`export_customers ${rows} -> ${email}`); return `exported ${rows} customers to ${email}`; },
  }, ({ rows }) => ({ agent: AGENT, action: 'EXPORT_DATA', resource: 'Customer Database', destination: 'EXTERNAL_EMAIL', recordsAffected: rows }));

  const deleteProductionDatabase = guarded(vulnify, {
    name: 'delete_production_database',
    description: 'Delete the production database.',
    parameters: z.object({ confirm: z.boolean() }),
    execute: async ({ confirm }) => {
      if (!confirm) return 'not deleted';
      executed.push('delete_production_database');
      return 'deleted production database';
    },
  }, () => ({ agent: AGENT, action: 'DELETE_DATA', resource: 'Production Database', recordsAffected: 1 }));

  return new Agent({
    name: 'Ops assistant',
    instructions: 'Use the tools you are given.',
    tools: [readFile, exportCustomers, deleteProductionDatabase],
    // The runner prefers the agent's model over the run option, and the default
    // name is resolved through the OpenAI client. Pass the scripted model here.
    model,
  });
}

/** Scripted model from the Agents SDK test helpers. No OpenAI key. */
export function stubModel() {
  return new ScriptedModel([
    modelResponse([
      functionCall('read_file', { path: 'README.md' }, { callId: 'c1' }),
      functionCall('export_customers', { email: 'partner@example.com', rows: 800 }, { callId: 'c2' }),
      functionCall('delete_production_database', { confirm: true }, { callId: 'c3' }),
    ]),
    modelResponse([assistantMessage('Done.')]),
  ]);
}

export async function runDemo(vulnify, model = stubModel()) {
  executed.length = 0;
  const result = await run(buildAgent(vulnify, model), 'Do the three tasks.', { tracingDisabled: true });
  return result.newItems
    .filter((item) => item.type === 'tool_call_output_item')
    .map((item) => ({ output: item.output }));
}
