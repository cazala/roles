import { editBody, editorHooks } from './edit.js';
import { createView } from './create.js';
import { useRole } from './use.js';
import { editConditions } from './condition-edit.js';
import { conditionView, allowanceView } from './condition-view.js';
import { h, put, addr, bad, warn, act, short, icon } from './ui.js';
import { session, route, settingsDialog } from './app.js';
import { explorerKey } from './reads.js';
import { identify, metadata, safeModules, replay, keyName, json, quantity } from './roles.js';
import { scan, clearScan } from './scan.js';

export const hooks = { conditions: conditionView, allowances: allowanceView, body: editBody, create: createView };
editorHooks.use = useRole;
editorHooks.conditions = editConditions;
export const tabbar = (address, active) => h('nav.tabs', ['roles', 'allowances'].map(name => h('a' + (name === active ? '.on' : ''), { href: '#/' + address + (name === 'roles' ? '' : '/' + name) }, name[0].toUpperCase() + name.slice(1))));
const options = n => ['CALL, no ETH', 'CALL with ETH', 'CALL or DELEGATECALL, no ETH', 'CALL or DELEGATECALL with ETH'][n];
export function roleView(ctx, key) {
  const role = ctx.state.roles[key];
  if (!role) return h('p.mut', 'No role with this key was found in the scanned history.');
  return h('div', h('h2', keyName(key)), h('details', h('summary', 'Role key'), h('code', key)),
    h('h3', 'Members'), Object.entries(role.members).filter(([, yes]) => yes).length ? h('div.slist', Object.entries(role.members).filter(([, yes]) => yes).map(([address]) => h('div.srow', addr(address), !ctx.state.enabled[address] && h('span.chip.warn', 'Disabled'), ctx.state.defaults[address] === key && h('span.chip', 'Default role')))) : h('p.empty', 'No members assigned.'),
    h('h3', 'Targets and functions'), Object.values(role.targets).length ? Object.values(role.targets).map(t => h('section.panel', addr(t.address), h('p.mut', ['Revoked — stored functions are dormant', 'All functions allowed', 'Only configured functions'][t.clearance] + ' · ' + options(t.options)),
      Object.values(t.functions).length ? Object.values(t.functions).map(f => h('details', h('summary', f.selector + ' · ' + options(f.options)), t.clearance !== 2 && h('p.warn', 'This function entry is dormant under the current target clearance.'), f.conditions ? (hooks.conditions ? hooks.conditions(f.conditions) : h('pre', json(f.conditions))) : h('p', 'Any parameters allowed.'))) : t.clearance === 2 && h('p.empty', 'No functions configured for this target.'))) : h('p.empty', 'No targets configured for this role.'));
}
export function body(ctx, path) {
  if (hooks.body) { const custom = hooks.body(ctx, path); if (custom) return custom; }
  if (path[0] === 'role') return roleView(ctx, path[1]);
  if (path[0] === 'allowances') return hooks.allowances ? hooks.allowances(ctx) : h('div', h('h2', 'Allowances'), Object.keys(ctx.state.allowances).length ? h('pre', json(ctx.state.allowances)) : h('p.mut', 'No allowances in the scanned history.'));
  const roles = Object.values(ctx.state.roles);
  return h('div', h('h2', 'Roles'), roles.length ? h('div.slist', roles.map(r => h('a.srow', { href: '#/' + ctx.address + '/role/' + r.key }, h('b.name', keyName(r.key)), h('span.mut', Object.values(r.members).filter(Boolean).length + ' members · ' + Object.values(r.targets).filter(t => t.clearance).length + ' targets')))) : h('p.empty', ctx.complete ? 'No roles configured yet.' : 'No roles found in this part of the history.'));
}
export async function renderAddress(address, path, epoch) {
  const provider = session.provider, chain = session.chain;
  const request = async (method, params = []) => { if (epoch !== session.epoch) throw Error('Wallet or page changed.'); const value = await provider.request({ method, params }); if (epoch !== session.epoch) throw Error('Wallet or page changed.'); return value; };
  Object.defineProperty(request, 'wide', { get: () => !!provider.wide }); // Etherscan in use: whole log ranges at once
  const snapshot = await request('eth_getBlockByNumber', ['latest', false]);
  const info = await identify(request, address, snapshot.number);
  if (info.code === '0x') throw Error('No contract at this address on the connected chain.');
  if (!info.version) {
    const safe = await safeModules(request, address, snapshot.number);
    const modules = await Promise.all(safe.modules.map(async m => {
      const item = await identify(request, m, snapshot.number);
      const meta = item.version ? await metadata(request, m, snapshot.number) : null;
      return h('div', h('div.srow', item.version ? h('a.name', { href: '#/' + m }, 'Roles ' + item.version) : h('b', 'Other module'), addr(m)), item.faulty && warn('This Roles version is faulty. Do not grant new permissions.'), meta && h('div.modulemeta', h('p', 'Owner ', addr(meta.owner)), meta.owner !== address && warn('This owner can change every permission and control the Safe’s assets.'), (meta.avatar !== address || meta.target !== address) && warn('Avatar or target differs from this Safe.'), h('p', 'Avatar ', addr(meta.avatar), ' · Target ', addr(meta.target))));
    }));
    return h('div', h('h1', 'Roles modifiers'), addr(address), h('p.mut', 'Safe ' + safe.version + ' · ' + safe.threshold + ' of ' + safe.owners.length + ' owners'), hooks.create && hooks.create({ address, safe, request, snapshot, chain }), modules.length ? h('div.slist', modules) : h('p.empty', 'No modules enabled on this Safe.'));
  }
  const meta = await metadata(request, address, snapshot.number);
  let ownerSafe=false;
  if(meta.owner!==session.account)try{await safeModules(request,meta.owner,snapshot.number);ownerSafe=true;}catch{}
  const ownerSupported=meta.owner===session.account||ownerSafe;
  const root = h('div', h('h1', 'Roles ' + info.version), addr(address), h('p', 'Owner ', addr(meta.owner), ' · Avatar ', addr(meta.avatar), ' · Target ', addr(meta.target)), meta.owner !== meta.avatar && warn('The owner differs from the avatar. This owner can grant itself access to the avatar’s assets.'), !ownerSupported&&warn('This owner is neither the connected wallet nor a readable Safe. You can inspect permissions and prepare calls, but roles.wei cannot submit them for this owner.'), info.faulty && warn('This Roles version is faulty. Permission changes are disabled.'));
  if (!info.supported) { root.append(h('p.mut', 'This implementation is identified but is not supported for permission decoding or editing.'), h('details', h('summary', 'Implementation'), addr(info.implementation), h('pre', info.code))); return root; }
  root.append(tabbar(address, path[0] === 'allowances' ? 'allowances' : 'roles'));
  // One status under the actions: progress while scanning, the result when done, or what went wrong.
  // The history as a sync indicator: status first, one action for the current state, the rare options under ⋯.
  const content = h('div'), icn = h('span.sicon'), text = h('div.stext'), action = h('div.sact'), fill = h('span'), hint = h('div.shint');
  const menu = h('div.dropdown', { hidden: true }), more = h('button.ib', { title: 'History options', 'aria-label': 'History options', onclick: () => (menu.hidden = !menu.hidden) }, icon('M5 12h.01', 'M12 12h.01', 'M19 12h.01'));
  const bar = h('div.sync', h('div.sline', icn, text, action, h('div.smore', more, menu)), h('div.meter', fill), hint);
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
  // While a scan runs block by block, point to the fast path: an Etherscan key loads it in a few requests.
  const tip = () => !explorerKey() && !request.wide && [h('a.hint', { href: '#', title: 'An Etherscan API key loads the history in a few requests instead of scanning block by block', onclick: (e) => (e.preventDefault(), settingsDialog()) }, 'Add an Etherscan key'), ' to load instantly'];
  const start = h('input', { 'aria-label': 'Start block', placeholder: 'Deployment block (automatic)', inputmode: 'numeric' });
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
      const ctx = { address, chain, info, meta, state, request, snapshot, complete: result.complete, ownerSafe, refresh: route };
      const span = ' · blocks ' + num(result.start) + ' – ' + num(result.last) + (provider.source ? ' · read through ' + provider.source : '');
      if (result.complete) show('done', 'Complete history' + span, button('Refresh', () => route()));
      else show('partial', 'Partial history, from a start block you chose · editing disabled' + span, button('Refresh', () => route()));
      put(content, body(ctx, path));
    } catch (e) {
      if (epoch !== session.epoch || controller !== mine) return;
      if (mine.signal.aborted) show('paused', 'Paused' + (last != null ? ' at ' + last + '%' : ''), button('Resume', run));
      // The RPC advice only where an RPC is the problem.
      // RPC trouble: offer the ways around it right there (your RPC, or Etherscan's index).
      else {
        const rpc = /stopped at block|could not be reached|rpc|history|pruned|archive|answered/i.test(e.message);
        // Details: the stack and the build, so an unexpected error can be traced to its line.
        const details = h('details.edetail', h('summary', 'Details'), h('pre', 'build ' + __BUILD__ + '\n' + (e.stack || e.message)));
        show('error', e.message.replace(/\.?$/, '.'), button('Retry', run), null, [rpc && h('span.fixes', 'Get around it: ', h('a.hint', { href: '#', onclick: (x) => (x.preventDefault(), settingsDialog()) }, 'Add your own RPC'), ' or ', h('a.hint', { href: '#', onclick: (x) => (x.preventDefault(), settingsDialog()) }, 'an Etherscan key'), '.'), details]);
      }
    }
    finally { if (controller === mine) scanning = false; }
  };
  const restart = () => { controller?.abort(); clearScan(chain, address); put(content); scanning = false; run(); };
  put(menu,
    h('label', 'Start from block'), h('div.row', start, button('Apply', restart)), h('p.mut.small', 'Leave empty for the complete history. A later start is read-only.'),
    h('button.link.sclear', { onclick: restart }, 'Clear cached history and scan again'));
  const closeMenu = (e) => (bar.isConnected ? !bar.querySelector('.smore').contains(e.target) && (menu.hidden = true) : removeEventListener('pointerdown', closeMenu));
  addEventListener('pointerdown', closeMenu); // a tap anywhere else closes the menu
  root.append(bar, content);
  run();
  return root;
}
