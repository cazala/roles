import { h, put, warn } from './ui.js';
import { toTree, words, allowanceKeys, accrued } from './conditions.js';
import { read, keyName, json } from './roles.js';
export function conditionView(flat) {
  try {
    const draw = (node, name) => h('li', words(node, name), node.children.length > 0 && h('ul', node.children.map((child, i) => draw(child, [1,2,3].includes(node.operator) ? name : 'Parameter ' + (i + 1)))));
    return h('div', h('ul', draw(toTree(flat), 'Call data')), h('details', h('summary', 'Exact conditions'), h('pre', json(flat))));
  } catch (e) { return h('div', warn(e.message), h('pre', json(flat))); }
}
export function allowanceView(ctx) {
  const root = h('div', h('h2', 'Allowances'), h('p.mut', 'Exact base units · balances at block ' + Number(BigInt(ctx.snapshot.number))));
  const keys = Object.keys(ctx.state.allowances);
  if (!keys.length) root.append(h('p.empty', 'No allowances in the scanned history.'));
  for (const key of keys) {
    const uses = Object.values(ctx.state.roles).filter(r => Object.values(r.targets).some(t => Object.values(t.functions).some(f => allowanceKeys(f.conditions).includes(key))));
    const panel = h('div.panel', h('h3', keyName(key))), values = h('div', 'Reading allowance…');
    panel.append(values, h('p.mut', uses.length ? 'Referenced by ' + uses.map(r => keyName(r.key)).join(', ') : 'No role references this allowance.'), h('details', h('summary', 'Allowance key'), h('code', key))); root.append(panel);
    read(ctx.request, ctx.address, 'allowances(bytes32 key)', ['uint128','uint128','uint64','uint128','uint64'], ctx.snapshot.number, [key]).then(([refill,maxRefill,period,balance,timestamp]) => {
      const current = accrued({ refill,maxRefill,period,balance,timestamp }, BigInt(ctx.snapshot.timestamp));
      put(values, h('p', 'Balance ', h('b', current.balance.toString())), h('p', 'Refill ', refill.toString(), ' · Maximum refill balance ', maxRefill.toString()), h('p', period === 0n ? 'One-time allowance; no refill.' : 'Every ' + period + ' seconds · Next refill timestamp ' + current.next));
    }).catch(e => put(values, warn(e.message)));
  }
  return root;
}
