import { editBody, editorHooks } from './edit.js';
import { createView } from './create.js';
import { useRole } from './use.js';
import { editConditions } from './condition-edit.js';
import { conditionView } from './condition-view.js';
import { allowancesView } from './allowances.js';
import { rolesPage } from './roles-list.js';
import { h, put, addr, bad, warn, act, short, icon, tagButton } from './ui.js';
import { session, route, settingsDialog } from './app.js';
import { explorerRefused, explorerSuggestion } from './reads.js';
import { identify, metadata, safeModules, replay, keyName, json, quantity } from './roles.js';
import { scan, clearScan } from './scan.js';
import { nameOf } from './names.js';
import * as labels from './labels.js';

/**
 * A page's title, as safe.wei titles a Safe: your label, else its ENS / WNS name (looked up), else `kind` and the
 * short address. Kept current when you label it. What it is (version, owners) goes on the line under it.
 */
function titleOf(address, kind) {
  const el = h('h1.ptitle');
  let name = '';
  const draw = () => put(el, labels.get(address) || name || kind + ' ' + short(address));
  draw();
  nameOf(address, session.chain).then((n) => n && ((name = n), el.isConnected && draw()), () => {});
  const on = (e) => (el.isConnected ? String(e.detail).toLowerCase() === address && draw() : removeEventListener('labels', on));
  addEventListener('labels', on);
  return el;
}

