import { renderAddress } from './views.js';
import { $, h, put, addr, short, icon, ICONS, sheet, bad, act, setResolver, friendlyError, copyButton, NS } from './ui.js';
import { isAddr } from './abi.js';
import { use, rpc } from './rpc.js';
import { add, discover, list, remembered, remember } from './wallets.js';
import { connector, provider as wcProvider } from './wc.js';
import { qr, qrPath } from './qr.js';
import { addRpc, explorerKey, reader, removeRpc, rpcs, setExplorerKey, WC_RPC } from './reads.js';
import { nameOf, resolveName } from './names.js';
import { load, store } from './store.js';
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
    put(list, m.length ? h('div.slist.rpcs', m.map(([c, u]) => h('div.srow', h('b', network(Number(c))), h('code.sa', host(u)), h('span.grow'), h('button.link', { onclick: () => (removeRpc(c), draw(), route()) }, 'Remove')))) : h('p.mut.small', 'None: reads go through your wallet.'));
  };
  const url = h('input', { placeholder: 'https://… (Alchemy, Infura, your node)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'RPC URL' }), add = h('button', 'Add');
  add.onclick = act(add, async () => { const c = await addRpc(url.value); url.value = ''; draw(); put(out, h('p.ok', 'Added for ' + network(c) + '.')); route(); }, out);
  const key = h('input', { value: explorerKey(), placeholder: 'Etherscan API key', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Etherscan API key' }), saveKey = h('button', 'Save');
  saveKey.onclick = act(saveKey, async () => { setExplorerKey(key.value); put(out, h('p.ok', key.value.trim() ? 'Etherscan key saved.' : 'Etherscan key removed.')); route(); }, out);
  draw();
  put(
    body,
    h('p.wsec', 'RPC endpoints'),
    h('p.mut.small', 'roles.wei reads through your wallet. Add an RPC endpoint and every read on its chain goes there instead: faster, and it works where your wallet’s RPC dropped old history. The chain is detected from the endpoint. Signing always stays in your wallet.'),
    list,
    h('div.row', url, add),
    h('p.wsec', 'Etherscan API key (optional, faster history)'),
    h('p.mut.small', 'With a key, a Roles modifier’s history comes from Etherscan’s index in a few requests instead of block by block. roles.wei still checks every event and the block it is in, but trusts Etherscan to return all of them: a missing event would hide a permission. One key covers every chain Etherscan indexes. Leave it empty to read only from the chain.'),
    h('div.row', key, saveKey),
    h('p.mut.small', 'Kept in this browser (localStorage).'),
    out,
  );
}
$('settings').append(icon(...ICONS.gear));
$('settings').onclick = settingsDialog;
setResolver(v => resolveName(v, session.chain));
export async function resolve(v) {
  return isAddr(v) ? v.toLowerCase() : resolveName(v.trim().toLowerCase(), session.chain);
}
function home() {
  put($('crumb'));
  const input = h('input.search', { id: 'open-address', placeholder: 'Search, or open 0x… / name.eth / name.wei', 'aria-label': 'Search or open an address', autocomplete: 'off', spellcheck: 'false' });
  const rows = h('div'), out = h('div');
  const open = h('button.primary', 'Open');
  // Open at its URL; that page asks for a wallet or a chain if it needs one (the gates above).
  const go = async () => {
    const v = input.value.trim().toLowerCase();
    if (!isAddr(v) && !/^[^\s/?#]+\.[a-z]+$/.test(v)) throw Error('Enter a 0x address or a name (name.eth, name.wei).');
    intent = true; location.hash = '/' + v;
  };
  open.onclick = act(open, go, out);
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); open.click(); } };
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    const found = saved.filter(x => (x.address + ' ' + (labels.get(x.address) || '')).toLowerCase().includes(q));
    put(rows, found.length ? h('div.slist', found.map(x => h('div.srow', h('a.name', { href: '#/' + x.address + '?chain=' + x.chain, onclick: () => (intent = true) }, labels.get(x.address) || short(x.address)), h('span.mut', network(x.chain)), h('span.grow'), h('button.link', { onclick: () => { saved = saved.filter(y => y !== x); save(); draw(); put(out, h('p', 'Removed. ', h('button.link', { onclick: () => { saved.push(x); save(); draw(); put(out); } }, 'Undo'))); } }, 'Remove'), icon(...ICONS.next)))) : h('p.empty', saved.length ? 'No saved address matches.' : 'Safes and Roles modifiers you open will be listed here.'));
  };
  input.oninput = draw;
  put(main, h('div.home' + (saved.length ? '.returning' : ''), !saved.length && h('div.hero', h('span.mark', icon(...ICONS.people)), h('h1', 'roles.wei'), h('p', 'Manage Safe permissions, straight from the chain.')), h('div.panel', h('label', { for: 'open-address' }, 'Open a Safe or Roles modifier'), h('div.row', input, open), !session.account && h('p.fhint', 'You’ll connect your wallet to open it.'), out), rows)); draw();
}
export async function route() {
  const epoch = ++session.epoch;
  put($('batch'));
  const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
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
put($('foot'), h('span.mut', 'roles.wei · build ' + __BUILD__));
header(); route();
if (remembered() === 'walletconnect') ownerConn.restore().catch(() => {});
const known = list().find(w => w.key === remembered());
if (known && remembered() !== 'none') known.provider.request({ method: 'eth_accounts' }).then(a => { if (a.length) connected(known).catch(() => {}); });
