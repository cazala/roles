// A roles.wei draft link (docs/links.md → Draft links) from a JSON plan, checked offline first: every field, and
// every change built as the editor would (conditions encoded from the signature). Nothing is sent anywhere.
//   node scripts/draft-link.mjs plan.json --modifier 0x… [--chain 1] [--gateway https://roles.wei.limo/]
//   cat plan.json | node scripts/draft-link.mjs - --modifier 0x…
import { readFileSync } from 'node:fs';
import { encode, check, apply } from '../src/draftlink.js';
import { emptyState } from '../src/roles.js';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const modifier = String(opt('modifier', '')).toLowerCase(), chain = Number(opt('chain', 1)), gateway = opt('gateway', 'https://roles.wei.limo/');
if (!file || !/^0x[0-9a-f]{40}$/.test(modifier) || !Number.isSafeInteger(chain) || !/^https:\/\/[^\s#?]+\/$/.test(gateway)) {
  console.error('Usage: node scripts/draft-link.mjs <plan.json | -> --modifier 0x… [--chain 1] [--gateway https://roles.wei.limo/]');
  process.exit(2);
}
try {
  const plan = check(JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')));
  const said = apply(emptyState(), structuredClone(plan)); // builds every change; the page applies it to the chain's state
  const link = gateway + '#/' + modifier + '?chain=' + chain + '&draft=' + (await encode(plan));
  console.error(said.map((s, i) => (i + 1) + '. ' + s).join('\n'));
  console.log(link);
} catch (e) {
  console.error('Not a valid draft: ' + e.message);
  process.exit(1);
}
