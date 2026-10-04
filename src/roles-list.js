// The modifier's Roles tab: every role at a glance (members, the targets it touches by name), and the same
// permissions turned around, by member: "what can this address do?". Search appears once the list is long.
import { h, put, short, menu, toClipboard } from './ui.js';
import { keyName } from './roles.js';
import { named, namesFor } from './role-view.js';
import * as labels from './labels.js';
import { token } from './allowances.js';

let view = 'roles'; // the open tab survives redraws
const SEARCH_FROM = 6;
const members = (r) => Object.entries(r.members).filter(([, yes]) => yes).map(([a]) => a);
const targets = (r) => Object.values(r.targets).filter((t) => t.clearance);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A target by name: your label, else its contract name (your ABI or Etherscan's), else its token symbol, else short. */
function targetName(ctx, a) {
  const el = h('span', labels.get(a) || short(a));
  if (!labels.get(a)) namesFor(ctx.chain, a).then(async (n) => { const t = n.name ? null : await token(ctx, a); if (n.name || t?.symbol) put(el, n.name || t.symbol); }, () => {});
  return el;
}

export function rolesPage(ctx) {
  const ed = ctx.edit, roles = Object.values(ctx.state.roles), content = h('div'), tabs = h('nav.tabs.rtabs');
  const who = {}; // member → the roles it is in
  for (const r of roles) for (const a of members(r)) (who[a] ||= []).push(r.key);
  const search = h('input.search', { placeholder: 'Search roles, members or targets', 'aria-label': 'Search', spellcheck: 'false', autocomplete: 'off' });
  const matches = (text) => text.toLowerCase().includes(search.value.trim().toLowerCase());

  const roleRow = (r) => {
    const was = ctx.base?.roles[r.key], m = ed && (!was ? 'new' : same(was, r) ? null : 'changed');
    const ts = targets(r), ms = members(r), shown = ts.slice(0, 3);
    return h('a.srow.rrow' + (m ? '.pend' : ''), { href: '#/' + ctx.address + '/role/' + r.key },
      h('div.rmain', h('b', keyName(r.key)), h('span.mut.small', ts.length ? [shown.map((t, i) => [i ? ', ' : '', targetName(ctx, t.address)]), ts.length > 3 ? ' +' + (ts.length - 3) : ''] : 'No targets')),
      m && h('span.chip.draft', m === 'new' ? 'New' : 'Changed'),
      h('span.chip', ms.length + ' member' + (ms.length === 1 ? '' : 's')), h('span.chip', ts.length + ' target' + (ts.length === 1 ? '' : 's')));
  };
  // A member: its roles (the default one marked), and in the editor its ⋯ (Edit roles…, Remove from all roles);
  // one the draft removes stays, struck, with Restore.
  const gone = ed && ctx.base ? [...new Set(Object.values(ctx.base.roles).flatMap(members))].filter((a) => !who[a]) : [];
  const memberRow = (a) => {
    const removed = !who[a], ks = removed ? Object.values(ctx.base.roles).filter((r) => r.members[a]).map((r) => r.key) : who[a];
    const before = ctx.base && Object.values(ctx.base.roles).filter((r) => r.members[a]).map((r) => r.key);
    const m = ed && (removed ? 'gone' : !before?.length ? 'new' : same(before, ks) && ctx.base.defaults[a] === ctx.state.defaults[a] ? null : 'changed');
    const rs = ks.map((k) => h('a.rolechip' + (ctx.state.defaults[a] === k ? '.def' : ''), { href: '#/' + ctx.address + '/role/' + k, title: ctx.state.defaults[a] === k ? 'Default role: used when a call names no role' : null }, keyName(k), ctx.state.defaults[a] === k && h('span', 'default')));
    return h('div.srow.mrow' + (m ? '.pend' : '') + (m === 'gone' ? '.gone' : ''), h('div.rmain', h('span', named(ctx.chain, a)), h('div.mroles', h('span.mut.small', ks.length === 1 ? 'Role' : 'Roles'), rs)),
      !removed && !ctx.state.enabled[a] && h('span.chip.warn', 'Disabled'), m && h('span.chip.draft', { new: 'New', changed: 'Changed', gone: 'Removed in draft' }[m]),
      ed && (removed ? h('button.link', { onclick: () => ed.restoreMember(a) }, 'Restore')
        : menu(() => [['Edit roles…', () => ed.memberRoles(a)], ['Copy address', () => toClipboard(a).catch(() => {})], ['Remove from all roles', () => ed.removeEverywhere(a), true]], 'Member actions')));
  };

  const draw = () => {
    const q = search.value.trim();
    if (view === 'members') {
      const list = [...Object.keys(who), ...gone].filter((a) => !q || matches(a) || matches(labels.get(a) || '') || (who[a] || []).some((k) => matches(keyName(k))));
      put(content, list.length ? h('div.slist', list.map(memberRow)) : h('p.empty', q ? 'No member matches.' : 'No members yet.' + (ed ? ' Choose + Add member to start.' : '')));
    } else {
      const list = roles.filter((r) => !q || matches(keyName(r.key)) || members(r).some((a) => matches(a) || matches(labels.get(a) || '')) || targets(r).some((t) => matches(t.address) || matches(labels.get(t.address) || '')));
      put(content, list.length ? h('div.slist', list.map(roleRow)) : h('p.empty', q ? 'No role matches.' : ctx.complete ? 'No roles yet.' + (ed ? ' Choose + New role to start.' : '') : 'No roles found in this part of the history.'));
    }
  };
  const action = (which) => ed && (which === 'members' ? h('button.sm', { onclick: () => ed.memberRoles() }, '+ Add member') : h('button.sm', { onclick: ed.newRole }, '+ New role'));
  const show = (which) => {
    view = which;
    // The modifier's tab row (Roles · Members · Allowances) shows the counts and the action; without it, a local one.
    if (ctx.tabs) ctx.tabs.counts({ roles: roles.length, members: Object.keys(who).length, allowances: Object.keys(ctx.state.allowances).length }), ctx.tabs.action(action(which));
    else put(tabs, [['roles', 'Roles · ' + roles.length], ['members', 'Members · ' + Object.keys(who).length]].map(([id, text]) => h('a' + (id === which ? '.on' : ''), { href: '#', onclick: (e) => (e.preventDefault(), show(id)) }, text)), h('span.grow'), action(which));
    draw();
  };
  search.oninput = draw;
  show(ctx.tabs ? (location.hash.split('?')[0].endsWith('/members') ? 'members' : 'roles') : view);
  return h('div.rolespage', roles.length + Object.keys(who).length > SEARCH_FROM && search, !ctx.tabs && tabs, content,
    ed && h('details.msettings', h('summary', 'Modifier settings'), h('div.actions', h('button', { onclick: ed.settings }, 'Owner, avatar and target'), h('button', { onclick: ed.unwrap }, 'Transaction unwrapper'))));
}
