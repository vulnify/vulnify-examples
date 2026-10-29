import assert from 'node:assert/strict';
import test from 'node:test';
import { executed, runDemo } from './agent.mjs';
import { mockVulnify } from './mock.mjs';

test('read runs, the export is held, the delete is blocked', async () => {
  const fake = mockVulnify();
  const rows = await runDemo(fake);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].output, 'contents of README.md');
  assert.match(String(rows[1].output), /Vulnify REVIEW/);
  assert.match(String(rows[1].output), /800/);
  assert.match(String(rows[2].output), /Vulnify BLOCK/);
  assert.deepEqual(fake.seen.map((action) => action.action), ['READ_DATA', 'EXPORT_DATA', 'DELETE_DATA']);
  assert.equal(fake.seen[1].recordsAffected, 800);
  assert.equal(fake.seen[1].destination, 'EXTERNAL_EMAIL');
  assert.deepEqual(executed, ['read_file README.md']);
});
