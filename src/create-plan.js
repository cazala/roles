import { keccakHex, strip, word, isAddr, ZERO } from './abi.js';
import { encodeParameters, decodeParameters } from './abicoder.js';
import { calldata, MASTER, FACTORY } from './roles.js';

const DEPLOY = 'deployModule(address masterCopy,bytes initializer,uint256 saltNonce)';
const SETUP = 'setUp(bytes initParams)';
const PROXY_PREFIX = '602d8060093d393df3363d3d373d3d3d363d73';
const PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

const address = (value, name) => {
  if (!isAddr(value) || value.toLowerCase() === ZERO) throw Error(name + ' must be a nonzero 0x address.');
  return value.toLowerCase();
};

export function creation(owner, avatar, target, saltInput) {
  owner = address(owner, 'Owner'); avatar = address(avatar, 'Avatar'); target = address(target, 'Target');
  let salt;
  try { salt = BigInt(String(saltInput).trim()); } catch { throw Error('Salt must be a whole decimal or 0x number.'); }
  if (salt < 0n || salt >= 1n << 256n) throw Error('Salt must fit in uint256.');
  const initParams = encodeParameters(Array(3).fill({ type: 'address' }), [owner, avatar, target]);
  const initializer = calldata(SETUP, [initParams]);
  const data = calldata(DEPLOY, [MASTER, initializer, salt]);
  const createSalt = keccakHex(keccakHex(initializer) + word(salt));
  const initCode = '0x' + PROXY_PREFIX + strip(MASTER) + PROXY_SUFFIX;
  const proxy = '0x' + strip(keccakHex('0xff' + strip(FACTORY) + strip(createSalt) + strip(keccakHex(initCode)))).slice(24);
  return { owner, avatar, target, salt, initializer, data, proxy };
}

export async function verifyCreation(request, from, values) {
  const plan = creation(values.owner, values.avatar, values.target, values.salt);
  for (const [name, address] of [['Roles 2.1.1 mastercopy', MASTER], ['ModuleProxyFactory', FACTORY]])
    if (await request('eth_getCode', [address, 'latest']) === '0x') throw Error(name + ' is not deployed on this chain.');
  if (await request('eth_getCode', [plan.proxy, 'latest']) !== '0x') throw Error('This salt and setup already have a deployed proxy. Choose another salt.');
  const raw = await request('eth_call', [{ from, to: FACTORY, data: plan.data }, 'latest']);
  const [predicted] = decodeParameters([{ type: 'address' }], raw);
  if (predicted !== plan.proxy) throw Error('Factory prediction does not match the local CREATE2 calculation.');
  return plan;
}

export const creationCalls = (safe, plan) => [
  { to: FACTORY, value: 0n, data: plan.data, signature: DEPLOY, text: 'Deploy Roles 2.1.1 at ' + plan.proxy, danger: plan.owner !== safe },
  { to: safe, value: 0n, data: calldata('enableModule(address module)', [plan.proxy]), signature: 'enableModule(address module)', text: 'Enable Roles module ' + plan.proxy, danger: true },
];
