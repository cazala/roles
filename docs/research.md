# Phase 0 research

Checked 2026-09-28. The runtime target is **Roles Modifier 2.1.1**, with **ModuleProxyFactory 1.1.0** and **MultiSendCallOnly 1.4.1**. Pins live in [research.json](../config/research.json); the complete unmodified Roles ABI is [roles-2.1.1.abi.json](../config/roles-2.1.1.abi.json). The app has not been implemented yet; [spec.md](spec.md) defines the phase acceptance gates.

## Immutable sources

| Source | Revision | What it establishes |
| --- | --- | --- |
| [safe.wei](https://github.com/cazala/safe/tree/4ba19e520ce3af9d8310419d4259dd6ef0db8e8d) | `4ba19e520ce3af9d8310419d4259dd6ef0db8e8d` | Copy origin for UI, CSS, RPC, ABI, names, sharing, batching and build/fork/deploy tooling |
| [Zodiac registry](https://github.com/gnosisguild/zodiac/blob/89352c4f05d4b223b9c555ca963a787fd930da2d/src/contracts.ts) | `89352c4f05d4b223b9c555ca963a787fd930da2d` | Canonical mastercopy/factory addresses and faulty versions |
| [Roles 2.1.1 release commit](https://github.com/gnosisguild/zodiac-modifier-roles/commit/218a5164d739c107b132034436978e78cdd90c95) | `218a5164d739c107b132034436978e78cdd90c95` | Release source, ABI and mastercopy build artifact |
| [Safe deployments](https://github.com/safe-global/safe-deployments/tree/7b1fb6d615ab2d2999550ec9166554b180e813e5/src/assets) | `7b1fb6d615ab2d2999550ec9166554b180e813e5` | Canonical MultiSendCallOnly deployments by chain |

There is no `evm/v2.1.1` release tag in the remote tag list checked during research. Use the immutable **v2.1.1 release commit**, not a guessed tag or current main. Its `packages/evm/mastercopies.json → Roles → 2.1.1` address and ABI match the pinned registry artifact. Every source file in its compiler input also matches the registry's verified-source input. The compiler settings objects are not identical: library link keys are normalized differently; do not claim byte-for-byte equality of the whole input JSON. Both specify Solidity 0.8.21, optimizer 100 runs, Integrity `0x6a6af4b16458bc39817e4019fb02bd3b26d41049` and Packer `0x869718c939652084bc491fbc5ce0d3c1d5b309f0`.

The registry's [verified Roles artifact](https://github.com/gnosisguild/zodiac/tree/89352c4f05d4b223b9c555ca963a787fd930da2d/mastercopies/roles/2.1.1/Roles) supplies ABI, source and deployed runtime. Runtime equality was independently checked by SHA-256 against chain code (the hash is an evidence fingerprint, not an Ethereum selector/hash substitute).

## Canonical addresses and chain verification

| Contract | Address |
| --- | --- |
| Roles 2.1.1 — creation target | `0xf2964ce6161ce0e75964fe7927ce114cb0b283d5` |
| ModuleProxyFactory 1.1.0 | `0x00000000000dc7f163742eb4abef650037b1f588` |
| MultiSendCallOnly 1.4.1 — initial batch target | `0x9641d764fc13c8b624c04430c7356c1c7c8102e2` |
| MultiSendCallOnly 1.5.0 — safe.wei also recognizes this | `0xa83c336b20401af773b6219ba5027174338d1836` |
| Roles 1.0.0 — identify only | `0x85388a8cd772b19a468f982dc264c238856939c9` |
| Roles 1.1.0 — identify only | `0xd8dfc1d938d7d163c5231688341e9635e9011889` |
| Roles 2.1.0 — faulty, no new deployments/writes | `0x9646fdad06d3e24444381f44362a3b0eb343d337` |

All four Roles addresses match safe.wei's `src/zodiac.js`. The registry explicitly flags 2.1.0 faulty. The 2.1.1 release fixes signature checking, ArraySome traversal/consumption rollback, and Bitmask handling of dynamic byte lengths. Historical versions need their own ABI/semantics before richer inspection is enabled.

| Chain | Pinned block | Roles 2.1.1 | Factory 1.1.0 | MultiSendCallOnly 1.4.1 |
| --- | --- | --- | --- | --- |
| Ethereum (1) | 26,071,000 | Runtime matches | Runtime matches | Runtime matches |
| Gnosis (100) | 48,479,326 | Runtime matches | Runtime matches | Runtime matches |
| Polygon (137) | 94,585,388 | Runtime matches | Runtime matches | Runtime matches |

The three selected addresses are identical on these chains. Exact block hashes, timestamps, byte counts and SHA-256 hashes are saved in [research-evidence.json](research-evidence.json). Runtime sizes are 24,409 / 1,953 / 410 bytes respectively. Registry entries for other networks are **not** proof of deployments there. Probe the connected wallet's chain every time; do not show creation/batching as available from chain names alone.

Both Safe 1.4.1 and 1.5.0 deployment manifests list canonical MultiSendCallOnly on chains 1, 10, 100, 137, 8453 and 42161. Only 1.4.1 was probed here. safe.wei's current `MULTISEND` list accepts 1.4.1 and 1.5.0; **do not use the older 1.3.0 address** merely because it appears in historical documentation.

## Real fixture and archive limits

Ethereum fork block: **26,071,000**, hash `0x124596668a96ab9600ff3e408a90f1ad453201fd4fcdc3d277934022cdbe3cb0`.

Real modifier: `0xd1f7cd1c68a7f82ad86d320d2446eb706822f742`. It is referenced by the upstream SDK's `packages/sdk/src/main/permission/validatePresets.test.ts` MANAGER permission example. Chain reads show an exact 45-byte proxy pointing at **2.1.0**, not 2.1.1. Owner, avatar and target all read `0x846e7f810e08f1e2af2c5afd06847cc95f5cae1b`. Do not infer a DAO identity from this address. Use it to test identification and the faulty-version warning; do not use it as a supported write fixture.

For write tests, deploy fresh 2.1.1 proxies for disposable Anvil-owned Safes on the same pinned fork. Clear inherited EIP-7702 code on the default accounts as in safe.wei. All writes must target the local Anvil RPC. A full replay fixture and deployment-block discovery remain part of phase 2; a getter check is not a completed log scan.

The local Anvil rehearsal passed at this block: Safe `0xb664454d454227e9d754599038fa0e273a8c72d0`, predicted and deployed Roles proxy `0x79a546f8f9a8cfe199e1d8bb64636e7d1858150b`, successful receipt, exact 45-byte runtime and matching owner/avatar/target. These are **fork-only test addresses**, not production deployments. This check deploys the modifier but does not yet enable it or test member execution.

Reproduce with the sibling safe.wei checkout at the pinned revision and Foundry Anvil installed (`ANVIL` can override its path):

```sh
FORK_URL=https://eth.drpc.org node scripts/rehearse-research.mjs
```

This phase-0 experiment reuses `../safe/test/fork/anvil.mjs` and `../safe/src/abi.js`; it starts a disposable local fork on port 19587 and stops it when the experiment completes. Phase 1 copies the harness into this project to remove the sibling dependency.

Provider observations during research:

- PublicNode Ethereum refused historical code reads with an archive-token requirement; it must not remain an assumed working default for the fork harness.
- `https://eth.drpc.org` served the pinned block, bytecode and owner/avatar/target calls. Historical binary-search requests could not always be routed, and even a 1,000-block log request returned a range-limit error. Record that failure, do not interpret it as zero events or successful replay.
- Gnosis and Polygon PublicNode served the pinned deployment code. A later Polygon PublicNode recheck failed with historical state unavailable; the same pins passed through Polygon dRPC. Historical availability can change; caller-supplied archive RPCs remain necessary for reproducible tests.

Re-run read-only evidence checks (Node 22+, no dependencies):

```sh
RPC_URL=https://eth.drpc.org CHAIN_ID=1 node scripts/verify-research.mjs
RPC_URL=https://gnosis-rpc.publicnode.com CHAIN_ID=100 node scripts/verify-research.mjs
RPC_URL=https://polygon.drpc.org CHAIN_ID=137 node scripts/verify-research.mjs
```

These URLs are research tools only. The production app always reads through the connected wallet. The script checks chain ID, pinned block hash, every canonical runtime's size and hash, and Ethereum fixture metadata. It fails on missing history or mismatches; it never submits a transaction or writes a deployment record.

The checked-in verifier passed for all three chains using the commands above. The fork rehearsal also passed. Full-history log replay, application/browser checks and production HTML size checks are not claimed by phase 0.

## Factory formula

Source: [ModuleProxyFactory 1.1.0 verified artifact](https://github.com/gnosisguild/zodiac/tree/89352c4f05d4b223b9c555ca963a787fd930da2d/mastercopies/factory/1.1.0/ModuleProxyFactory).

```text
initializer = encodeCall(setUp(bytes), abi.encode(owner, avatar, target))
salt = keccak256(keccak256(initializer) || uint256(saltNonce))
initCode = 0x602d8060093d393df3363d3d373d3d3d363d73
           || mastercopy (20 bytes)
           || 0x5af43d82803e903d91602b57fd5bf3
proxy = last20(keccak256(0xff || factory || salt || keccak256(initCode)))
```

`deployModule(address masterCopy, bytes initializer, uint256 saltNonce)` returns the proxy. Compare the calculated address to an `eth_call` from the actual intended deployer. `ModuleProxyCreation(address indexed proxy, address indexed masterCopy)` identifies deployment. The factory calls initializer after CREATE2 and reverts on failure/collision; deployment does not attach the module to a Safe.

## ABI and event semantics

The full pinned ABI is authoritative, including indexed fields, tuple components, errors and return values. Configuration calls are onlyOwner. `multicall` is absent: direct wallet owners must apply changes sequentially.

- `RolesModSetup` indexes initiator, owner and avatar; target is in data. OwnershipTransferred, AvatarSet and TargetSet index both addresses. Permission events index **none** of their arguments.
- `assignRoles` writes only specified membership flags and enables a disabled member even if all flags are false. Roles also inherits enable/disable module events; membership and enablement must both be represented. `setDefaultRole` does not assign membership.
- Target clearance is None=0, Target=1, Function=2. Changing it, including revokeTarget, leaves function mappings stored. Re-scoping can reactivate old functions. This is a critical replay/diff case.
- Execution options are None=0, Send=1, DelegateCall=2, Both=3. None permits ordinary zero-value CALL; it does not mean the entire permission is disabled.
- `scopeFunction` tuple is `(uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[]`. It emits the complete tree. `allowFunction` overwrites it with wildcard access; revokeFunction deletes that selector.
- Unwrap adapters are keyed by `bytes20(to) || bytes4(selector) || 8 zero bytes`. Setter is `setTransactionUnwrapper`; event is `SetUnwrapAdapter`.
- No transaction creates an otherwise empty named role. Role keys, members, allowances and target/function entries must be discovered from events, with completeness visible.

## Condition constants and integrity

Sources: `Types.sol`, `Integrity.sol`, `Topology.sol` in the [release source](https://github.com/gnosisguild/zodiac-modifier-roles/tree/218a5164d739c107b132034436978e78cdd90c95/packages/evm/contracts).

`ParameterType`: None=0, Static=1, Dynamic=2, Tuple=3, Array=4, Calldata=5, AbiEncoded=6. The deployed 2.1.1 release already has Calldata/AbiEncoded variants under the **ParameterType** enum name.

| Operator | Value | Initial reader/editor coverage |
| --- | --- | --- |
| Pass | 0 | Yes |
| And / Or | 1 / 2 | Yes |
| Nor | 3 | Raw until implemented |
| Matches | 5 | Yes |
| ArraySome / ArrayEvery / ArraySubset | 6 / 7 / 8 | Later |
| EqualToAvatar | 15 | Yes |
| EqualTo | 16 | Yes |
| GreaterThan / LessThan | 17 / 18 | Yes |
| SignedIntGreaterThan / SignedIntLessThan | 19 / 20 | Raw until implemented |
| Bitmask / Custom | 21 / 22 | Later |
| WithinAllowance / EtherWithinAllowance / CallWithinAllowance | 28 / 29 / 30 | Yes |

Other enum slots are placeholders and invalid for editing. The root is self-parented at index zero; root children also reference zero. Parent indices are nondecreasing in BFS order. Integrity validates operator/type/value combinations, children and compatible type trees; checking parent indices alone is insufficient. Resolved root type must be Calldata, including logical roots. The spec records the editor validation obligations; port the exact integrity/topology behavior and compare with contract simulation before exposing writes.

## Allowance semantics

Sources: `Types.sol`, `PermissionBuilder.sol`, `AllowanceTracker.sol` at the release revision. Getter fields are `(uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp)`. Setter/event fields put balance first. `setAllowance` changes zero maxRefill to uint128 max and zero timestamp to the current block timestamp before storing and emitting.

Accrue complete periods from the stored timestamp. Period zero means no refill. If balance is below maxRefill, add `refill × elapsedPeriods` and cap; if it is already above maxRefill, retain it. Advance timestamp by complete periods. Mirror checked arithmetic, including overflow before capping, using BigInt. Read storage and use block time rather than wall-clock time. ConsumeAllowance gives consumed amount and new balance but not the updated timestamp, so it is insufficient to reconstruct live balances alone.

## safe.wei hand-off and copy plan

Use [safe.wei's pinned stable link contract](https://github.com/cazala/safe/blob/4ba19e520ce3af9d8310419d4259dd6ef0db8e8d/docs/links.md). `#tx=` uses SW version 1 compact bytes and optional call signatures (flag bit 3). Copy `share.js` with its full dependency closure: the current file also supports messages, so inspect imports rather than relying on an old dependency description. Include exact signatures for every encoded call and test the link through safe.wei's decoder. It re-encodes to verify canonical calldata and checks the SafeTx hash against the Safe.

Phase 1 starts UI/CSS verbatim and copies the small ABI/RPC/wallet/name helpers and build/dev/fork/deploy tooling. Replace app/storage/deployment-record names deliberately; do not copy private `.env`, cached deployments, wallet state or `node_modules`. Later phases copy hashing/sharing/batching helpers when used. Track modifications and imported dependencies per file; no shared package yet. safe.wei itself remains unchanged.

Cross-origin storage cannot be reused automatically. Reuse the saved-Safe list design and schema; add explicit import if needed. No backend or hidden request to safe.wei is needed for links.

## Phase 1 copy record

Copied the sibling's current UI/CSS, ABI/keccak, ABI coder, labels/storage, wallet/RPC, chains/names/selectors and build/dev/fork/deploy patterns. UI and CSS started verbatim; UI/storage/name strings now use roles.wei. No WalletConnect client or fallback RPC is included. Build IDs hash source files deterministically; the resource guard rejects network loader primitives and remote assets while permitting ordinary gateway navigation links. The harness now lives locally and uses the working Ethereum archive default. The ERC-8244 contract is renamed RolesWeiApp with the same immutable chunk assembly. The user's DESIGN.md revision uses plain paragraphs for role explanations.

The phase-1 copy was taken from safe.wei commit `80ba91f19e20950c9c0f0720c1e380d7f61eef3e` (newer than the phase-0 research baseline). Phase-1 validation: ABI encoding/canonical-decoding reference test passed; real typing in the Home and label inputs, wallet connection/continuation and returning Home verified with the Anvil browser wallet. The 49,254-byte page was deployed on the local fork and `html()` matched byte for byte. No mainnet deployment was performed.
