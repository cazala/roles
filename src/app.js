import { $, h, put, addr, short, icon, ICONS, sheet, bad, act, setResolver } from './ui.js';
import { isAddr } from './abi.js';
import { use, rpc } from './rpc.js';
import { discover, list, remembered, remember } from './wallets.js';
import { resolveName } from './names.js';
import { load, store } from './store.js';
import * as labels from './labels.js';

export const session = { provider: null, account: null, chain: null, epoch: 0 };
const main = $('main');
const network = n => ({ 1: 'Ethereum', 100: 'Gnosis', 137: 'Polygon', 10: 'Optimism', 8453: 'Base', 42161: 'Arbitrum' }[n] || 'Chain ' + n);
const error = e => e?.code === 4001 ? 'Request cancelled in your wallet.' : e?.message || String(e);
let continuation = null;
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
  session.provider = provider; use(provider);
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
function walletDialog() {
  const { body, close } = sheet('shield', session.account ? 'Connected wallet' : 'Connect a wallet');
  const out = h('div');
  put(body, h('p', 'roles.wei reads the chain through your wallet.'), session.account && addr(session.account),
    list().length ? list().map((w, i) => {
      const b = h('button' + (!i && !session.account ? '.primary' : ''), 'Connect ' + w.name);
      b.onclick = act(b, async () => { await connected(w); close(); }, out); return h('div.actions', b);
    }) : h('p.mut', 'Install or enable a browser wallet, then reload this page.'),
    session.account && h('button', { onclick: () => { for (const event of ['accountsChanged', 'chainChanged']) session.provider?.removeListener?.(event, changed); use(null); session.provider = null; session.account = null; session.chain = null; session.epoch++; remember('none'); continuation = null; close(); header(); route(); } }, 'Disconnect'), out);
}
$('connect').onclick = walletDialog;
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
  put(main, h('div.home' + (saved.length ? '.returning' : ''), !saved.length && h('div.hero', h('span.mark', icon(...ICONS.shield)), h('h1', 'roles.wei'), h('p', 'Manage Safe permissions, straight from the chain.')), h('div.panel', h('label', { for: 'open-address' }, 'Open a Safe or Roles modifier'), h('div.row', input, open), !session.account && h('p.fhint', 'You’ll connect your wallet to open it.'), out), rows)); draw();
}
export let renderAddress = async address => {
  const code = await rpc('eth_getCode', [address, 'latest']);
  if (code === '0x') throw Error('No contract at this address on ' + network(session.chain) + '.');
  return h('div', h('h1', 'Contract'), addr(address), h('p.mut', 'Connected. Roles inspection arrives in phase 2.'));
};
export const setAddressRenderer = fn => { renderAddress = fn; };
export async function route() {
  const epoch = ++session.epoch;
  const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (!path[0]) return home();
  if (!session.account) { put(main, h('div.home.gate', h('div.panel.gatecard', h('span.mark', icon(...ICONS.shield)), h('h2', 'Connect a wallet to open this address'), h('p', 'Chain reads use your wallet’s RPC.'), h('button.primary', { onclick: () => requireWallet(route) }, 'Connect a wallet')))); return; }
  try {
    const requested = new URLSearchParams(location.hash.split('?')[1] || '').get('chain');
    if (requested && Number(requested) !== session.chain) { put(main, h('div.panel', h('h2', 'Switch to ' + network(Number(requested))), h('button.primary', { onclick: () => requireWallet(async () => { try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x' + Number(requested).toString(16) }]); await changed(); } catch (e) { main.append(bad(e.code === 4902 ? 'Add this chain in your wallet, then try again.' : error(e))); } }) }, 'Switch chain'))); return; }
    const address = await resolve(path[0]);
    put(main, h('p.mut', 'Reading the chain…'));
    const view = await renderAddress(address, path.slice(1), epoch);
    if (epoch !== session.epoch) return;
    if (!saved.some(x => x.address === address && x.chain === session.chain)) { saved.unshift({ address, chain: session.chain }); save(); }
    put($('crumb'), h('span.mut', '/'), h('a', { href: '#/' + address }, labels.get(address) || short(address)));
    put(main, view);
  } catch (e) { if (epoch === session.epoch) put(main, bad(error(e)), h('a', { href: '#/' }, 'Open another address')); }
}
addEventListener('hashchange', route);
discover(() => { header(); });
put($('foot'), h('span.mut', 'roles.wei · build ' + __BUILD__));
header(); route();
const known = list().find(w => w.key === remembered());
if (known && remembered() !== 'none') known.provider.request({ method: 'eth_accounts' }).then(a => { if (a.length) connected(known).catch(() => {}); });
