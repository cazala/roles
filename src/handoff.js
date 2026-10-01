import { newTx, safeTxHash } from './safe.js';
import { fragment } from './share.js';
import { batch } from './multisend.js';
import { safeModules, read, MULTISEND } from './roles.js';
import { calldata } from './roles.js';
import { B, cd } from './abi.js';
import { S } from './sel.js';
import { load, store } from './store.js';
// Links from the config chunk (config/links.json; replacing them redeploys only that chunk): safe.wei on the same
// gateway family as this page (roles.wei.is → safe.wei.is), else the first, and the source code. A gateway you
// typed yourself is kept (savedGateway); the default is never saved, so a changed one reaches you.
export const LINK = typeof LINKS === 'object' && LINKS ? LINKS : {};
const family = (u) => '.' + new URL(u).hostname.split('.').slice(1).join('.');
export const SAFE_GATEWAY = (LINK.safe || []).find((u) => typeof location === 'object' && location.hostname.endsWith(family(u))) || (LINK.safe || [])[0] || 'https://safe.wei.limo/';
export const savedGateway = () => load('gateway', '') || SAFE_GATEWAY;
export const keepGateway = (base) => store('gateway', base === SAFE_GATEWAY ? '' : base);
export function gateway(value = SAFE_GATEWAY) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error('Use an HTTPS safe.wei gateway.');
  if(url.username || url.password) throw Error('Gateway must not contain credentials');
  url.hash='';return url.href;
}
export async function proposal(request, chainId, owner, calls, base, nonceInput) {
  if(!calls.length) throw Error('No changes to apply.');
  await safeModules(request,owner);
  const [current] = await read(request,owner,'nonce()',['uint256']);
  const nonce=nonceInput==null || nonceInput===''?current:BigInt(nonceInput);
  if(nonce<current || nonce>=1n<<256n)throw Error('Nonce must be current or later.');
  if(calls.length>1 && await request('eth_getCode',[MULTISEND,'latest'])==='0x')throw Error('Canonical MultiSendCallOnly is not deployed on this chain.');
  const tx=newTx({address:owner,chainId,nonce},calls.length===1?calls[0]:batch(MULTISEND,calls));
  const hash=await request('eth_call',[{to:owner,data:cd(S.getTransactionHash,tx.to,tx.value,B(tx.data),tx.operation,tx.safeTxGas,tx.baseGas,tx.gasPrice,tx.gasToken,tx.refundReceiver,tx.nonce)},'latest']);
  if(hash.toLowerCase()!==safeTxHash(tx))throw Error('Safe transaction hash mismatch.');
  return {tx,url:gateway(base)+'#'+fragment(tx,[],[...new Set(calls.map(c=>c.signature))])};
}
