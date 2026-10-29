import { Vulnify } from '@vulnify/sdk';
import { executed, run } from './agent.mjs';
import { mockVulnify } from './mock.mjs';

const key = (process.env.VULNIFY_API_KEY || '').trim();
const mock = process.argv.includes('--mock') || key === '' || key === 'vln_test_your_key_here' || key === 'vln_test_your_key';
const vulnify = mock
  ? mockVulnify()
  : new Vulnify({ apiKey: key, failMode: 'closed' });

console.log(mock
  ? 'Mock mode: no API call. A file read is ALLOW, the export is REVIEW, the delete is BLOCK.'
  : 'Live mode: decisions come from https://api.vulnify.io');

for (const row of await run(vulnify)) {
  const output = row.output;
  console.log(output?.blocked
    ? `${row.tool}: NOT RUN, Vulnify ${output.decision} (event ${output.eventId}): ${output.reasons.join('; ')}`
    : `${row.tool}: ran -> ${JSON.stringify(output)}`);
}
console.log('side effects:', executed);
