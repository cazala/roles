import { encodeCall, decodeParameters, parseValue } from './abicoder.js';
import { calldata } from './roles.js';

export const EXECUTE = 'execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert)';

export function executionPlan(modifier, roleKey, target, valueInput, operationInput, fn, inputs) {
  const value=parseValue({name:'Safe value',type:'uint256'},valueInput||'0');
  const operation=Number(operationInput);
  if(operation!==0&&operation!==1)throw Error('Operation must be CALL or DELEGATECALL.');
  const args=fn.inputs.map((p,i)=>parseValue(p,inputs[i]));
  const inner=encodeCall(fn,args);
  const data=calldata(EXECUTE,[target,value,inner,BigInt(operation),roleKey,true]);
  return {to:modifier,value:0n,data,target,safeValue:value,operation,fn,args,inner,roleKey};
}

export async function simulateExecution(request, account, plan) {
  const raw=await request('eth_call',[{from:account,to:plan.to,data:plan.data,value:'0x0'},'latest']);
  const [success]=decodeParameters([{type:'bool'}],raw);
  if(!success)throw Error('The role call returned false.');
  return true;
}
