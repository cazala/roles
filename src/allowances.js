// Allowances: budgets a role spends through its conditions (Within allowance on a parameter, ETH sent, or a
// number of calls), refilled by an amount every period up to a cap. One card each, read as a sentence, and an
// editor that asks for the same things in words, with the exact stored values shown under every field.
import { h, put, warn, menu, sheet, act, toClipboard, infoLabel } from './ui.js';
import { keyName, roleKey, read } from './roles.js';
import { accrued } from './conditions.js';
import { parseUnits, formatUnits } from './units.js';

const MAX = (1n << 128n) - 1n, MAX64 = (1n << 64n) - 1n;
const FIELDS = ['balance', 'maxRefill', 'refill', 'period', 'timestamp'];
const big = (x) => BigInt(x ?? 0);
const same = (a, b) => !!a && !!b && FIELDS.every((k) => big(a[k]) === big(b[k]));
const STEPS = [[604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
/** A period in words, exactly: the largest unit that divides it (7 days → 1 week, 90 minutes → 90 minutes). */
const duration = (s) => { s = Number(s); const [n, u] = STEPS.find(([n]) => s % n === 0); const k = s / n; return k + ' ' + u + (k === 1 ? '' : 's'); };
const when = (t) => new Date(Number(t) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const until = (t, now) => { const d = Number(t) - Number(now); if (d <= 0) return 'due'; const [n, u] = STEPS.find(([n]) => d >= n) || [1, 'second']; const k = Math.round(d / n); return 'in ' + k + ' ' + u + (k === 1 ? '' : 's'); };

/** Where each allowance is used: { key: [{ role, target, selector, kind: 'param' | 'eth' | 'calls' }] }. */
export function uses(state) {
  const out = {};
  for (const r of Object.values(state.roles))
    for (const t of Object.values(r.targets))
      if (t.clearance === 2)
        for (const f of Object.values(t.functions))
          for (const n of f.conditions || [])
            if ([28, 29, 30].includes(n.operator)) (out[n.compValue] ||= []).push({ role: r.key, target: t.address, selector: f.selector, kind: n.operator === 28 ? 'param' : n.operator === 29 ? 'eth' : 'calls' });
  return out;
}

// A token's decimals and symbol, read from the contract (null when it does not answer like a token).
const tokens = new Map();
export function token(ctx, a) {
  if (!tokens.has(a)) tokens.set(a, (async () => {
    const call = (data) => ctx.request('eth_call', [{ to: a, data }, 'latest']);
    const d = await call('0x313ce567').then((r) => (/^0x[0-9a-f]{64}$/i.test(r) ? Number(BigInt(r)) : null), () => null);
    if (d == null || d > 36) return null;
    const s = await call('0x95d89b41').then((r) => {
      try { // string, else bytes32
        if (r.length > 130) { const len = Number(BigInt('0x' + r.slice(66, 130))); return new TextDecoder().decode(Uint8Array.from(r.slice(130, 130 + 2 * len).match(/../g) || [], (x) => parseInt(x, 16))); }
        return new TextDecoder().decode(Uint8Array.from(r.slice(2).match(/../g) || [], (x) => parseInt(x, 16))).replace(/\0+$/, '');
      } catch { return ''; }
    }, () => '');
    return { decimals: d, symbol: /^[\w .$-]{1,12}$/.test(s) ? s : '' };
  })());
  return tokens.get(a);
}
/**
 * The unit an allowance counts in, from what it is compared against: ETH for ETH sent, calls for a call count,
 * and for a parameter the target token's decimals when every use is on the same token. Otherwise base units.
 */
async function unitOf(ctx, list) {
  if (list.length && list.every((u) => u.kind === 'eth')) return { decimals: 18, symbol: 'ETH', why: 'ETH sent with the call' };
  if (list.length && list.every((u) => u.kind === 'calls')) return { decimals: 0, symbol: 'calls', why: 'a number of calls' };
  const targets = [...new Set(list.filter((u) => u.kind === 'param').map((u) => u.target))];
  if (targets.length === 1 && list.every((u) => u.kind === 'param')) {
    const t = await token(ctx, targets[0]);
    if (t) return { decimals: t.decimals, symbol: t.symbol || 'token units', why: 'a parameter of ' + (t.symbol || 'the token') + '’s functions, in its ' + t.decimals + ' decimals' };
  }
  return { decimals: 0, symbol: 'base units', why: null };
}
const amount = (v, u) => formatUnits(big(v), u.decimals) + ' ' + u.symbol;

/** The Allowances page: one card per allowance (and per key a condition uses but that was never set). */
/** The counts on the modifier's tabs (Roles · N, Members · N, Allowances · N), the same on every page under it. */
export const tabCounts = (state) => ({
  roles: Object.keys(state.roles).length,
  members: new Set(Object.values(state.roles).flatMap((r) => Object.keys(r.members).filter((m) => r.members[m]))).size,
  allowances: new Set([...Object.keys(state.allowances), ...Object.keys(uses(state))]).size,
});
export function allowancesView(ctx) {
  const ed = ctx.edit, all = uses(ctx.state), keys = [...new Set([...Object.keys(ctx.state.allowances), ...Object.keys(all)])];
  const add = ed && h('button.sm', { onclick: () => allowanceDialog(ctx) }, '+ New allowance');
  // With the modifier's tab row, the action and the counts go there; the page starts with what an allowance is.
  if (ctx.tabs) ctx.tabs.action(add), ctx.tabs.counts(tabCounts(ctx.state));
  const root = h('div.allowances', !ctx.tabs && h('div.rhead', h('h2', 'Allowances'), h('span.grow'), add),
    h('p.mut.small', 'A budget a role spends through its conditions: an amount of a parameter (Within allowance), ETH sent, or a number of calls. It refills by an amount every period, up to a cap.'));
  if (!keys.length) root.append(h('p.empty', 'No allowances yet.'));
  const now = BigInt(ctx.snapshot.timestamp);
  for (const key of keys) {
    const a = ctx.state.allowances[key], was = ctx.base?.allowances[key], list = all[key] || [];
    const m = ed && a && (!was ? 'new' : same(was, a) ? null : 'changed');
    const body = h('div.abody', h('p.mut.small', 'Reading…'));
    const card = h('section.tcard.acard' + (m ? '.pend' : ''), h('div.thead', h('div.tid', h('b.tname', keyName(key)), keyName(key) !== key ? null : h('span.mut.small', 'bytes32 key')),
      m && h('span.chip.draft', m === 'new' ? 'New' : 'Changed'), !a && h('span.chip.warn', 'Not set'),
      menu(() => [ed && [a ? 'Edit…' : 'Set…', () => allowanceDialog(ctx, key)], ['Copy key', () => toClipboard(key).catch(() => {})]], 'Allowance actions')), body,
      list.length > 0 && h('div.tfoot', h('span', h('span.mut.small', 'Used by '), ...[...new Set(list.map((u) => u.role))].map((r, i) => [i ? ', ' : '', h('a', { href: '#/' + ctx.address + '/role/' + r }, keyName(r))]), h('span.mut.small', ' · ' + [...new Set(list.map((u) => ({ param: 'a parameter', eth: 'ETH sent', calls: 'calls' })[u.kind]))].join(', ')))));
    root.append(card);
    if (!a) { put(body, warn('Conditions use this allowance, but it was never set, so they fail until it is.')); continue; }
    // A draft value is shown as drafted; otherwise the stored allowance, accrued to the displayed block.
    const current = m ? Promise.resolve(a) : read(ctx.request, ctx.address, 'allowances(bytes32 key)', ['uint128', 'uint128', 'uint64', 'uint128', 'uint64'], ctx.snapshot.number, [key]).then(([refill, maxRefill, period, balance, timestamp]) => ({ refill, maxRefill, period, balance, timestamp }));
    Promise.all([current, unitOf(ctx, list)]).then(([v, u]) => {
      const t = big(v.timestamp) || now, c = accrued({ ...v, timestamp: t }, now);
      put(body,
        h('p.abal', h('b', { title: c.balance + ' base units' }, amount(c.balance, u)), h('span.mut', ' available now')),
        h('p.aline', big(v.period) === 0n ? 'One-time: it does not refill.' : ['Refills ', h('b', amount(v.refill, u)), ' every ', h('b', duration(v.period)), big(v.maxRefill) < MAX ? [', never above ', h('b', amount(v.maxRefill, u))] : ', no cap', '. Next refill ', h('span', { title: when(c.next) }, until(c.next, now)), '.']),
        u.why && h('p.mut.small', 'Amounts in ' + u.symbol + ': this allowance counts ' + u.why + '. Hover an amount for its exact base units.'));
      card.current = { ...v, balance: c.balance, timestamp: c.timestamp }; card.unit = u;
    }, (e) => put(body, warn(e.message)));
    card.dataset.key = key;
  }
  return root;
}

/** New or edit: the budget in words (available now, refill every period, cap, start), stored exactly. */
export async function allowanceDialog(ctx, key) {
  const list = key ? uses(ctx.state)[key] || [] : [], u = await unitOf(ctx, list);
  let v = key && ctx.state.allowances[key];
  const was = key && ctx.base?.allowances[key];
  // An unchanged allowance edits from its stored value accrued to now (balance and last refill), as the contract would.
  if (v && same(was, v)) {
    const [refill, maxRefill, period, balance, timestamp] = await read(ctx.request, ctx.address, 'allowances(bytes32 key)', ['uint128', 'uint128', 'uint64', 'uint128', 'uint64'], ctx.snapshot.number, [key]);
    const c = accrued({ refill, maxRefill, period, balance, timestamp }, BigInt(ctx.snapshot.timestamp));
    v = { refill, maxRefill, period, balance: c.balance, timestamp: c.timestamp };
  }
  const { body, close } = sheet('edit', key ? 'Edit ' + keyName(key) : 'New allowance', true), out = h('div');
  const input = (attrs) => h('input', { spellcheck: 'false', autocomplete: 'off', ...attrs });
  const name = !key && input({ placeholder: 'weekly-usdc', 'aria-label': 'Name', maxlength: 66 });
  const units = h('select.unit', { 'aria-label': 'Unit' }, [[u.decimals, u.symbol === 'base units' ? 'Base units' : u.symbol + ' (' + u.decimals + ' decimals)'], u.decimals !== 0 && [0, 'Base units'], u.decimals !== 18 && [18, 'Ether (18 decimals)'], u.decimals !== 6 && [6, '×10⁶'], u.decimals !== 8 && [8, '×10⁸']].filter(Boolean).map(([x, t]) => h('option', { value: x }, t)));
  const shown = (x) => (x == null ? '' : formatUnits(big(x), u.decimals).replace(/,/g, ''));
  const fields = {};
  const money = (k, label, tip, value, placeholder) => {
    const el = input({ inputmode: 'decimal', placeholder, 'aria-label': label, value: shown(value) }), note = h('p.fhint');
    fields[k] = { el, note, get: () => (el.value.trim() === '' ? null : parseUnits(el.value, Number(units.value))) };
    return h('div.afield', infoLabel(label, tip), el, note);
  };
  const periodic = v ? big(v.period) > 0n : true;
  const kind = h('select', { 'aria-label': 'Refill' }, [['yes', 'Refills every period'], ['no', 'One-time, no refill']].map(([x, t]) => h('option', { value: x }, t)));
  kind.value = periodic ? 'yes' : 'no';
  const p = Number(v ? big(v.period) : 604800n) || 604800, [pn, pu] = STEPS.find(([n]) => p % n === 0);
  const every = input({ inputmode: 'numeric', 'aria-label': 'Every', value: String(p / pn) });
  const everyUnit = h('select', { 'aria-label': 'Period unit' }, STEPS.map(([n, t]) => h('option', { value: n }, t + 's')));
  everyUnit.value = String(pn);
  const ts = v ? big(v.timestamp) : 0n, local = (t) => { const d = new Date(Number(t) * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const start = input({ type: 'datetime-local', 'aria-label': 'Periods start', value: ts ? local(ts) : '' });
  const summary = h('p.asum'), save = h('button.primary', 'Add to pending changes');
  const refillBox = h('div.arefill',
    money('refill', 'Refill amount', 'Added to the balance at the end of every period. Unused budget carries over, up to the cap.', v && periodic ? v.refill : null, '1000'),
    h('div.afield', infoLabel('Every', 'How often the refill happens, counted from the start below.'), h('div.row', every, everyUnit)),
    money('maxRefill', 'Never above (cap)', 'A refill never raises the balance above this, so unused budget does not pile up. Leave it empty for no cap.', v && big(v.maxRefill) < MAX ? v.maxRefill : null, 'No cap'),
    h('details.adv', h('summary', 'Start of the periods'), h('div.afield', infoLabel('Periods start', 'The moment periods count from: the first refill is one period after it. Empty: when this change executes onchain.'), start)));
  const draw = () => {
    refillBox.hidden = kind.value === 'no';
    const unit = Number(units.value), sym = unit === u.decimals ? u.symbol : unit === 0 ? 'base units' : '';
    let ok = true;
    for (const f of Object.values(fields)) {
      try { const x = f.get(); put(f.note, x == null || unit === 0 ? '' : '= ' + x + ' base units'); if (x != null && x > MAX) throw Error('Too large for an allowance (uint128).'); }
      catch (e) { ok = false; put(f.note, h('span.bad', e.message)); }
    }
    if (!ok) return put(summary);
    const b = fields.balance.get() ?? 0n, r = fields.refill.get(), c = fields.maxRefill.get(), n = Number(every.value) || 0;
    const fmt = (x) => formatUnits(x, unit) + (sym ? ' ' + sym : '');
    put(summary, kind.value === 'no' ? ['Can spend ', h('b', fmt(b)), ' in total; it does not refill.']
      : ['Can spend ', h('b', fmt(b)), ' now; every ', h('b', n + ' ' + everyUnit.selectedOptions[0].text.replace(/s$/, n === 1 ? '' : 's')), ' it gets ', h('b', fmt(r ?? 0n)), ' more', c != null ? [', up to ', h('b', fmt(c))] : ', with no cap', '.']);
  };
  put(body,
    name && [infoLabel('Name', 'Conditions refer to an allowance by its key, a bytes32. A short name (up to 31 characters) becomes the key; you can also paste a 0x… key.'), name],
    h('div.afield', infoLabel('Unit', 'Allowances store whole base units (the smallest unit). Pick the unit you type in; the exact base units show under each amount.' + (u.why ? ' This one counts ' + u.why + '.' : '')), units),
    money('balance', 'Available now', 'What can be spent right now. Each use through this allowance subtracts from it; a use that would go below zero fails.', v ? v.balance : null, '1000'),
    h('div.afield', infoLabel('Refill', 'One-time budgets are spent once. Refilling budgets add an amount every period.'), kind),
    refillBox, summary,
    h('div.dfoot', h('span.grow'), h('button', { onclick: close }, 'Cancel'), save), out);
  save.onclick = act(save, async () => {
    const k = key || roleKey(name.value.trim());
    if (!key && ctx.state.allowances[k]) throw Error('An allowance with this name exists. Edit it instead.');
    const yes = kind.value === 'yes', n = BigInt(Number(every.value) || 0) * BigInt(everyUnit.value);
    if (yes && n <= 0n) throw Error('Enter how often it refills.');
    if (n > MAX64) throw Error('That period is too long.');
    const t = start.value ? BigInt(Math.floor(new Date(start.value).getTime() / 1000)) : 0n;
    const next = {
      allowanceKey: k, balance: fields.balance.get() ?? 0n,
      refill: yes ? fields.refill.get() ?? 0n : 0n, period: yes ? n : 0n,
      maxRefill: yes ? fields.maxRefill.get() ?? MAX : MAX, // the contract stores 0 as no cap; say so explicitly
      timestamp: start.value && ts && start.value === local(ts) ? ts : t,
    };
    if (yes && next.refill === 0n) throw Error('Enter the refill amount, or choose One-time.');
    if (!(v && same(v, next))) ctx.edit.set(k, next);
    close();
  }, out);
  for (const x of [units, kind, every, everyUnit, ...Object.values(fields).map((f) => f.el)]) x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', draw);
  draw();
  (name || fields.balance.el).focus();
}
