import assert from 'node:assert/strict';
import test from 'node:test';
import { VulnifyBlockedError } from '@vulnify/sdk';
import { executed, run } from './agent.mjs';

// Offline: a fake Vulnify with the same guard() contract. REVIEW for external exports, ALLOW otherwise.
const seen = [];
const fake = {
  async guard(action, fn) {
    seen.push(action);
    if (action.destination === 'EXTERNAL_EMAIL') throw new VulnifyBlockedError({ id: 'evt_test', decision: 'REVIEW', finalDecision: 'REVIEW', reasons: ['External destination'] });
    return fn();
  },
};

test('the export never executes when Vulnify does not allow it', async () => {
  const out = await run(fake);
  assert.deepEqual(seen.map((a) => a.action), ['READ_DATA', 'EXPORT_DATA']);
  assert.equal(seen[1].recordsAffected, 800);
  assert.deepEqual(executed, ['lookupCustomer ana@example.com']);
  assert.equal(out.find((r) => r.tool === 'exportCustomers').output.blocked, true);
});
