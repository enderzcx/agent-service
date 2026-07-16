# Agent Service

Fail-closed Botchain agent runtime for auditable agent commerce and job execution.

The repository is being rebuilt from a legacy KTrace implementation as small, independently verified slices. It does not inherit Kite or HashKey defaults, runtime data, secrets, or generated artifacts.

## Current boundary

- Target: BOT Chain testnet (`eip155:968`).
- Runtime: Node.js 22+ and strict TypeScript.
- CLI commands are read-only. The exported Session AA SDK builds/dry-runs operations and exposes no send method.
- Chain writes are denied in code. There is no deploy, transfer, approve, bridge, or UserOperation send command.
- G1 includes a minimal non-upgradeable direct CREATE2 Factory/Account and local EVM tests; neither contract is deployed on Botchain yet.
- Monetary APIs use chain-scoped `AssetAmount` values (`assetId`, `decimals`, raw `bigint`); Botchain USDT is six decimals and no 18-decimal fallback exists.
- A green read-only preflight proves only `ready_for_dry_run`; it does not prove that contracts are deployed or that a payment was included on-chain.
- Full testnet migration remains `HOLD_FULL_TESTNET` until Owner-approved write evidence closes G1-G3.

See [the execution roadmap](docs/EXECUTION.md) for stage status and [the architecture](ARCHITECTURE.md) for module seams and accepted Owner decisions.

## Quick start

```bash
npm ci
KTRACE_CHAIN_PROFILE=botchain_testnet npm run profile:show
npm test
npm run check
```

The CLI deliberately does not auto-load `.env`; pass the profile selector explicitly or load a reviewed environment in the calling process.

Run the live, read-only Botchain probe explicitly:

```bash
KTRACE_CHAIN_PROFILE=botchain_testnet npm run preflight
```

The probe checks the locked RPC and bundler chain IDs, canonical ERC-4337 v0.7 EntryPoint address/code hash, settlement token address/code hash/decimals, and the finalized block surface. It never calls a send method.

Run the explicit G1 bundler estimate probe:

```bash
KTRACE_CHAIN_PROFILE=botchain_testnet npm run aa:estimate:probe
```

Before Factory/Account deployment, the expected honest result is `status = bundler_rejected` with `AA20 account not deployed`, `canWrite = false`, and `accountReadiness = not_verified`. This proves the standard ERC-7769 request reached Botchain validation; it does not prove Account readiness or authorize submission.

## Verification levels

| Level | Meaning |
|---|---|
| `LOCAL_UNIT` | Deterministic local code or contract test |
| `DRY_RUN_SIMULATED` | Locally constructed or simulated transaction/UserOperation |
| `READONLY_RPC` | Live read-only chain/bundler observation |
| `READONLY_BUNDLER_ESTIMATE` | Bundler validation/estimate without submission |
| `OWNER_APPROVED_TESTNET_WRITE` | Explicitly approved testnet write with receipt/log evidence |

Without explicit Owner approval, this project may not claim the last level.

## Engineering commands

```bash
npm run lint
npm run typecheck
npm run contracts:test
npm test
npm run build
npm run verify:package
npm run check:secrets
npm run check
```

Solidity is compiled with `solc 0.8.28`, optimizer runs `200`, and EVM target `paris`; dependencies are exact-pinned in `package-lock.json`.

Persist amounts through `serializeAssetAmount` / `deserializeAssetAmount`; raw units are stored as decimal strings because JSON cannot losslessly encode `bigint` directly.

Operational and security boundaries are in [RUNBOOK.md](RUNBOOK.md) and [SECURITY.md](SECURITY.md).
