// Reading an ABI the user uploaded or pasted (no DOM, so it is unit-tested on its own).

/**
 * An ABI as the user gave it: a JSON ABI, a compiler artifact (Hardhat / Truffle `contractName`, Foundry
 * `metadata.settings.compilationTarget`), or one function signature per line. Returns { abi (text), name }.
 */
export function readAbi(text) {
  text = String(text || '').trim();
  if (!text.startsWith('{')) return { abi: text, name: null };
  const o = JSON.parse(text);
  if (!Array.isArray(o.abi)) throw Error('This JSON has no "abi" list.');
  const target = o.metadata?.settings?.compilationTarget || (typeof o.metadata === 'string' ? JSON.parse(o.metadata).settings?.compilationTarget : null);
  return { abi: JSON.stringify(o.abi), name: o.contractName || (target && Object.values(target)[0]) || null };
}