export const hooks = { conditions: conditionView, allowances: allowancesView, body: editBody, create: createView };
editorHooks.use = useRole;
editorHooks.conditions = editConditions;
// One row of tabs for a modifier: Roles · Members · Allowances, their counts (set by the page once it has the state)
// and, on the right, the open tab's action (+ New role, + Add member, + New allowance).
export const tabbar = (address, active) => {
  const names = ['roles', 'members', 'allowances'], slot = h('span.tact');
  const links = names.map((name) => h('a' + (name === active ? '.on' : ''), { href: '#/' + address + (name === 'roles' ? '' : '/' + name), 'data-tab': name }, name[0].toUpperCase() + name.slice(1)));
  const el = h('nav.tabs.mtabs', links, h('span.grow'), slot);
  el.counts = (c) => links.forEach((a, i) => c[names[i]] != null && put(a, names[i][0].toUpperCase() + names[i].slice(1) + ' · ' + c[names[i]]));
  el.action = (node) => put(slot, node);
  return el;
};
const options = n => ['CALL, no ETH', 'CALL with ETH', 'CALL or DELEGATECALL, no ETH', 'CALL or DELEGATECALL with ETH'][n];
export { roleView } from './role-view.js';
export function body(ctx, path) {
  if (hooks.body) { const custom = hooks.body(ctx, path); if (custom) return custom; }
  // A #draft= link needs the complete history (it loads into the editor), which a read-only page does not have.
  const proposed = /[?&]draft=/.test(location.hash) && warn('This link proposes permission changes, but they load only on a complete history (this one starts at a block you chose, or the version is not editable). Nothing was changed.');
  if (path[0] === 'role') return h('div', proposed, roleView(ctx, path[1]));
  if (path[0] === 'allowances') return hooks.allowances ? hooks.allowances(ctx) : h('div', h('h2', 'Allowances'), Object.keys(ctx.state.allowances).length ? h('pre', json(ctx.state.allowances)) : h('p.mut', 'No allowances in the scanned history.'));
  return h('div', proposed, rolesPage(ctx));
}
// A Roles modifier read in this session, by chain, address and account: moving between its pages (roles, a
// role, allowances) renders from memory. Refresh, Apply, a Settings change or another wallet, account or chain
// reads it again.
const loaded = new Map();
export const forget = () => loaded.clear();
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
export async function renderAddress(address, path, epoch) {
  const provider = session.provider, chain = session.chain;
  const request = async (method, params = []) => { if (epoch !== session.epoch) throw Error('Wallet or page changed.'); const value = await provider.request({ method, params }); if (epoch !== session.epoch) throw Error('Wallet or page changed.'); return value; };
  Object.defineProperty(request, 'wide', { get: () => !!provider.wide }); // a block explorer in use: whole log ranges at once
  const k = chain + ':' + address + ':' + session.account, hit = loaded.get(k);
  const refresh = () => { loaded.delete(k); route(); };
  const snapshot = hit ? hit.snapshot : await request('eth_getBlockByNumber', ['latest', false]);
  const info = hit ? hit.info : await identify(request, address, snapshot.number);
  if (info.code === '0x') throw Error('No contract at this address on the connected chain.');
  if (!info.version) {
    const safe = await safeModules(request, address, snapshot.number);
    const modules = await Promise.all(safe.modules.map(async m => {
      const item = await identify(request, m, snapshot.number);
      const meta = item.version ? await metadata(request, m, snapshot.number) : null;
      const card = h(item.version ? 'div.smod.open' : 'div.smod', h('div.srow', item.version ? h('a.name', { href: '#/' + m }, 'Roles ' + item.version) : h('b', 'Other module'), addr(m)), item.faulty && warn('This Roles version is faulty. Do not grant new permissions.'), meta && h('div.modulemeta', h('p', 'Owner ', addr(meta.owner)), meta.owner !== address && warn('This owner can change every permission and control the Safe’s assets.'), (meta.avatar !== address || meta.target !== address) && warn('Avatar or target differs from this Safe.'), h('p', 'Avatar ', addr(meta.avatar), ' · Target ', addr(meta.target))));
      // The whole card opens the modifier; its own links and buttons (copy, label, explorer) keep their action.
      if (item.version) card.addEventListener('click', (e) => { if (!e.target.closest('a, button') && !String(getSelection())) location.hash = '#/' + m; });
      return Object.assign(card, { working: !!item.version && !item.faulty });
    }));
    // A Safe with a working Roles modifier needs no Create card: another one is a quiet link under the list.
    const create = hooks.create ? hooks.create({ address, safe, request, snapshot, chain, start: /[?&]create\b/.test(location.hash), has: modules.some((c) => c.working) }) : {};
    return Object.assign(h('div', titleOf(address, 'Safe'), h('p.mut.pmeta', h('span.paddr', addr(address, null, short(address), true), tagButton(address)), h('span', 'Safe ' + safe.version + ' · ' + safe.threshold + ' of ' + safe.owners.length + ' owners')), create.top, h('h2.psec', 'Modules'), modules.length ? h('div.slist', modules) : h('p.empty', 'No modules enabled on this Safe.'), create.foot), { kind: 'safe', facts: { threshold: Number(safe.threshold), owners: safe.owners.length } }); // what Home and the Safe picker list it as
  }
  const meta = hit ? hit.meta : await metadata(request, address, snapshot.number);
  let ownerSafe = hit ? hit.ownerSafe : false;
  if(!hit&&meta.owner!==session.account)try{await safeModules(request,meta.owner,snapshot.number);ownerSafe=true;}catch{}
  const ownerSupported=meta.owner===session.account||ownerSafe;
  const root = h('div', titleOf(address, 'Roles modifier'), h('p.mut.pmeta', h('span.paddr', addr(address, null, short(address), true), tagButton(address)), h('span', 'Roles ' + info.version)), h('p', 'Owner ', addr(meta.owner), ' · Avatar ', addr(meta.avatar), ' · Target ', addr(meta.target)), meta.owner !== meta.avatar && warn('The owner differs from the avatar. This owner can grant itself access to the avatar’s assets.'), !ownerSupported&&warn('This owner is neither the connected wallet nor a readable Safe. You can inspect permissions and prepare calls, but roles.wei cannot submit them for this owner.'), info.faulty && warn('This Roles version is faulty. Permission changes are disabled.'));
  root.kind = 'roles';
  root.facts = { avatar: meta.avatar.toLowerCase(), version: info.version }; // Home nests it under its Safe
  if (!info.supported) { root.append(h('p.mut', 'This implementation is identified but is not supported for permission decoding or editing.'), h('details', h('summary', 'Implementation'), addr(info.implementation), h('pre', info.code))); return root; }
  // The tabs sit right above what they switch: the history status, a link's proposal and the pending changes
  // concern the whole modifier and come first (`top`, which the editor fills).
  const tabs = tabbar(address, ['allowances', 'members'].includes(path[0]) ? path[0] : 'roles'), top = h('div.mtop');
  // One status under the actions: progress while scanning, the result when done, or what went wrong.
  // The history as a sync indicator: status first, one action for the current state, the rare options under ⋯.
  const content = h('div'), icn = h('span.sicon'), text = h('div.stext'), action = h('div.sact'), fill = h('span'), hint = h('div.shint');
  const menu = h('div.dropdown', { hidden: true }), more = h('button.ib', { title: 'History options', 'aria-label': 'History options', onclick: () => (menu.hidden = !menu.hidden) }, icon('M5 12h.01', 'M12 12h.01', 'M19 12h.01'));
  const bar = h('div.sync', h('div.sline', icn, text, h('div.sctl', action, h('div.smore', more, menu))), h('div.meter', fill), hint);
  const num = (n) => Number(n).toLocaleString('en-US');
  const button = (label, fn) => h('button', { onclick: fn }, label);
  /** One state: kind (busy / done / paused / error / partial), text, action, progress 0–100 or null, hint. */
  const show = (kind, words, act, pct = null, tip = null) => {
    bar.className = 'sync ' + kind;
    put(icn, kind === 'busy' ? h('span.spin') : icon(...(kind === 'done' ? ['m5 12 5 5 9-10'] : kind === 'error' ? ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'] : ['M9 6v12', 'M15 6v12'])));
    put(text, words);
    put(action, act);
    bar.classList.toggle('metered', pct != null);
    fill.style.width = (pct || 0) + '%';
    put(hint, tip);
  };
  // While a scan runs block by block, point to the fast path (a block explorer's index loads it in a few requests),
  // or say why the explorer is not in use (it does not cover this chain, or is busy).
  const tip = () => {
    if (request.wide) return null;
    const no = explorerRefused(chain), x = explorerSuggestion(chain);
    if (no) return no.name + (no.busy ? ' is busy right now' : ' doesn’t cover this chain') + ', so this reads the blocks through your RPC.';
    return ['Slow? ', h('a.hint', { href: '#', onclick: (e) => (e.preventDefault(), settingsDialog()) }, 'Use ' + (x ? x + '’s' : 'a block explorer’s') + ' index'), ' to load the whole history in seconds. Every event is still checked against the chain.'];
  };
  const start = h('input', { 'aria-label': 'Start block', placeholder: 'Automatic', inputmode: 'numeric' });
  let controller, scanning = false, last = null;
  const run = async () => {
    if (scanning) return; scanning = true; menu.hidden = true;
    const mine = (controller = new AbortController()); // a newer run (Apply, Clear) takes over the bar
    const pause = button('Pause', () => mine.abort());
    // Progress: share of blocks done, events, and a time estimate from this run's own pace (after a few seconds).
    let t0 = 0, b0 = 0;
    const progress = (p) => {
      const now = Date.now();
      if (!t0) (t0 = now), (b0 = p.last);
      const pct = p.block > p.start ? Math.floor((100 * (p.last - p.start + 1)) / (p.block - p.start + 1)) : 100;
      const rate = (p.last - b0) / (now - t0), left = rate > 0 ? (p.block - p.last) / rate : 0;
      const eta = now - t0 < 3000 || !(rate > 0) ? '' : left < 60000 ? ' · < 1 min left' : left < 3600000 ? ' · ~' + Math.round(left / 60000) + ' min left' : ' · ~' + Math.round(left / 3600000) + ' h left';
      if (controller !== mine) return;
      last = pct;
      show('busy', 'Scanning history · ' + pct + '% · ' + p.events + ' event' + (p.events === 1 ? '' : 's') + eta, pause, pct, p.last < p.block && tip());
    };
    show('busy', 'Finding where this modifier’s history starts…', pause, 0, tip());
    try {
      // The scan saves its progress every few windows; keep going until it catches up or is paused.
      let result;
      do result = await scan(request, { address, chain, block: Number(BigInt(snapshot.number)), signal: controller.signal, start: start.value.trim() ? start.value.trim() : undefined, progress });
      while (!result.caughtUp && !controller.signal.aborted);
      const state = replay(result.logs);
      if (result.caughtUp && result.hash !== snapshot.hash) throw Error('Snapshot changed during scan. Refresh the page.');
      if (result.complete && ['owner', 'avatar', 'target'].some(k => state[k] !== meta[k])) throw Error('History does not match current contract metadata. Clear the cached history and scan again before editing.');
      const ctx = { address, chain, info, meta, state, request, snapshot, complete: result.complete, ownerSafe, refresh, top, tabs };
      const span = ' · blocks ' + num(result.start) + ' – ' + num(result.last) + (provider.source ? ' · read through ' + provider.source : '');
      const kind = result.complete ? 'done' : 'partial', words = (result.complete ? 'Complete history' : 'Partial history, from a start block you chose · editing disabled') + span;
      show(kind, words, button('Refresh', refresh));
      loaded.set(k, { snapshot, info, meta, ownerSafe, state, complete: result.complete, kind, words, at: Date.now() });
      put(content, body(ctx, path));
    } catch (e) {
      if (epoch !== session.epoch || controller !== mine) return;
      if (mine.signal.aborted) show('paused', 'Paused' + (last != null ? ' at ' + last + '%' : ''), button('Resume', run));
      // The RPC advice only where an RPC is the problem.
      // RPC trouble: offer the ways around it right there (your RPC, or a block explorer's index).
      else {
        const rpc = /stopped at block|could not be reached|rpc|history|pruned|archive|answered/i.test(e.message);
        // Details: the stack and the build, so an unexpected error can be traced to its line.
        const details = h('details.edetail', h('summary', 'Details'), h('pre', 'build ' + __BUILD__ + '\n' + (e.stack || e.message)));
        show('error', e.message.replace(/\.?$/, '.'), button('Retry', run), null, [rpc && h('span.fixes', 'Get around it: ', h('a.hint', { href: '#', onclick: (x) => (x.preventDefault(), settingsDialog()) }, 'Add your own RPC'), ' or ', h('a.hint', { href: '#', onclick: (x) => (x.preventDefault(), settingsDialog()) }, 'a block explorer'), '.'), details]);
      }
    }
    finally { if (controller === mine) scanning = false; }
  };
  const restart = () => { controller?.abort(); loaded.delete(k); clearScan(chain, address); put(content); scanning = false; run(); };
  put(menu,
    h('label', 'Start from block'), h('div.row', start, button('Apply', restart)), h('p.mut.small', 'Leave empty for the complete history. A later start is read-only.'),
    h('hr'), h('button.sclear', { onclick: restart }, 'Clear cached history and scan again'));
  const closeMenu = (e) => (bar.isConnected ? !bar.querySelector('.smore').contains(e.target) && (menu.hidden = true) : removeEventListener('pointerdown', closeMenu));
  addEventListener('pointerdown', closeMenu); // a tap anywhere else closes the menu
  root.append(bar, top, tabs, content);
  if (hit) {
    show(hit.kind, hit.words + ' · read ' + ago(hit.at), button('Refresh', refresh));
    put(content, body({ address, chain, info, meta, state: hit.state, request, snapshot, complete: hit.complete, ownerSafe, refresh, top, tabs }, path));
  } else run();
  return root;
}
