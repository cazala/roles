// A role, readable: Permissions (one card per target, its functions, their conditions as a parameter table)
// and Members. Function and parameter names are display only: an ABI entry is used for a function only when it
// hashes to that function's selector, which is what executes. Values are decoded by the ABI type when known,
// and otherwise shown exactly as encoded.
import { h, put, addr, warn, copy } from './ui.js';
import { parseAbi } from './abicoder.js';
import { toTree, TYPES } from './conditions.js';
import { keyName, json } from './roles.js';
import { explorerKey, explorerSource } from './reads.js';
import { load, store } from './store.js';
import * as labels from './labels.js';

// Standard interfaces, known without any lookup.
const STANDARD = parseAbi([
  'transfer(address to, uint256 amount)', 'approve(address spender, uint256 amount)', 'transferFrom(address from, address to, uint256 amount)',
  'deposit(uint256 assets, address receiver)', 'mint(uint256 shares, address receiver)', 'withdraw(uint256 assets, address receiver, address owner)', 'redeem(uint256 shares, address receiver, address owner)',
  'deposit()', 'withdraw(uint256 amount)',
].join('\n'));
const sel = (s) => String(s).toLowerCase().replace(/^0x/, '');
const pastedKey = (chain, address) => 'abi:' + chain + ':' + address;

/** Names for a target: { name, source, fns: Map(selector → function) }. Your ABI, else Etherscan's, else standard ones. */
async function namesFor(chain, address) {
  const fns = new Map(), add = (list) => list.forEach((f) => f.selector && !fns.has(f.selector) && fns.set(f.selector, f));
  let name = null, source = null;
  const pasted = load(pastedKey(chain, address), '');
  if (pasted) { try { add(parseAbi(pasted)); source = 'your ABI'; } catch {} }
  if (explorerKey()) {
    try {
      const s = await explorerSource(explorerKey(), chain, address);
      name = s.name;
      if (s.abi) add(parseAbi(s.abi)), (source = source || 'Etherscan (verified source)');
    } catch {}
  }
  const before = fns.size;
  add(STANDARD);
  if (fns.size > before && !source) source = 'standard interfaces';
  return { name, source, fns };
}

// ---- conditions: a table of parameters, logical groups as labelled brackets ----
const OPS = { 0: 'any value', 15: 'is the avatar', 16: 'is equal to', 17: 'is greater than', 18: 'is less than', 19: 'is greater than (signed)', 20: 'is less than (signed)', 21: 'matches the bitmask', 22: 'passes a custom check', 28: 'is within allowance' };
const GROUP = { 1: 'AND', 2: 'OR', 3: 'NOR' };
const signed = (v) => { const n = BigInt(v); return (n >> 255n ? n - (1n << 256n) : n).toString(); };
function value(node, type, ctx) {
  const v = node.compValue, op = node.operator;
  if (op === 15) return addr(ctx.meta.avatar);
  if (op === 28) return h('a', { href: '#/' + ctx.address + '/allowances' }, keyName(v));
  if (!v || v === '0x') return null;
  if (op === 17 || op === 18) return BigInt(v).toString();
  if (op === 19 || op === 20) return signed(v);
  if (op === 16 && v.length === 66 && type) {
    if (type === 'address' && /^0x0{24}/.test(v)) return addr('0x' + v.slice(26));
    if (/^uint\d*$/.test(type)) return BigInt(v).toString();
    if (/^int\d*$/.test(type)) return signed(v);
    if (type === 'bool' && /^0x0{63}[01]$/.test(v)) return v.endsWith('1') ? 'true' : 'false';
  }
  return [h('code.cval', v), v.length > 66 && copy(v, 'Copy value')];
}
const row = (name, type, op, val) => h('div.crow', h('span.cname', name), h('span.ctype', type), h('span.cop' + (op === 'any value' ? '.mut' : ''), op), h('span.cvalue', val || ''));
const element = (p) => ({ name: (p.name || 'element') + ' element', type: p.type.replace(/\[\d*\]$/, ''), components: p.components });
function node(n, p, ctx) {
  const op = n.operator, name = p.name || 'Parameter', type = p.type || TYPES[n.paramType];
  if (GROUP[op]) return h('div.cgroup', h('span.clabel', h('span', GROUP[op])), h('div.cgbody', n.children.map((c) => node(c, p, ctx))));
  if (op === 5) {
    const parts = p.inputs || p.components || [], label = p.inputs ? 'Parameter ' : 'Field ';
    const kids = n.children.map((c, i) => node(c, { ...(parts[i] || {}), name: (parts[i] && parts[i].name) || label + (i + 1) }, ctx));
    const rest = parts.slice(n.children.length).map((q, i) => row(q.name || label + (n.children.length + i + 1), q.type, 'any value'));
    return p.inputs ? h('div.cparts', kids, rest) : h('div.cnest', row(name, type, 'matches', null), h('div.cparts', kids, rest));
  }
  if (op === 6 || op === 7 || op === 8) {
    const el = p.type ? element(p) : { name: name + ' element' };
    return h('div.cnest', row(name, type, op === 6 ? 'has some element where' : op === 7 ? 'has every element where' : 'is a subset of', null), h('div.cparts', n.children.map((c) => node(c, el, ctx))));
  }
  const allowance = h('a', { href: '#/' + ctx.address + '/allowances' }, keyName(n.compValue));
  if (op === 29) return row('ETH sent', 'uint256', 'is within allowance', allowance);
  if (op === 30) return row('Calls', '', 'are within allowance', allowance);
  return row(name, type, OPS[op] || 'operator ' + op, value(n, p.type, ctx));
}
export function conditionTable(flat, f, ctx) {
  try {
    const root = toTree(flat);
    return h('div.ctable', h('div.crow.chead', h('span', 'Parameter'), h('span', 'Type'), h('span', 'Condition'), h('span', 'Value')), node(root, { inputs: f ? f.inputs : null, name: 'Call data' }, ctx), h('details', h('summary', 'Exact conditions'), h('pre', json(flat))));
  } catch (e) {
    return h('div', warn(e.message), h('pre', json(flat)));
  }
}

