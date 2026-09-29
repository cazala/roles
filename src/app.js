import { renderAddress } from './views.js';
import { $, h, put, addr, short, icon, ICONS, sheet, bad, act, setResolver, friendlyError, copyButton, NS } from './ui.js';
import { isAddr } from './abi.js';
import { use, rpc } from './rpc.js';
import { add, discover, list, remembered, remember } from './wallets.js';
import { connector, provider as wcProvider } from './wc.js';
import { qr, qrPath } from './qr.js';
import { addRpc, explorerKey, reader, removeRpc, rpcs, setExplorerKey, WC_RPC } from './reads.js';
import { resolveName } from './names.js';
import { load, store } from './store.js';
import * as labels from './labels.js';

export const session = { provider: null, account: null, chain: null, epoch: 0 };
const main = $('main');
const network = n => ({ 1: 'Ethereum', 100: 'Gnosis', 137: 'Polygon', 10: 'Optimism', 8453: 'Base', 42161: 'Arbitrum' }[n] || 'Chain ' + n);
let continuation = null;

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
function header() {
  put($('connect'), session.account ? [h('span.net', network(session.chain)), short(session.account)] : 'Connect');
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
  const next = continuation; continuation = null;
  if (next) await next(); else await route();
}
async function changed() {
  session.epoch++;
  session.account = (await rpc('eth_accounts'))[0]?.toLowerCase() || null;
  session.chain = Number(await rpc('eth_chainId'));
  header(); route();
}
export function requireWallet(next) {
  if (session.account) return next();
  continuation = next;
  walletDialog();
}
function disconnect() {
  // Ask the wallet to forget this site where supported (EIP-2255; WalletConnect deletes its session).
  session.provider?.request?.({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch?.(() => {});
  for (const event of ['accountsChanged', 'chainChanged']) session.provider?.removeListener?.(event, changed);
  use(null); session.provider = null; session.account = null; session.chain = null; session.epoch++;
  remember('none'); continuation = null; header(); route();
}
/** Connect a wallet, or (connected) the account, chain switching for WalletConnect, other wallets, Disconnect. */
function walletDialog() {
  const { body, close } = sheet('people', session.account ? 'Your wallet' : 'Connect a wallet');
  const out = h('div');
  const option = (title, sub, fn) => { const b = h('button.wopt', h('span.wtext', h('b', title), sub && h('span.mut', sub)), icon(...ICONS.next)); b.onclick = act(b, fn, out); return b; };
  const wallets = list().filter((w) => !session.account || w.provider !== session.provider?.wallet);
  const choices = wallets.map((w) => option(w.name, w.key === 'walletconnect' ? 'A wallet on your phone, by QR code' : 'Browser wallet', async () => { await connected(w); close(); }));
  if (!session.account) return put(body, h('p.mut', 'roles.wei reads the chain and asks for signatures through the wallet you connect.'), h('div.wlist', choices), out);
  const wc = session.provider?.wallet === ownerWallet, chains = wc ? (ownerConn.session()?.chains || []).filter((c) => c !== session.chain) : [];
  put(
    body,
    h('div.wacct', h('span.mut.small', (wc ? peerName() + ' · ' : '') + network(session.chain)), addr(session.account)),
    chains.length > 0 && [h('p.wsec', 'Network'), h('div.wlist', chains.map((c) => option('Switch to ' + network(c), null, async () => { await rpc('wallet_switchEthereumChain', [{ chainId: '0x' + c.toString(16) }]); close(); })))],
    choices.length > 0 && [h('p.wsec', 'Switch wallet'), h('div.wlist', choices)],
    out,
    h('div.actions.wfoot', h('button', { onclick: () => (close(), disconnect()) }, 'Disconnect')),
  );
}
$('connect').onclick = walletDialog;

/** Settings: RPC endpoints (reads go there instead of the wallet, per chain) and an Etherscan API key. */
function settingsDialog() {
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
  const go = () => requireWallet(async () => { const address = await resolve(input.value.trim()); location.hash = '/' + address; });
  open.onclick = act(open, go, out);
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); open.click(); } };
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    const found = saved.filter(x => (x.address + ' ' + (labels.get(x.address) || '')).toLowerCase().includes(q));
    put(rows, found.length ? h('div.slist', found.map(x => h('div.srow', h('a.name', { href: '#/' + x.address + '?chain=' + x.chain }, labels.get(x.address) || short(x.address)), h('span.mut', network(x.chain)), h('span.grow'), h('button.link', { onclick: () => { saved = saved.filter(y => y !== x); save(); draw(); put(out, h('p', 'Removed. ', h('button.link', { onclick: () => { saved.push(x); save(); draw(); put(out); } }, 'Undo'))); } }, 'Remove'), icon(...ICONS.next)))) : h('p.empty', saved.length ? 'No saved address matches.' : 'Safes and Roles modifiers you open will be listed here.'));
  };
  input.oninput = draw;
  put(main, h('div.home' + (saved.length ? '.returning' : ''), !saved.length && h('div.hero', h('span.mark', icon(...ICONS.people)), h('h1', 'roles.wei'), h('p', 'Manage Safe permissions, straight from the chain.')), h('div.panel', h('label', { for: 'open-address' }, 'Open a Safe or Roles modifier'), h('div.row', input, open), !session.account && h('p.fhint', 'You’ll connect your wallet to open it.'), out), rows)); draw();
}
export async function route() {
  const epoch = ++session.epoch;
  put($('batch'));
  const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (!path[0]) return home();
  if (!session.account) { put(main, h('div.home.gate', h('div.panel.gatecard', h('span.mark', icon(...ICONS.people)), h('h2', 'Connect a wallet to open this address'), h('p', 'Chain reads use your wallet’s RPC.'), h('button.primary', { onclick: () => requireWallet(route) }, 'Connect a wallet')))); return; }
  try {
    const requested = new URLSearchParams(location.hash.split('?')[1] || '').get('chain');
    if (requested && Number(requested) !== session.chain) { put(main, h('div.panel', h('h2', 'Switch to ' + network(Number(requested))), h('button.primary', { onclick: () => requireWallet(async () => { try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x' + Number(requested).toString(16) }]); await changed(); } catch (e) { main.append(bad(e.code === 4902 ? (session.provider?.wallet === ownerWallet ? peerName() + ' did not approve ' + network(Number(requested)) + ' when it connected. Disconnect, then connect again and approve it.' : 'Add this chain in your wallet, then try again.') : friendlyError(e))); } }) }, 'Switch chain'))); return; }
    const address = await resolve(path[0]);
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
