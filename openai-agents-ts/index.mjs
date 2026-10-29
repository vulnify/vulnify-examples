import { Vulnify } from '@vulnify/sdk';
import { executed, runDemo } from './agent.mjs';
import { mockVulnify } from './mock.mjs';

const key = (process.env.VULNIFY_API_KEY || '').trim();
const mock = process.argv.includes('--mock') || key === '' || key === 'vln_test_your_key_here' || key === 'vln_test_your_key';
const vulnify = mock ? mockVulnify() : new Vulnify({ apiKey: key, failMode: 'closed' });

console.log(mock
  ? 'Mock mode: no API call. A file read is ALLOW, the export is REVIEW, the delete is BLOCK.'
  : 'Live mode: decisions come from https://api.vulnify.io');

const names = ['read_file', 'export_customers', 'delete_production_database'];
const rows = await runDemo(vulnify);
rows.forEach((row, index) => console.log(`${names[index]}: ${row.output}`));
console.log('side effects:', executed);
