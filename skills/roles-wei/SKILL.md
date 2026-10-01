---
name: roles-wei
description: Propose Zodiac Roles permissions for a Safe (who may call which contract functions, with which parameters and spending allowances) for people to review and apply in roles.wei, by link. Use when someone wants to give an address, bot or agent scoped access to a Safe's assets, change a role's targets, functions, conditions, members or allowances, revoke a permission, or set up a Roles modifier on a Safe. roles.wei is a single-page app served onchain; it has no API and no backend.
---

# roles.wei by link

roles.wei manages Zodiac Roles 2.1.1 modifiers: the module that lets a role's members call specific functions through a Safe, with conditions on the parameters and allowances on amounts, without the Safe's full threshold. It runs in the browser and reads the chain through the user's wallet. **You never apply, sign or send anything.** A link only proposes: the person reviews every change in roles.wei's editor, then the modifier's owner applies it (usually the Safe itself, through a safe.wei transaction the owners sign).

Gateways: `https://roles.wei.limo/`, `https://roles.wei.is/`, `https://roles.caza.la/`. The full reference is `docs/links.md` in the roles.wei repository.

## Pick the right link

| The user wants to… | Link |
| --- | --- |
| See a Safe's Roles modifiers | `#/<safe>?chain=<id>` |
| Set up a Roles modifier on a Safe | `#/<safe>?chain=<id>&create` (opens the create wizard) |
| See a modifier's roles, a role, its allowances | `#/<modifier>?chain=<id>`, `#/<modifier>/role/<roleKey>`, `#/<modifier>/allowances` |
| Change permissions (members, targets, functions, conditions, allowances) | `#/<modifier>?chain=<id>&draft=<payload>` built with the script below |

You need the **modifier** address (not the Safe) for `draft=`: the Safe page in roles.wei lists its modifiers, and safe.wei's Settings → Modules links to them.

## Writing a draft

A draft is JSON, `{ "v": 1, "note": "<why, in one sentence>", "ops": [ … ] }`. Each op states the end result, so changes already in place drop out, and the person sees only real differences.

```json
{ "v": 1, "note": "Let the treasury bot approve USDC to CoW and Uniswap, up to 1,000 USDC a week", "ops": [
  { "op": "allowance", "key": "weekly-usdc", "balance": "1000000000", "refill": "1000000000", "period": 604800, "maxRefill": "1000000000" },
  { "op": "member", "role": "treasury-bot", "member": "0x<bot address>", "default": true },
  { "op": "function", "role": "treasury-bot", "target": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "signature": "approve(address spender, uint256 amount)",
    "conditions": {
      "spender": { "mode": "oneof", "values": ["0x<CoW vault relayer>", "0x<Uniswap router>"] },
      "amount": { "mode": "allowance", "value": "weekly-usdc" } } }
] }
```

- `member`: `role`, `member`, optional `remove`, `default`.
- `target`: `role`, `target`, `access` `scoped` (only the functions you allow), `all` (every function: avoid), `revoke`; `options` `call` (default) / `call+eth` / `delegatecall` / `delegatecall+eth`.
- `function`: `role`, `target`, `signature` (preferred) or `selector`, `conditions`, optional `allowances` (`{ "ether": "<allowance>", "calls": "<allowance>" }`), `options`, `remove`. A function on an unconfigured target scopes it.
- `conditions` by parameter name (as in the signature; `arg0`… when unnamed; `info.amount` inside tuples; `list[]` for every array element): `pass`, `equal` (`value`), `oneof` (`values`), `avatar` (equal to the Safe), `greater` / `less` (`value`), `between` (`value` < x < `second`), `allowance` (`value`: allowance name). Parameters you leave out accept any value. Values are text: addresses, decimal integers in base units, `true` / `false`, 0x bytes.
- `allowance`: `key`, `balance` (available now), `refill` and `period` (seconds) for a refilling budget, `maxRefill` (cap), all in base units of what it limits (e.g. USDC has 6 decimals: 1,000 USDC is `"1000000000"`).
- Roles are names (up to 31 bytes) or bytes32 keys; amounts are decimal strings in base units.

Build and check it, in a checkout of the roles.wei repository:

```bash
node scripts/draft-link.mjs plan.json --modifier 0x… --chain 1 [--gateway https://roles.wei.limo/]
```

It refuses a malformed plan (naming the change at fault), builds every change as the editor would, lists them in words, and prints the link. Never hand-encode `draft=`.

## Least privilege

- Scope targets; never `access: all` unless the user asks for it and understands it.
- Constrain every parameter that sends value somewhere: recipients and spenders with `equal` / `oneof` / `avatar`, amounts with `allowance` or `less`.
- `delegatecall` options let the role run code as the Safe itself: do not propose them.
- Prefer refilling allowances with a cap over large one-time balances.

## Before you hand over a link

1. Say in plain words what the role will be able to do, on which contracts, with which limits, and who gets it.
2. Use verified full 0x addresses and correct token decimals; never guess.
3. Tell the person roles.wei shows the changes marked in place under "This link proposes N changes", with your note marked unverified, and that they should check each one, then Review changes, which lists the exact calls.
4. Applying is the modifier owner's step: Apply (owner's wallet) or Prepare safe.wei link (owner Safe), then the Safe's owners sign in safe.wei.

The sibling skill `safe-wei` (`npx skills add cazala/safe`) covers Safe transactions in safe.wei.
