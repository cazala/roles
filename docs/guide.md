# Guide

Run `npm ci && npm run build` to create `dist/index.html`. Run `npm run fork` with an archive-capable `FORK_URL`, then `npm run dev -- --anvil http://127.0.0.1:8545` to use the development-only Anvil wallet. The normal `npm run dev` has no test wallet. Never use Anvil's public test keys with real funds.

Home searches addresses and labels saved in this browser. Paste a Safe or Roles address or a mainnet `.eth` / `.wei` name and select Open. Connect your browser wallet when prompted. Names use only onchain resolution through the wallet. Label addresses with the tag button; Remove has a local Undo action. Saved entries remember their chain.

Opening a Safe lists its enabled modules. Open a supported Roles 2.1.1 proxy to scan its history and inspect roles, members, targets and raw conditions. The scan runs in bounded windows, caches completed work and offers Pause and Scan / resume. History options accept a start block when archive reads fail; such a partial history is explicitly read-only. Reset cache discards cached events. Faulty and unknown versions remain identified without editing. All deployment/name changes on mainnet belong to the owner.
