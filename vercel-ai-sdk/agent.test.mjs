import assert from 'node:assert/strict';
import test from 'node:test';
import { executed, run } from './agent.mjs';
import { mockVulnify } from './mock.mjs';

test('read runs, the export is held, the delete is blocked', async () => {
  const fake = mockVulnify();
  const out = await run(fake);
  const byTool = Object.fromEntries(out.map((row) => [row.tool, row.output]));
  assert.deepEqual(fake.seen.map((action) => action.action), ['READ_DATA', 'EXPORT_DATA', 'DELETE_DATA']);
  assert.equal(fake.seen[1].recordsAffected, 800);
  assert.equal(fake.seen[1].destination, 'EXTERNAL_EMAIL');
  assert.equal(byTool.readFile.text, 'contents of README.md');
  assert.equal(byTool.exportCustomers.blocked, true);
  assert.equal(byTool.exportCustomers.decision, 'REVIEW');
  assert.equal(byTool.deleteProductionDatabase.blocked, true);
  assert.equal(byTool.deleteProductionDatabase.decision, 'BLOCK');
  assert.deepEqual(executed, ['readFile README.md']);
});
