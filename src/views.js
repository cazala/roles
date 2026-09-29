import { editBody, editorHooks } from './edit.js';
import { createView } from './create.js';
import { useRole } from './use.js';
import { editConditions } from './condition-edit.js';
import { conditionView, allowanceView } from './condition-view.js';
import { h, put, addr, bad, warn, act, short } from './ui.js';
import { session, route } from './app.js';
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
  const status = h('p.mut', 'Preparing history scan…'), content = h('div'), out = h('div');
  const start = h('input', { 'aria-label': 'History start block', placeholder: 'Auto-detect deployment block', inputmode: 'numeric' });
  const go = h('button', 'Scan / resume'), pause = h('button', 'Pause');
  let controller, scanning = false;
  const run = async () => {
    if (scanning) return; scanning = true; go.disabled = true; pause.disabled = false; controller = new AbortController(); put(out);
    try {
      // The scan saves its progress every few windows; keep going until it catches up or is paused.
      let result;
      do result = await scan(request, { address, chain, block: Number(BigInt(snapshot.number)), signal: controller.signal, start: start.value.trim() ? start.value.trim() : undefined, progress: p => put(status, 'Scanned to block ' + p.last + ' of ' + p.block + ' · ' + p.events + ' events') });
      while (!result.caughtUp && !controller.signal.aborted);
      const state = replay(result.logs);
      if (result.caughtUp && result.hash !== snapshot.hash) throw Error('Snapshot changed during scan. Refresh the page.');
      if (result.complete && ['owner', 'avatar', 'target'].some(k => state[k] !== meta[k])) throw Error('History does not match current contract metadata. Reset and rescan before editing.');
      const ctx = { address, chain, info, meta, state, request, snapshot, complete: result.complete, ownerSafe, refresh: route };
      put(status, (result.complete ? 'Complete history' : result.caughtUp ? 'Partial history — editing disabled' : 'Paused — resume scanning') + ' · blocks ' + result.start + '–' + result.last);
      put(content, body(ctx, path));
    } catch (e) { if (epoch === session.epoch) put(out, warn(e.message + ' If historical reads are unavailable, enter a start block. A partial scan stays read-only.')); }
    finally { scanning = false; go.disabled = false; pause.disabled = true; }
  };
  pause.onclick = () => controller?.abort(); go.onclick = run;
  root.append(status, h('div.actions', go, pause, h('button.link', { onclick: () => { controller?.abort(); clearScan(chain, address); put(content); put(status, 'Cache cleared. Scan again.'); } }, 'Reset cache')), h('details', h('summary', 'History options'), h('label', 'Start block (leave empty for complete history)'), start), out, content);
  run();
  return root;
}
