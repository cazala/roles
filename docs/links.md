# Links

roles.wei is a single page; everything after `#` is the route. For agents, [skills/roles-wei/SKILL.md](../skills/roles-wei/SKILL.md) explains how to use these links. Any gateway serving roles.wei accepts the same links (`https://roles.wei.limo/#/…`, `https://roles.wei.is/#/…`, `https://roles.caza.la/#/…`). Links only open screens or propose changes: nothing is applied or signed until a person reviews it and sends it.

## Screens

| Link | Opens |
| --- | --- |
| `#/` | Home: saved Safes and Roles modifiers, search or open an address |
| `#/<address>` | A Safe (its Roles modifiers, Create a Roles modifier) or a Roles modifier (its roles); an address or a `.eth` / `.wei` name |
| `#/<modifier>/role/<roleKey>` | A role: its permissions (targets, functions, conditions) and members. `roleKey` is the bytes32 key |
| `#/<modifier>/allowances` | The modifier's allowances |

## Parameters

Added after the address as a query (`#/<address>?chain=1&create`):

| Parameter | Effect |
| --- | --- |
| `chain=<id>` | The chain the address is on. If the wallet is on another one, the page offers to switch first |
| `create` | On a Safe: opens the Create a Roles modifier wizard. Dropped from the URL once used |
| `draft=<payload>` | On a Roles modifier: loads proposed changes into the editor (below) |

`#import=<payload>` (on any route) opens Backup & sync's import preview; it is the encoding below with a backup as the JSON (`src/backup.js`), and reads safe.wei backups too.

## Draft links (`draft=`)

A set of permission changes, often written by an agent, that a person reviews before anything happens:

```
#/<modifier>?chain=<id>&draft=<z|j><base64url>
```

- `z`: the JSON deflated (raw DEFLATE, `CompressionStream('deflate-raw')`), then base64url without padding. `j`: the JSON itself, base64url. Readers accept both; writers should prefer `z`.
- Opening it on a complete history loads every change into the editor's draft, all or nothing: they show as pending changes, marked New or Changed where they are, with a banner saying the link proposes them, its `note` (shown as unverified) and the list in words. Review changes then shows the exact calls, and Apply (the owner's wallet) or Prepare safe.wei link (a Safe owner) sends them. A malformed draft loads nothing and says why.
- Each change states the end result ("this function has these conditions"), not a step: a change that already matches the chain drops out of the review, and loading a link twice is the same as once.

### JSON

```json
{
  "v": 1,
  "note": "Weekly USDC approvals for the treasury bot",
  "ops": [
    { "op": "allowance", "key": "weekly-usdc", "balance": "1000000000", "refill": "1000000000", "period": 604800, "maxRefill": "1000000000" },
    { "op": "member", "role": "treasury-ops", "member": "0x3333…", "default": true },
    { "op": "target", "role": "treasury-ops", "target": "0xa0b8…", "access": "scoped" },
    { "op": "function", "role": "treasury-ops", "target": "0xa0b8…",
      "signature": "approve(address spender, uint256 amount)",
      "conditions": { "spender": { "mode": "oneof", "values": ["0x1111…", "0x2222…"] },
                      "amount": { "mode": "allowance", "value": "weekly-usdc" } } }
  ]
}
```

`v` is 1. `note` is optional text (up to 500 characters). `ops` lists 1 to 200 changes, applied in order. Every field is checked; an unknown field, op or mode is refused. Roles are a name (up to 31 bytes, turned into the bytes32 key as roles.wei does) or a 0x bytes32 key; addresses are 0x and 40 hex digits; amounts are whole base units as decimal strings.

| `op` | Fields | Result |
| --- | --- | --- |
| `role` | `role` | The role exists (members, targets and functions also create it) |
| `member` | `role`, `member`, `remove` (false), `default` (false) | `member` is in the role (or not, with `remove`); with `default`, this is its default role |
| `target` | `role`, `target`, `access`: `scoped` · `all` · `revoke`, `options` (with `all`) | The target allows the functions you scope, every function, or nothing |
| `function` | `role`, `target`, `signature` or `selector` (or both, which must match), `conditions`, `allowances`, `options`, `remove` (false) | The function is allowed with these conditions (a revoked target becomes scoped; a target allowing every function is refused), or revoked with `remove` |
| `allowance` | `key`, `balance`, `refill`, `period` (seconds; 0 or absent: one-time), `maxRefill` (absent: no cap), `timestamp` (absent: when it executes) | The allowance has these values |

`options` is `call` (default), `call+eth`, `delegatecall` or `delegatecall+eth` (or 0 to 3).

`conditions` is one of:

- absent or `"any"`: any parameters;
- **parameter conditions** (needs `signature`): an object by parameter path, as the condition editor names them: the parameter name (`arg0`, `arg1`… when unnamed), `name.field` inside a tuple, `name[]` for every element of a dynamic array, `name[0]` for a fixed array item. Each is `{ "mode": …, … }`:
  - `pass`: any value;
  - `equal`: `value`;
  - `oneof`: `values` (two or more);
  - `avatar`: equal to the avatar (the Safe), for an address;
  - `greater`, `less`: `value` (unsigned integers);
  - `between`: `value` (greater than) and `second` (less than), exclusive;
  - `allowance`: `value`, the allowance name or key (unsigned integers).
  Values are text, as typed in the editor: addresses, decimal integers (base units), `true` / `false`, hex bytes. Parameters left out are any value. `allowances` adds transaction allowances: `{ "ether": "<allowance>", "calls": "<allowance>" }`;
- **the exact list**: the `ConditionFlat[]` the contract stores (`[{ "parent", "paramType", "operator", "compValue" }]`), checked for integrity, for anything the editor cannot express.

The reference implementation is `src/draftlink.js` (`encode`, `decode`, `check`, `apply`), which uses `src/condition-builder.js` for parameter conditions. `node scripts/draft-link.mjs` turns a JSON file into a link.

## Stability

These are part of roles.wei's public interface and are not changed incompatibly: the routes and parameters above, and the `draft=` encoding and JSON (version 1). Extend only with optional additions or a new version number. `test/unit/draftlink.test.mjs` pins the encoding: if it fails, fix the code, not the test.
