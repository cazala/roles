import { renderAddress, forget } from './views.js';
import { $, h, put, addr, short, icon, ICONS, sheet, bad, act, setResolver, friendlyError, copyButton, NS, iconButton, suggestInput } from './ui.js';
import { isAddr } from './abi.js';
import { use, rpc } from './rpc.js';
import { add, discover, list, remembered, remember } from './wallets.js';
import { connector, provider as wcProvider } from './wc.js';
import { qr, qrPath } from './qr.js';
import { addRpc, explorerKey, reader, removeRpc, rpcs, setExplorerKey, WC_RPC } from './reads.js';
import { nameOf, resolveName } from './names.js';
import { load, store } from './store.js';
import { labelsSheet, backupDialog } from './manage.js';
import { LINK, gateway, savedGateway, keepGateway } from './handoff.js';
import * as labels from './labels.js';

export const session = { provider: null, account: null, chain: null, epoch: 0 };
const main = $('main');
const network = n => ({ 1: 'Ethereum', 100: 'Gnosis', 137: 'Polygon', 10: 'Optimism', 8453: 'Base', 42161: 'Arbitrum' }[n] || 'Chain ' + n);

// ---- WalletConnect: an owner's wallet elsewhere (e.g. on a phone), connected by QR code ----
// roles.wei is the dapp: it shows a QR code, the wallet approves, and signing requests go to it. A phone wallet
// cannot serve reads, so those go to WalletConnect's RPC with the same project ID (src/net.js).
const WC_ID = typeof WC_PROJECT === 'string' ? WC_PROJECT : '';
const ownerConn = connector({ projectId: () => WC_ID, load: () => load('wcowner', null), save: (x) => store('wcowner', x), onEvent: (e) => ownerWallet.notify(e) });
const peerName = () => ownerConn.session()?.peer?.name || 'your wallet';
/** The QR code for a new connection; closing it cancels. Returns a function that hides it. */
function showPairing(c) {
  const { d, body, close } = sheet('phone', 'Connect with WalletConnect');
  let done = false;
  d.addEventListener('close', () => done || c.cancel());
  const g = qr(c.uri), n = g.length + 8, svg = document.createElementNS(NS, 'svg'), bg = document.createElementNS(NS, 'rect'), path = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ viewBox: '0 0 ' + n + ' ' + n, 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': 'WalletConnect QR code' })) svg.setAttribute(k, v);
  for (const [k, v] of Object.entries({ width: n, height: n, fill: '#fff' })) bg.setAttribute(k, v);
  path.setAttribute('d', qrPath(g));
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  put(body, h('p.mut', 'Scan this code with the wallet app on your phone, then approve the connection there.'), h('div.qrcode', svg), h('div.actions.qracts', copyButton('Copy link', c.uri), h('a.btn', { href: c.uri }, 'Open wallet app')), h('p.mut.small', 'On this device? “Open wallet app” hands the link to an installed wallet.'));
  return () => ((done = true), close());
}
/** While a request waits for the owner's wallet: say where to confirm it. */
function showAsking(method) {
  const { body, close } = sheet('phone', 'Confirm in ' + peerName());
  put(body, h('p.mut', (method === 'eth_sendTransaction' ? 'The transaction' : 'The signature request') + ' was sent to ' + peerName() + '. Open it on your phone to review and confirm; this closes when it answers.'));
  return close;
}
const ownerWallet = wcProvider(ownerConn, {
  rpcUrl: (id) => WC_RPC(id, WC_ID),
  chains: [1, 100, 137, 10, 8453, 42161],
  metadata: { name: 'roles.wei', description: 'Safe permissions (Zodiac Roles), served onchain', url: location.origin, icons: [] },
  pair: showPairing,
  asking: showAsking,
});
add({ key: 'walletconnect', get name() { const s = ownerConn.session(); return s?.peer?.name ? s.peer.name + ' (WalletConnect)' : 'WalletConnect'; }, provider: ownerWallet });
let saved = load('saved', []);
if (!Array.isArray(saved)) saved = [];
saved = saved.filter(x => x && isAddr(x.address) && Number.isSafeInteger(x.chain));
const save = () => store('saved', saved);
// The account button: the chain, subtly, and the account by its .wei / ENS name when it has one (reverse-
// resolved on Ethereum, forward-checked), else short.
const accountName = {}; // account → its name (or null), looked up once per session
function header() {
  const a = session.account;
  const who = () => [h('span.net', network(session.chain)), h('span.who', { title: a }, accountName[a] || short(a))];
  put($('connect'), a ? who() : 'Connect');
  if (a && session.chain === 1 && !(a in accountName)) nameOf(a, 1).then((n) => { accountName[a] = n; if (n && session.account === a) put($('connect'), who()); }, () => {});
}
async function connected(wallet) {
  const provider = wallet.provider;
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw Error('No account was connected.');
  if (session.provider?.removeListener) for (const event of ['accountsChanged', 'chainChanged']) session.provider.removeListener(event, changed);
  // The wallet signs; reads go through the reader (Settings: your RPCs, Etherscan; fallbacks).
  session.provider = reader(provider, { chain: () => session.chain, projectId: WC_ID }); use(session.provider);
  session.account = accounts[0].toLowerCase();
  session.chain = Number(await rpc('eth_chainId')); session.epoch++;
  remember(wallet.key);
  for (const event of ['accountsChanged', 'chainChanged']) provider.on?.(event, changed);
  header();
  await route();
}
async function changed() {
  session.epoch++;
  session.account = (await rpc('eth_accounts'))[0]?.toLowerCase() || null;
  session.chain = Number(await rpc('eth_chainId'));
  header(); route();
}
function disconnect() {
  // Ask the wallet to forget this site where supported (EIP-2255; WalletConnect deletes its session).
  session.provider?.request?.({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch?.(() => {});
  for (const event of ['accountsChanged', 'chainChanged']) session.provider?.removeListener?.(event, changed);
  use(null); session.provider = null; session.account = null; session.chain = null; session.epoch++;
  remember('none'); header(); route();
}
// Account popover under the header button, as in safe.wei: the account menu, or the wallet list.
const drop = $('drop');
const closeDrop = () => put(drop);
// pointerdown, not click: by the time a click bubbles up, the popover may have re-rendered.
document.addEventListener('pointerdown', (e) => !e.target.closest('.acct') && closeDrop());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrop());
function popover(view) {
  const err = h('div');
  const item = (label, fn) => h('button', { onclick: () => fn().catch((e) => put(err, h('p.bad', friendlyError(e)))) }, label);
  const a = session.account, current = session.provider?.wallet;
  if (view === 'menu') {
    // A WalletConnect wallet does not drive the chain here: switch among the chains it approved.
    const other = current === ownerWallet ? (ownerConn.session()?.chains || []).filter((c) => c !== session.chain) : [];
    const name = (list().find((w) => w.provider === current) || {}).name || 'Wallet';
    return put(drop, h('div.dropdown', h('div.head', h('div', h('b', name), h('div', accountName[a] ? accountName[a] + ' · ' + short(a) : short(a)), h('div', network(session.chain) + ' · chain ' + session.chain))),
      other.map((c) => item('Switch to ' + network(c), async () => (closeDrop(), await rpc('wallet_switchEthereumChain', [{ chainId: '0x' + c.toString(16) }])))),
      item('Switch wallet', async () => popover('pick')), item('Disconnect', async () => (closeDrop(), disconnect())), err));
  }
  const ws = list().filter((w) => !a || w.provider !== current);
  put(drop, h('div.dropdown', h('div.head', a && h('button.back', { onclick: () => popover('menu'), 'aria-label': 'Back' }, '‹'), a ? 'Switch wallet' : 'Connect a wallet'),
    ws.length ? ws.map((w) => item(w.name, async () => (await connected(w), closeDrop()))) : h('div.empty', a ? 'No other wallet found.' : 'No wallet found. Install or enable a browser wallet, or use WalletConnect.'), err));
}
function walletDialog() {
  if (drop.firstChild) return closeDrop();
  popover(session.account ? 'menu' : 'pick');
}
$('connect').onclick = walletDialog;

// ---- gates, as in safe.wei: an address opens at its URL, and the page says what it needs first (a wallet,
// another chain) instead of an error. `intent` marks a fresh click, so a single wallet is connected, or a
// certain chain switched, right away; a link opened on its own waits for a click.
let intent = false, skipChain = null;
const gateCard = (title, text, ...rest) => h('div.home.gate', h('div.panel.gatecard', h('span.mark', icon(...ICONS.people)), h('h2', title), text && h('p.mut', text), ...rest), h('p.gateback', h('a.back', { href: '#/' }, icon('m15 6-6 6 6 6'), 'Home')));
function connectView(what) {
  const ws = list(), out = h('div');
  const buttons = ws.map((w, i) => {
    const b = h('button' + (i ? '' : '.primary'), 'Connect ' + w.name);
    b.onclick = act(b, () => connected(w), out);
    return b;
  });
  if (intent && ws.length === 1) setTimeout(() => buttons[0].click());
  intent = false;
  return gateCard('Connect a wallet to open ' + what, 'roles.wei reads the chain through your wallet, and your wallet signs.', h('div.actions.gatebtns', buttons), out);
}
async function switchChain(id) {
  try {
    await rpc('wallet_switchEthereumChain', [{ chainId: '0x' + id.toString(16) }]);
  } catch (e) {
    if (e?.code === 4902 && session.provider?.wallet === ownerWallet) throw Error(peerName() + ' did not approve ' + network(id) + ' when it connected. Disconnect, then connect again and approve ' + network(id) + '.');
    throw Error(e?.code === 4902 ? 'Your wallet does not know ' + network(id) + '. Add it to your wallet first.' : e?.code === 4001 ? 'Switch cancelled.' : 'Your wallet could not switch to ' + network(id) + '. Switch it from the wallet.');
  }
  await changed();
}
/** The address is on another chain: offer the switch; right after a click it is asked at once, only when the chain is certain (`auto`). */
function switchView(id, title, text, extra, auto = true) {
  const out = h('div'), b = h('button.primary', 'Switch to ' + network(id));
  b.onclick = act(b, () => switchChain(id), out);
  if (intent && auto) setTimeout(() => b.click());
  intent = false;
  return gateCard(title, text, h('div.actions.gatebtns', b), out, extra);
}

/** Settings: RPC endpoints (reads go there instead of the wallet, per chain) and an Etherscan API key. */
export function settingsDialog() {
  const { body } = sheet('gear', 'Settings');
  const out = h('div'), list = h('div'), host = (u) => { try { return new URL(u).host; } catch { return u; } };
  const draw = () => {
    const m = Object.entries(rpcs());
    put(list, m.length ? h('div.slist.rpcs', m.map(([c, u]) => h('div.srow', h('b', network(Number(c))), h('code.sa', host(u)), h('span.grow'), h('button.link', { onclick: () => (removeRpc(c), draw(), (forget(), route())) }, 'Remove')))) : h('p.mut.small', 'None: reads go through your wallet.'));
  };
  const url = h('input', { placeholder: 'Endpoint URL (Alchemy, Infura, your node)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'RPC URL' }), add = h('button', 'Add');
  add.onclick = act(add, async () => { const c = await addRpc(url.value); url.value = ''; draw(); put(out, h('p.ok', 'Added for ' + network(c) + '.')); (forget(), route()); }, out);
  const key = h('input', { value: explorerKey(), placeholder: 'Etherscan API key', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Etherscan API key' }), saveKey = h('button', 'Save');
  saveKey.onclick = act(saveKey, async () => { setExplorerKey(key.value); put(out, h('p.ok', key.value.trim() ? 'Etherscan key saved.' : 'Etherscan key removed.')); (forget(), route()); }, out);
  // safe.wei's gateway, where Safe transactions are handed off and the footer links: one of the built-in ones
  // (config/links.json) or your own. The default follows this page's gateway, else the first; only a choice is saved.
  const gws = LINK.safe || [], cur = savedGateway(), gwOut = h('div');
  const pick = h('select', { 'aria-label': 'safe.wei gateway' }, gws.map((u) => h('option', { value: u }, new URL(u).host)), h('option', { value: '' }, 'Custom…'));
  const custom = h('input', { placeholder: 'https://your-gateway.example/', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Custom safe.wei gateway' });
  pick.value = gws.includes(cur) ? cur : ''; custom.value = gws.includes(cur) ? '' : cur; custom.hidden = gws.includes(cur);
  const choose = (v) => { try { const u = gateway(v); keepGateway(u); put(gwOut, h('p.ok', 'Safe transactions open in ' + new URL(u).host + '.')); foot(); } catch (e) { put(gwOut, bad(e.message)); } };
  pick.onchange = () => { custom.hidden = !!pick.value; if (pick.value) choose(pick.value); else custom.focus(); };
  custom.onchange = () => custom.value.trim() && choose(custom.value.trim());
  draw();
  put(
    body,
    h('div.bsec', h('b', 'safe.wei gateway')),
    h('p.mut.small', 'Where Safe transactions open for the owners to sign.'),
    h('div.gwpick', pick, custom), gwOut,
    h('div.bsec', h('b', 'RPC endpoints')),
    h('p.mut.small', 'Reads on an endpoint’s chain go there instead of your wallet’s RPC. Your wallet still signs.'),
    list,
    h('div.row', url, add),
    h('div.bsec', h('b', 'Etherscan API key'), h('span.mut.small', ' · optional, faster history')),
    h('p.mut.small', 'History loads from Etherscan in a few requests. Each event is checked against the chain, but Etherscan must return them all.'),
    h('div.row', key, saveKey),
    h('p.mut.small', 'All kept in this browser.'),
    out,
  );
}
setResolver(v => resolveName(v, session.chain));
export async function resolve(v) {
  return isAddr(v) ? v.toLowerCase() : resolveName(v.trim().toLowerCase(), session.chain);
}
// ---- home: your saved Safes and Roles modifiers under one field that searches them or opens a new one ----
const SEARCH = ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'], CARET = ['m6 9 6 6 6-6'];
const isRef = (v) => isAddr(v) || /^[^\s/?#]+\.(eth|wei)$/.test(v);
function openRef(v) {
  v = v.trim().toLowerCase();
  if (!isRef(v)) throw Error('Enter a 0x address or a name (name.eth, name.wei).');
  intent = true; location.hash = '/' + v;
}
/** + New (create a Roles modifier: for which Safe?), and ▾ for what you manage now and then. */
function moreMenu() {
  const n = Object.keys(labels.all()).length, m = h('div.hmenu', { hidden: true });
  const item = (ic, text, fn) => h('button', { onclick: () => ((m.hidden = true), fn()) }, icon(...ICONS[ic]), text);
  put(m, item('tag', n ? 'Labels (' + n + ')' : 'Labels', labelsSheet), item('sync', 'Backup & sync', () => backupDialog(null, reloadHome)), item('gear', 'Settings', settingsDialog));
  return h('div.split', h('button.splitmain', { onclick: newModifier, title: 'Create a Roles modifier for a Safe' }, icon(...ICONS.plus), h('span', 'New')),
    h('button.splitcaret', { title: 'More: labels, backup & sync, settings', 'aria-label': 'More', 'aria-haspopup': 'menu', onclick: () => (m.hidden = !m.hidden) }, icon(...CARET)), m);
}
document.addEventListener('pointerdown', (e) => document.querySelectorAll('.hmenu').forEach((m) => !m.parentElement.contains(e.target) && (m.hidden = true)));
/** A Roles modifier belongs to a Safe: pick it (your saved Safes and labels are suggested), then its page opens the wizard. */
function newModifier() {
  const { body, close } = sheet('plus', 'Create a Roles modifier'), out = h('div');
  const safe = h('input', { 'aria-label': 'Safe address', spellcheck: 'false', autocomplete: 'off' }), go = h('button.primary', 'Continue');
  go.onclick = act(go, async () => { const v = safe.value.trim().toLowerCase(); if (!isRef(v)) throw Error('Enter the Safe’s 0x address or name.'); close(); intent = true; location.hash = '/' + v + '?create'; }, out);
  // Enter continues, unless the suggestions used it to pick one (they handle it later in the same keypress).
  safe.onkeydown = (e) => { if (e.key === 'Enter') setTimeout(() => e.defaultPrevented || go.click()); }; // never return false here: that cancels every keystroke
  const known = saved.filter((x, i) => saved.findIndex((y) => y.address === x.address) === i).map((x) => [x.address, labels.get(x.address) || network(x.chain)]);
  put(body, h('p.mut.small', 'A Roles modifier gives roles permissions over a Safe’s assets. Which Safe is it for?'), h('label', 'Safe'), suggestInput(safe, () => known), h('div.dfoot', h('span.grow'), h('button', { onclick: close }, 'Cancel'), go), out);
  safe.focus();
}
const reloadHome = () => { saved = load('saved', []).filter((x) => x && isAddr(x.address) && Number.isSafeInteger(x.chain)); route(); };
function home() {
  put($('crumb'));
  if (!saved.length) {
    const input = h('input.search', { id: 'open-address', placeholder: 'Address 0x… or name.eth / name.wei', 'aria-label': 'Open an address', autocomplete: 'off', spellcheck: 'false' }), out = h('div'), open = h('button.primary', 'Open');
    open.onclick = act(open, async () => openRef(input.value), out);
    input.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(), open.click(); }; // never return false here: that cancels every keystroke
    const n = Object.keys(labels.all()).length;
    return put(main, h('div.home', h('div.hero', h('span.mark', icon(...ICONS.people)), h('h1', 'roles.wei'), h('p', 'Manage Safe permissions, straight from the chain.', h('br'), 'No servers, everything stays in your browser.')),
      h('div.panel', h('label', { for: 'open-address' }, 'Open a Safe or Roles modifier'), h('div.row', input, open), !session.account && h('p.fhint.connecthint', 'You’ll connect your wallet to open it.'), out,
        h('a.alt', { href: '#', onclick: (e) => (e.preventDefault(), newModifier()) }, h('span.mut', 'New to Roles?'), ' ', h('b', 'Create a modifier'), icon(...ICONS.next))),
      h('p.importhint', h('span.mut', 'Moving from another device? '), h('button.link', { onclick: () => backupDialog(null, reloadHome) }, 'Import a backup'), n > 0 && [h('span.mut', ' · '), h('button.link', { onclick: labelsSheet }, 'Labels (' + n + ')')], h('span.mut', ' · '), h('button.link', { onclick: settingsDialog }, 'Settings'))));
  }
  const q = h('input.search', { id: 'open-address', placeholder: 'Search, or open 0x… / name.eth', 'aria-label': 'Search or open an address', autocomplete: 'off', spellcheck: 'false' });
  const rows = h('div'), out = h('div'), openRow = h('div');
  // The network only where it tells you something: not on items of the connected chain.
  const showChain = (x) => (session.chain ? x.chain !== session.chain : new Set(saved.map((y) => y.chain)).size > 1);
  const row = (x) => {
    const title = labels.get(x.address) || short(x.address), name = h('b.name', title);
    const rename = () => {
      const inp = h('input.rename', { value: labels.get(x.address) || '', placeholder: 'Name this address', maxlength: 40 });
      const done = (keep) => (keep && labels.set(x.address, inp.value), draw());
      inp.onkeydown = (k) => (k.key === 'Enter' ? done(true) : k.key === 'Escape' ? done(false) : null);
      inp.onblur = () => done(true);
      inp.onclick = (k) => (k.preventDefault(), k.stopPropagation());
      name.replaceWith(inp); inp.focus(); inp.select();
    };
    const remove = () => { saved = saved.filter((y) => y !== x); save(); draw(); put(out, h('p.small', 'Removed ' + title + '. ', h('button.link', { onclick: () => { saved.push(x); save(); draw(); put(out); } }, 'Undo'))); };
    return h('a.srow' + (session.chain && x.chain !== session.chain ? '.other' : ''), { href: '#/' + x.address + '?chain=' + x.chain, onclick: () => (intent = true), title: session.chain && x.chain !== session.chain ? 'On ' + network(x.chain) : null },
      name, labels.get(x.address) && h('code.sa', short(x.address)), showChain(x) && h('span.chip', network(x.chain)), h('span.grow'),
      h('span.acts', iconButton('edit', 'Rename', rename), iconButton('close', 'Remove from this list', remove)), h('span.go', icon(...ICONS.next)));
  };
  const draw = () => {
    const s = q.value.trim(), lower = s.toLowerCase();
    const found = saved.filter((x) => (x.address + ' ' + (labels.get(x.address) || '')).toLowerCase().includes(lower));
    put(openRow, isRef(lower) && !found.some((x) => x.address === lower) ? h('div.slist.openlist', h('a.srow', { href: '#/' + lower, onclick: (e) => (e.preventDefault(), openRef(s)) }, h('span.mut', 'Open'), h('b.name', isAddr(lower) ? short(lower) : lower), h('span.grow'), h('span.go', icon(...ICONS.next)))) : null);
    put(rows, found.length ? h('div.slist', found.map(row)) : !isRef(lower) && h('p.empty', 'No saved address matches. Paste a 0x address or a .eth / .wei name to open one.'));
  };
  q.oninput = draw;
  q.onkeydown = (e) => {
    if (e.key === 'Escape') (q.value = ''), draw();
    if (e.key !== 'Enter') return;
    const first = (openRow.querySelector('a.srow') || (rows.querySelectorAll('a.srow').length === 1 && rows.querySelector('a.srow')));
    if (first) first.click();
  };
  put(main, h('div.home.returning', h('div.hbar', h('label.sfield', icon(...SEARCH), q), moreMenu()), !session.account && h('p.hnote', 'You’ll connect your wallet when you open one.'), out, openRow, rows));
  draw();
}
export async function route() {
  const epoch = ++session.epoch;
  put($('batch'));
  const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (/^#import=/.test(location.hash)) { const link = location.hash; history.replaceState(null, '', '#'); backupDialog(link, reloadHome); return home(); }
  if (!path[0]) return home();
  put($('crumb'));
  const ref = decodeURIComponent(path[0]), lower = ref.toLowerCase();
  const what = isAddr(ref) ? labels.get(lower) || short(lower) : lower;
  if (!session.account) return put(main, connectView(what));
  try {
    // The chain is certain when the link says it (?chain=, as saved addresses open). An address saved only on
    // another chain may exist here too: offer both, and switch only if asked.
    const sure = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('chain')) || null;
    const here = isAddr(ref) ? saved.filter((x) => x.address === lower) : [];
    const want = sure || (here.length && !here.some((x) => x.chain === session.chain) && skipChain !== lower ? here[0].chain : null);
    if (want && want !== session.chain) return put(main, switchView(want, what + ' is on ' + network(want), 'Your wallet is on ' + network(session.chain) + '.', !sure && h('p.gatealt', h('button.link', { onclick: () => ((skipChain = lower), route()) }, 'Open it on ' + network(session.chain) + ' anyway')), !!sure));
    if (!isAddr(ref) && session.chain !== 1) return put(main, switchView(1, ref + ' is a name on Ethereum', 'ENS and .wei names resolve on Ethereum, and your wallet is on ' + network(session.chain) + '. Switch to Ethereum, or open it by its 0x address.'));
    const address = await resolve(lower);
    put(main, h('p.mut', 'Reading the chain…'));
    const view = await renderAddress(address, path.slice(1), epoch);
    if (epoch !== session.epoch) return;
    if (!saved.some(x => x.address === address && x.chain === session.chain)) { saved.unshift({ address, chain: session.chain }); save(); }
    put($('crumb'), h('span.mut', '/'), h('a', { href: '#/' + address }, labels.get(address) || short(address)));
    put(main, view);
  } catch (e) { if (epoch === session.epoch) put(main, bad(friendlyError(e)), h('a', { href: '#/' }, 'Open another address')); }
}
addEventListener('hashchange', route);
discover(() => { header(); });
const foot = () => put($('foot'), h('span.mut', 'roles.wei · build ' + __BUILD__), h('span.mut', ' · ', h('a', { href: savedGateway(), target: '_blank', rel: 'noopener', title: 'Your Safe, served onchain' }, 'safe.wei')), LINK.source && h('span.mut', ' · ', h('a', { href: LINK.source, target: '_blank', rel: 'noopener' }, 'source')));
foot();
header(); route();
if (remembered() === 'walletconnect') ownerConn.restore().catch(() => {});
const known = list().find(w => w.key === remembered());
if (known && remembered() !== 'none') known.provider.request({ method: 'eth_accounts' }).then(a => { if (a.length) connected(known).catch(() => {}); });