// ---- targets and functions ----
const chips = (options) => [(options & 1) === 1 && h('span.chip.warn', 'Can send ETH'), (options & 2) === 2 && h('span.chip.bad', 'Delegatecall')];
const signature = (f, s) => f ? h('code.sig', h('b', f.name), '(' + f.inputs.map((i) => i.type + (i.name ? ' ' + i.name : '')).join(', ') + ')') : h('code.sig', h('b', 'Function'), ' 0x' + s);
function fnView(fn, f, t, ctx) {
  const s = sel(fn.selector);
  return h('div.fn', h('div.fnhead', signature(f, s), h('span.chip.mono', '0x' + s), chips(fn.options)), t.clearance !== 2 && warn('Dormant: the target allows all functions, or is revoked.'), fn.conditions ? conditionTable(fn.conditions, f, ctx) : h('p.mut.fnfree', 'Any parameters.'));
}
function targetView(t, ctx) {
  const fns = Object.values(t.functions), unnamed = () => labels.get(t.address) || 'Unnamed contract', title = h('b.tname' + (labels.get(t.address) ? '' : '.mut'), unnamed()), body = h('div.tbody'), note = h('p.mut.small');
  const clearance = ['Revoked', 'All functions', 'Scoped · ' + fns.length + ' function' + (fns.length === 1 ? '' : 's')][t.clearance];
  const draw = (names) => {
    put(body, t.clearance === 1 ? h('div.fn', h('div.fnhead', h('span', 'Every function of this contract'), chips(t.options))) : fns.length ? fns.map((fn) => fnView(fn, names && names.fns.get(sel(fn.selector)), t, ctx)) : h('p.mut', 'No functions configured.'));
    if (names) put(title, names.name || unnamed()), title.classList.toggle('mut', !names.name && !labels.get(t.address)), put(note, names.source ? 'Names from ' + names.source + '. They are labels only: each one matches the selector that executes.' : 'No names for this contract. Add an Etherscan key in Settings, or paste its ABI.');
  };
  draw(null);
  namesFor(ctx.chain, t.address).then(draw, () => {});
  const abiIn = h('textarea', { placeholder: 'ABI JSON, or one function signature per line', rows: 3, spellcheck: 'false', value: load(pastedKey(ctx.chain, t.address), '') });
  const save = h('button', { onclick: () => { store(pastedKey(ctx.chain, t.address), abiIn.value.trim()); namesFor(ctx.chain, t.address).then(draw, () => {}); } }, 'Save');
  return h('section.tcard', h('div.thead', h('div.tid', title, addr(t.address, null, null, true)), h('span.chip' + (t.clearance === 0 ? '.warn' : ''), clearance)), body, h('div.tfoot', note, h('details', h('summary', 'Function names'), abiIn, h('div.actions', save))));
}

/** The role page: header, then Permissions and Members. */
export function roleView(ctx, key) {
  const role = ctx.state.roles[key];
  if (!role) return h('p.mut', 'No role with this key was found in the scanned history.');
  const members = Object.entries(role.members).filter(([, yes]) => yes).map(([a]) => a), targets = Object.values(role.targets).filter((t) => t.clearance);
  const content = h('div'), tabs = h('nav.tabs.rtabs');
  const show = (which) => {
    put(tabs, [['permissions', 'Permissions · ' + targets.length], ['members', 'Members · ' + members.length]].map(([id, text]) => h('a' + (id === which ? '.on' : ''), { href: '#', onclick: (e) => (e.preventDefault(), show(id)) }, text)));
    put(content, which === 'members'
      ? members.length ? h('div.slist', members.map((a) => h('div.srow', addr(a), !ctx.state.enabled[a] && h('span.chip.warn', 'Disabled'), ctx.state.defaults[a] === key && h('span.chip', 'Default role')))) : h('p.empty', 'No members assigned.')
      : targets.length ? targets.map((t) => targetView(t, ctx)) : h('p.empty', 'No targets configured for this role.'));
  };
  show('permissions');
  return h('div.role', h('h2', keyName(key)), h('p.mut.rkey', h('code', key), copy(key, 'Copy role key')), tabs, content);
}
