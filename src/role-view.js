// A role, readable: Permissions (one card per target, its functions, their conditions as a parameter table)
// and Members. Function and parameter names are display only: an ABI entry is used for a function only when it
// hashes to that function's selector, which is what executes. Values are decoded by the ABI type when known,
// and otherwise shown exactly as encoded.
import { h, put, addr, warn, copy, menu, sheet, toClipboard, copyButton, tagButton } from './ui.js';
import { parseAbi } from './abicoder.js';
import { toTree, TYPES } from './conditions.js';
import { keyName, json } from './roles.js';
import { explorerKey, explorerSource } from './reads.js';
import { load, store } from './store.js';
import * as labels from './labels.js';
import { readAbi } from './abifile.js';

// Standard interfaces, known without any lookup.
const STANDARD = parseAbi([
  'transfer(address to, uint256 amount)', 'approve(address spender, uint256 amount)', 'transferFrom(address from, address to, uint256 amount)',
  'deposit(uint256 assets, address receiver)', 'mint(uint256 shares, address receiver)', 'withdraw(uint256 assets, address receiver, address owner)', 'redeem(uint256 shares, address receiver, address owner)',
  'deposit()', 'withdraw(uint256 amount)',
].join('\n'));
const sel = (s) => String(s).toLowerCase().replace(/^0x/, '');
const pastedKey = (chain, address) => 'abi:' + chain + ':' + address, nameKey = (chain, address) => 'abiname:' + chain + ':' + address;


/** Names for a target: { name, source, fns: Map(selector → function) }. Your ABI, else Etherscan's, else standard ones. */
export async function namesFor(chain, address) {
  const fns = new Map(), add = (list) => list.forEach((f) => f.selector && !fns.has(f.selector) && fns.set(f.selector, f));
  let name = load(nameKey(chain, address), '') || null, source = null, missing = null, explorer = false;
  const pasted = load(pastedKey(chain, address), '');
  if (pasted) { try { add(parseAbi(pasted)); source = 'your ABI'; } catch {} }
  if (explorerKey()) {
    try {
      const s = await explorerSource(explorerKey(), chain, address);
      name = name || s.name;
      if (s.abi) add(parseAbi(s.abi)), (source = source || 'Etherscan (verified source)'), (explorer = true);
      else missing = 'Etherscan has no verified source for this contract.';
    } catch (e) { missing = e.message; }
  }
  const abi = [...fns.values()]; // from a real ABI (yours or Etherscan's): what Add function offers
  const before = fns.size;
  add(STANDARD);
  if (fns.size > before && !source) source = 'standard interfaces';
  return { name, source, fns, abi, missing, explorer, pasted: !!pasted };
}

// An address with its contract name next to it, muted, when an Etherscan key is set and the contract is
// verified there (wallets have none). The address stays: the name is a hint from Etherscan, not a claim we check.
export function named(chain, a) {
  const tag = h('span.mut.aname');
  if (explorerKey()) explorerSource(explorerKey(), chain, a).then((s) => s.name && put(tag, s.name), () => {});
  return [addr(a), tag];
}

