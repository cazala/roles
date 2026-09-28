import { readSafe, newTx, execData, prevalidated } from '../../src/safe.js';
import { use } from '../../src/rpc.js';
import { calldata, read, MASTER, FACTORY, roleKey } from '../../src/roles.js';
import { encodeParameters } from '../../src/abicoder.js';
import { deploySafe, tx, ACCOUNTS } from './anvil.mjs';
export async function safeCall(f, safe, to, data, operation = 0) {
  use(f.provider);
  const state = await readSafe(safe);
  const receipt = await tx(f.rpc, ACCOUNTS[0], safe, execData(newTx(state, { to, data, operation }), prevalidated(ACCOUNTS[0])));
  return receipt;
}
export async function deployRoles(f, { safe, owner = ACCOUNTS[0], salt = 901n } = {}) {
  safe ||= await deploySafe(f.rpc, '1.4.1', [ACCOUNTS[0]], 1, salt);
  const init = calldata('setUp(bytes initParams)', [encodeParameters(Array(3).fill({ type: 'address' }), [owner, safe, safe])]);
  const data = calldata('deployModule(address masterCopy,bytes initializer,uint256 saltNonce)', [MASTER, init, salt]);
  const [address] = await read(f.rpc, FACTORY, 'deployModule(address masterCopy,bytes initializer,uint256 saltNonce)', ['address'], 'latest', [MASTER, init, salt]);
  const receipt = await tx(f.rpc, ACCOUNTS[0], FACTORY, data);
  await safeCall(f, safe, safe, calldata('enableModule(address module)', [address]));
  return { address, safe, owner, deploymentBlock: Number(BigInt(receipt.blockNumber)) };
}
export async function configureDemo(f, fixture) {
  const key = roleKey('treasurer');
  const send = async data => fixture.owner === fixture.safe ? safeCall(f, fixture.safe, fixture.address, data) : tx(f.rpc, fixture.owner, fixture.address, data);
  await send(calldata('assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)', [ACCOUNTS[1], [key], [true]]));
  await send(calldata('scopeTarget(bytes32 roleKey,address targetAddress)', [key, ACCOUNTS[2]]));
  await send(calldata('allowFunction(bytes32 roleKey,address targetAddress,bytes4 selector,uint8 options)', [key, ACCOUNTS[2], '0x12345678', 1n]));
  return key;
}
