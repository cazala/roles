// Amounts typed in units (1.5 ether, 250 USDC) to exact base units, and back. No floats: decimal strings only.

/** "1,234.5" in units with `decimals` → base units as a BigInt; refuses more fraction digits than the unit has. */
export function parseUnits(text, decimals) {
  const t = String(text).trim().replace(/[,_\s]/g, '');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!t || !m || (m[2] === '' && !m[3])) throw Error('Enter a number, like 1.5 or 1000.');
  const frac = m[3] || '';
  if (frac.length > decimals) throw Error(decimals ? 'At most ' + decimals + ' decimals in this unit.' : 'Whole numbers only in base units.');
  const n = BigInt((m[2] || '0') + frac.padEnd(decimals, '0'));
  return m[1] ? -n : n;
}

/** Base units → "1,234.5" in units with `decimals` (thousands grouped, trailing zeros dropped). */
export function formatUnits(value, decimals) {
  let v = BigInt(value);
  const neg = v < 0n;
  if (neg) v = -v;
  const s = v.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ','), frac = decimals ? s.slice(-decimals).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}