// ---- conditions: a table of parameters, logical groups as labelled brackets ----
const OPS = { 0: 'any value', 15: 'is the avatar', 16: 'is equal to', 17: 'is greater than', 18: 'is less than', 19: 'is greater than (signed)', 20: 'is less than (signed)', 21: 'matches the bitmask', 22: 'passes a custom check', 28: 'is within allowance' };
const GROUP = { 1: 'AND', 2: 'OR', 3: 'NOR' };
const signed = (v) => { const n = BigInt(v); return (n >> 255n ? n - (1n << 256n) : n).toString(); };
function value(node, type, ctx) {
  const v = node.compValue, op = node.operator;
  if (op === 15) return named(ctx.chain, ctx.meta.avatar);
  if (op === 28) return h('a', { href: '#/' + ctx.address + '/allowances' }, keyName(v));
  if (!v || v === '0x') return null;
  if (op === 17 || op === 18) return BigInt(v).toString();
  if (op === 19 || op === 20) return signed(v);
  if (op === 16 && v.length === 66 && type) {
    if (type === 'address' && /^0x0{24}/.test(v)) return named(ctx.chain, '0x' + v.slice(26));
    if (/^uint\d*$/.test(type)) return BigInt(v).toString();
    if (/^int\d*$/.test(type)) return signed(v);
    if (type === 'bool' && /^0x0{63}[01]$/.test(v)) return v.endsWith('1') ? 'true' : 'false';
  }
  return [h('code.cval', v), v.length > 66 && copy(v, 'Copy value')];
}
// While a table renders, the top-level parameter its rows belong to (so a click edits that parameter).
let at = null;
const row = (name, type, op, val) => h('div.crow', { 'data-at': at }, h('span.cname', name), h('span.ctype', type), h('span.cop' + (op === 'any value' ? '.mut' : ''), op), h('span.cvalue', val || ''));
const element = (p) => ({ name: (p.name || 'element') + ' element', type: p.type.replace(/\[\d*\]$/, ''), components: p.components });
function node(n, p, ctx) {
  const op = n.operator, name = p.name || 'Parameter', type = p.type || TYPES[n.paramType];
  if (GROUP[op]) return h('div.cgroup', h('span.clabel', h('span', GROUP[op])), h('div.cgbody', n.children.map((c) => node(c, p, ctx))));
  if (op === 5) {
    const parts = p.inputs || p.components || [], label = p.inputs ? 'Parameter ' : 'Field ';
    const top = !!p.inputs, outer = at;
    const kids = n.children.map((c, i) => { if (top) at = [29, 30].includes(c.operator) ? null : i; const r = node(c, { ...(parts[i] || {}), name: (parts[i] && parts[i].name) || label + (i + 1) }, ctx); if (top) at = outer; return r; });
    const rest = parts.slice(n.children.length).map((q, i) => { if (top) at = n.children.length + i; const r = row(q.name || label + (n.children.length + i + 1), q.type, 'any value'); if (top) at = outer; return r; });
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
/** The condition table; with `onEdit`, a click on a parameter's row edits that parameter (onEdit(index)). */
export function conditionTable(flat, f, ctx, onEdit) {
  try {
    const root = toTree(flat);
    at = null;
    return h('div.ctable' + (onEdit ? '.editable' : ''), { title: onEdit ? 'Click a parameter to edit its condition' : null, onclick: onEdit && ((e) => { const r = e.target.closest('.crow[data-at]'); if (r && !e.target.closest('button, a')) onEdit(Number(r.dataset.at)); }) }, h('div.crow.chead', h('span', 'Parameter'), h('span', 'Type'), h('span', 'Condition'), h('span', 'Value')), node(root, { inputs: f ? f.inputs : null, name: 'Call data' }, ctx));
  } catch (e) {
    return h('div', warn(e.message), h('pre', json(flat)));
  }
}

// ---- targets and functions ----
// With `ctx.edit` (the editor), every card, function and member carries its own actions, and what the draft
// changes is marked on the thing itself against `ctx.base`: new, changed, or revoked (struck, with Restore).
const chips = (options) => [(options & 1) === 1 && h('span.chip.warn', 'Can send ETH'), (options & 2) === 2 && h('span.chip.bad', 'Delegatecall')];
const signature = (f, s) => f ? h('code.sig', h('b', f.name), '(' + f.inputs.map((i) => i.type + (i.name ? ' ' + i.name : '')).join(', ') + ')') : h('code.sig', h('b', 'Function'), ' 0x' + s);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const mark = (was, now) => !was ? 'new' : !now ? 'gone' : same(was, now) ? null : 'changed';
const markChip = (m) => m === 'new' ? h('span.chip.draft', 'New') : m === 'changed' ? h('span.chip.draft', 'Changed') : m === 'gone' ? h('span.chip.draft', 'Revoked in draft') : null;
function fnView(fn, f, t, ctx, m) {
  const s = sel(fn.selector), ed = ctx.edit;
  const actions = m === 'gone'
    ? h('button.link', { onclick: () => ed.restoreFn(t, fn) }, 'Restore')
    : menu(() => [
      ed && ['Edit conditions', () => ed.conditions(t, fn, f)],
      ed && fn.conditions && ['Allow any parameters', () => ed.allowAny(t, fn)],
      ed && ['Execution options…', () => ed.fnOptions(t, fn)],
      fn.conditions && ['Exact conditions', () => exact(fn, f, s)],
      ['Copy selector', () => toClipboard('0x' + s).catch(() => {})],
      ed && ['Revoke function', () => ed.revokeFn(t, fn), true],
    ], 'Function actions');
  return h('div.fn' + (m ? '.pend' : '') + (m === 'gone' ? '.gone' : ''), h('div.fnhead', signature(f, s), h('span.chip.mono', '0x' + s), chips(fn.options), markChip(m), h('span.grow'), actions),
    m !== 'gone' && [t.clearance !== 2 && warn('Dormant: the target allows all functions, or is revoked.'), fn.conditions ? conditionTable(fn.conditions, f, ctx, ed && f && ((i) => ed.conditions(t, fn, f, i))) : h('p.mut.fnfree', 'Any parameters.', ed && f && f.inputs.length > 0 && [' ', h('button.link', { onclick: () => ed.conditions(t, fn, f) }, 'Add conditions')])]);
}
/** The conditions exactly as stored onchain (the flat list the contract checks), to read or copy. */
function exact(fn, f, s) {
  const { body } = sheet('edit', 'Exact conditions', true), text = json(fn.conditions);
  put(body, h('p.mut.small', 'The conditions as the contract stores them for ', h('code', f ? f.sig : '0x' + s), ': a flat list where each entry names its parent. This is what executes; the table is a reading of it.'), h('pre.exact', text), h('div.actions', copyButton('Copy', text)));
}
/** Your ABI for a contract: upload a .json (an ABI or a compiler artifact) or paste one, with an optional name. */
function abiDialog(ctx, address, done) {
  const { body, close } = sheet('edit', 'Contract ABI', true);
  const had = load(pastedKey(ctx.chain, address), '');
  const abiIn = h('textarea', { placeholder: 'ABI JSON, a compiler artifact, or one function signature per line', rows: 8, spellcheck: 'false', value: had });
  const nameIn = h('input', { placeholder: 'Contract name (optional)', value: load(nameKey(ctx.chain, address), ''), spellcheck: 'false', autocomplete: 'off' });
  const err = h('div'), file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const save = (text) => {
    put(err);
    try {
      const { abi, name } = readAbi(text);
      if (abi) parseAbi(abi); // refuse what cannot be parsed
      store(pastedKey(ctx.chain, address), abi);
      store(nameKey(ctx.chain, address), nameIn.value.trim() || name || '');
      close(); done();
    } catch (e) { put(err, warn('Could not read this ABI: ' + e.message)); }
  };
  file.onchange = () => file.files[0] && file.files[0].text().then(save, (e) => put(err, warn(e.message)));
  put(body,
    h('p.mut.small', 'The ABI names this contract’s functions and types their parameters, so you can pick functions and enter values by type. It is a label: what executes is the selector, and a name is shown only when it hashes to that selector. Kept in this browser.'),
    h('label', 'Contract name'), nameIn, h('label', 'ABI'), abiIn, file, err,
    h('div.dfoot', h('button', { onclick: () => file.click() }, 'Upload .json'), had && h('button.link', { onclick: () => (store(pastedKey(ctx.chain, address), ''), store(nameKey(ctx.chain, address), ''), close(), done()) }, 'Remove'), h('span.grow'), h('button', { onclick: close }, 'Cancel'), h('button.primary', { onclick: () => save(abiIn.value) }, 'Save')));
  abiIn.focus();
}
function targetView(t, ctx, key) {
  const ed = ctx.edit, was = ed && ctx.base?.roles[key]?.targets[t.address];
  const m = ed ? (t.clearance === 0 ? 'gone' : !was || was.clearance === 0 ? 'new' : was.clearance !== t.clearance || was.options !== t.options ? 'changed' : null) : null;
  const fns = Object.values(t.functions), title = h('b.tname'), hint = h('span.mut.aname'), body = h('div.tbody'), note = h('span.mut.small.tnote');
  // The title: your label, else the contract's name (your ABI, Etherscan), else "Unnamed contract". With a label,
  // the contract's name stays next to the address as a hint.
  const titled = () => {
    const l = labels.get(t.address), n = names && names.name;
    put(title, l || n || 'Unnamed contract');
    title.classList.toggle('mut', !l && !n);
    put(hint, l && n && n !== l ? n : null);
  };
  // Functions the draft revoked, still shown (struck) so they can be restored.
  // In the editor, functions keep their places: the base's order (revoked ones struck), then the new ones.
  const order = ed && was && was.clearance && m !== 'gone' ? [...new Set([...Object.keys(was.functions), ...Object.keys(t.functions)])] : Object.keys(t.functions);
  const clearance = ['Revoked', 'All functions', 'Scoped · ' + fns.length + ' function' + (fns.length === 1 ? '' : 's')][t.clearance];
  let names = null;
  const draw = (n) => {
    names = n;
    const fnMark = (fn) => ed && was && was.clearance ? mark(was.functions[fn.selector], fn) : ed ? 'new' : null;
    put(body, m === 'gone' ? null : t.clearance === 1 ? h('div.fn', h('div.fnhead', h('span', 'Every function of this contract'), chips(t.options))) : order.length ? order.map((k) => { const fn = t.functions[k] || was.functions[k]; return fnView(fn, n && n.fns.get(sel(k)), t, ctx, t.functions[k] ? fnMark(fn) : 'gone'); }) : h('p.mut.fnfree.fn', 'No functions configured.'));
    titled();
    put(note, n && n.source ? h('span', { title: 'Names are labels only: each one matches the selector that executes.' }, 'Names from ' + n.source) : n ? ['No ABI for this contract. ', h('button.link', { onclick: openAbi }, 'Add contract ABI')] : null);
  };
  const reload = () => namesFor(ctx.chain, t.address).then(draw, () => {});
  const openAbi = () => abiDialog(ctx, t.address, reload);
  draw(null);
  reload();
  const actions = m === 'gone' ? h('button.link', { onclick: () => ed.restoreTarget(t) }, 'Restore') : menu(() => [
    ed && t.clearance === 2 && ['Add function', () => ed.addFunction(t, names)],
    ed && t.clearance === 2 && ['Allow all functions…', () => ed.allowAll(t)],
    ed && t.clearance === 1 && ['Execution options…', () => ed.allowAll(t)],
    ed && t.clearance === 1 && ['Only configured functions', () => ed.scope(t)],
    !(names && names.explorer && !names.pasted) && [(names && names.pasted ? 'Replace' : 'Add') + ' contract ABI…', openAbi],
    ['Copy address', () => toClipboard(t.address).catch(() => {})],
    ed && ['Revoke target', () => ed.revokeTarget(t), true],
  ], 'Target actions');
  const foot = h('div.tfoot', ed && t.clearance === 2 && h('button.link.addfn', { onclick: () => ed.addFunction(t, names) }, '+ Add function'), h('span.grow'), note);
  const card = h('section.tcard' + (m ? '.pend' : '') + (m === 'gone' ? '.gone' : ''), h('div.thead', h('div.tid', title, h('span.taddr', addr(t.address, null, null, true), tagButton(t.address), hint)), markChip(m), m !== 'gone' && h('span.chip' + (t.clearance === 0 ? '.warn' : ''), clearance), actions), body, m !== 'gone' && foot);
  // A label set or changed (here or anywhere) retitles the card.
  const onLabels = (e) => (card.isConnected ? String(e.detail).toLowerCase() === t.address.toLowerCase() && titled() : removeEventListener('labels', onLabels));
  addEventListener('labels', onLabels);
  return card;
}

/** The role page: header, then Permissions and Members. */
let shown = { key: null, tab: 'permissions' }; // the open tab survives redraws of the same role
export function roleView(ctx, key) {
  const role = ctx.state.roles[key], ed = ctx.edit, base = ctx.base?.roles[key];
  if (!role) return h('p.mut', 'No role with this key was found in the scanned history.');
  if (shown.key !== key) shown = { key, tab: 'permissions' };
  const members = Object.entries(role.members).filter(([, yes]) => yes).map(([a]) => a), targets = Object.values(role.targets).filter((t) => t.clearance);
  // In the editor, also what the draft removed, so it can be restored.
  const goneMembers = ed && base ? Object.entries(base.members).filter(([a, yes]) => yes && !role.members[a]).map(([a]) => a) : [];
  const shownTargets = Object.values(role.targets).filter((t) => t.clearance || (ed && base?.targets[t.address]?.clearance)); // in place, revoked ones too
  const content = h('div'), tabs = h('nav.tabs.rtabs');
  const memberRow = (a, gone) => {
    const isNew = ed && !gone && !base?.members[a];
    const def = ctx.state.defaults[a] === key;
    return h('div.srow' + (gone || isNew ? '.pend' : '') + (gone ? '.gone' : ''), named(ctx.chain, a), !ctx.state.enabled[a] && h('span.chip.warn', 'Disabled'), def && h('span.chip', 'Default role'), isNew && h('span.chip.draft', 'New'), gone && h('span.chip.draft', 'Removed in draft'), h('span.grow'),
      ed && (gone ? h('button.link', { onclick: () => ed.restoreMember(a) }, 'Restore') : menu(() => [!def && ['Make this their default role', () => ed.makeDefault(a)], ['Copy address', () => toClipboard(a).catch(() => {})], ['Remove member', () => ed.removeMember(a), true]], 'Member actions')));
  };
  const show = (which) => {
    shown.tab = which;
    put(tabs, [['permissions', 'Permissions · ' + targets.length], ['members', 'Members · ' + members.length]].map(([id, text]) => h('a' + (id === which ? '.on' : ''), { href: '#', onclick: (e) => (e.preventDefault(), show(id)) }, text)), h('span.grow'),
      ed && (which === 'members' ? h('button.sm', { onclick: ed.addMember }, '+ Add member') : h('button.sm', { onclick: ed.addTarget }, '+ Add target')));
    put(content, which === 'members'
      ? members.length || goneMembers.length ? h('div.slist', members.map((a) => memberRow(a, false)), goneMembers.map((a) => memberRow(a, true))) : h('p.empty', 'No members assigned.')
      : shownTargets.length ? shownTargets.map((t) => targetView(t, ctx, key)) : h('p.empty', 'No targets configured for this role.'));
  };
  show(shown.tab);
  return h('div.role', h('div.rhead', h('h2', keyName(key)), h('span.grow'), ctx.roleActions), h('p.mut.rkey', h('code', key), copy(key, 'Copy role key')), tabs, content);
}
