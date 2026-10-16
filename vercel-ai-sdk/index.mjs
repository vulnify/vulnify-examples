import { Vulnify } from '@vulnify/sdk';
import { executed, run } from './agent.mjs';

if (!process.env.VULNIFY_API_KEY) { console.error('Set VULNIFY_API_KEY (see .env.example)'); process.exit(1); }
const vulnify = new Vulnify({ apiKey: process.env.VULNIFY_API_KEY, failMode: 'closed' });
for (const r of await run(vulnify)) {
  const o = r.output;
  console.log(o?.blocked ? `${r.tool}: NOT RUN, Vulnify ${o.decision} (event ${o.eventId}): ${o.reasons.join('; ')}` : `${r.tool}: ran -> ${JSON.stringify(o)}`);
}
console.log('side effects:', executed);
