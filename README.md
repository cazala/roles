# roles.wei

An interface for [Zodiac Roles](https://github.com/gnosisguild/zodiac-modifier-roles) (Roles Modifier v2) on [Safe](https://safe.global) accounts that lives on Ethereum. Give an address, a bot or an agent permission to call specific contract functions through a Safe, with conditions on the parameters and spending allowances, without the Safe's full threshold. Sibling app: **[safe.wei](https://github.com/cazala/safe)**, where the Safe's owners review and sign.

- **One self-contained HTML file**: no backend, no remote code, no analytics.
- **Reads from the chain**: a modifier's permissions are rebuilt from its own event history, read through your wallet's RPC (or your own RPC endpoint; a block explorer's index for speed: Blockscout or Routescan by default, every event checked against the chain). No subgraph, no Zodiac API.
- **Signs through your wallet**: roles.wei never holds a key; changes a Safe owns go to safe.wei for the owners.
- **Served onchain** from an ERC-8244 `html()` contract at `roles.wei`, or from any copy of the file.
- **Agent ready**: permission changes can be proposed by link, for people to review in the editor and apply. See [Agents](#agents).

## Features

**Find and create**
- Open a Safe (its Roles modifiers) or a modifier by address or `.eth` / `.wei` name, on any chain your wallet is on.
- Create a Roles 2.1.1 modifier for a Safe with a wizard: deploy and enable it in one Safe transaction, or deploy from your wallet and enable it later.
- Your Safes and modifiers on Home: search or open, rename, network shown only when it differs from yours.

**Read**
- The complete permission history, scanned in resumable steps and cached, with progress and an estimate; through a block explorer in seconds.
- Roles at a glance (targets by name, members, counts) and a Members view: what each address can do, its default role.
- A role's permissions as cards: each target, its functions with their signatures, conditions as a parameter table (AND / OR groups as brackets), names from your ABI, the block explorer's verified source or standard interfaces, and contract names next to addresses.
- Allowances read as sentences: what is available now, the refill and its period, the cap, the next refill, in the token's own units.

**Edit, in place**
- Every target, function and member has its own ⋯ actions; changes are marked where they are (New, Changed, struck through with Restore) under one draft bar.
- Add functions from the contract's ABI; edit a condition from its row, starting from what is stored (one of many values, ranges, allowances, amounts in token units); conditions the editor cannot express are kept exactly as stored.
- Allowances and members edited in words, with ⓘ explanations on every field.
- Review changes: the exact calls in order, with names; Copy changes as text for a reviewer. Apply them from the owner's wallet, or, when a Safe owns the modifier, open the prepared safe.wei link for its owners.
- Members can use their role: simulate and send a call through the modifier.

**Yours, in the browser**
- Labels, saved addresses and contract ABIs, moved between devices with Backup & sync (it reads safe.wei backups too).
- **Settings**: the safe.wei gateway to hand off to, your own RPC endpoints, the block explorer (Default, None, Etherscan with a key, Blockscout, Routescan, or any Etherscan-compatible API).

## Agents

[![skills.sh](https://skills.sh/b/cazala/roles)](https://skills.sh/cazala/roles)

Install the skill for your agent (Claude Code, Codex, Cursor and others) with the [skills](https://skills.sh) CLI: `npx skills add cazala/roles`, and its sibling with `npx skills add cazala/safe`.

roles.wei has no API: an agent proposes permission changes in a link; a person opens it, sees every change marked in the editor, reviews the calls, and the modifier's owner applies them (usually the Safe, through safe.wei). The link never applies or signs anything.

- **Skill**: [skills/roles-wei/SKILL.md](skills/roles-wei/SKILL.md) tells an agent how to write a draft (members, targets, functions with conditions, allowances), the least-privilege rules to follow, and what to tell the person.
- **Links reference**: [docs/links.md](docs/links.md): every screen and parameter, and the `draft=` format (frozen, version 1).
- **Draft builder**: `node scripts/draft-link.mjs plan.json --modifier 0x…` checks a plan offline, lists its changes in words and prints the link.
- For the Safe transactions themselves (sending funds, owners, any call), use safe.wei and its skill, [skills/safe-wei](https://github.com/cazala/safe/tree/main/skills/safe-wei).

## Documentation

| Document | For |
| --- | --- |
| [User guide](docs/guide.md) | Every screen and feature, what is checked, what is stored |
| [Links](docs/links.md) | URLs that open a screen or propose changes (integrations, agents) |
| [Specification](docs/spec.md) | Requirements, security model and how it talks to safe.wei |
| [Implementation plan](docs/plan.md) | How Zodiac Roles works and the decisions behind the design |
| [Deploy](docs/deploy.md) | Deploying the ERC-8244 contract (vanity address, cost) and pointing `roles.wei` |
| [Research](docs/research.md) | Verified contracts, events and protocol references |
| [DESIGN.md](DESIGN.md) | The look and behavior shared with safe.wei |
| [AGENTS.md](AGENTS.md), [LEARNINGS.md](LEARNINGS.md) | Rules and lessons for contributors and coding agents |

## Use it

- Open **https://roles.caza.la** (served by Cloudflare Pages from `main`; every PR gets a preview), or
- open `roles.wei` through an ERC-8244 gateway (`https://roles.wei.limo`, `https://roles.wei.is`), or
- read the page from the contract: `cast call <app> "html()(string)" --rpc-url <rpc> > roles.wei.html`, and open it on `localhost`.

## Develop

```bash
npm ci
npm run build        # dist/index.html + size report + remote-resource checks
npm test             # unit tests
npm run test:fork    # integration tests on an Anvil mainnet fork (needs Foundry)
```

- `npm run fork`, then `node scripts/dev.mjs --anvil http://127.0.0.1:8545`: a playground with an Anvil test wallet and demo Safes.
- `node scripts/dev.mjs --live [--as 0x…]`: a read-only test wallet on the real chain, reading through Alchemy and the history from Etherscan, with the keys from `.env` (`ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`) kept in the dev server.

## Deploy

See [docs/deploy.md](docs/deploy.md): deterministic CREATE2 deployment (the app's address is mined to start with `0x00000`), verification and pointing `roles.wei`. The WalletConnect project ID and the links to safe.wei and the source (`config/`) sit in a small first chunk, so changing them redeploys only that chunk and the app contract.

## Deployments

- Web: https://roles.caza.la, deployed from CI on every merge to `main`.
- Onchain: not yet deployed to mainnet.

## License

[MIT](LICENSE)
