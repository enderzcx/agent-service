# Runbook

## Purpose

Operate the current local/read-only Agent Service safely. There is no deployment or production environment in scope yet.

## Prerequisites

- Node.js 22+
- npm 10+
- outbound HTTPS access for optional live preflight

## Cold start

```bash
git clone https://github.com/enderzcx/agent-service.git
cd agent-service
npm ci
npm run check
KTRACE_CHAIN_PROFILE=botchain_testnet npm run profile:show
```

The CLI does not auto-load `.env`. Operators must make the selected profile explicit in the calling process.

## Live read-only preflight

```bash
KTRACE_CHAIN_PROFILE=botchain_testnet npm run preflight
```

Expected successful boundary:

- command exits `0`;
- `status = ready_for_dry_run`;
- `canWrite = false`;
- chain IDs are `968`;
- EntryPoint v0.7 and USDT code hashes/decimals match the locked profile.

This result is not permission to deploy or send a UserOperation.

## G1 local and read-only verification

```bash
npm run contracts:test
KTRACE_CHAIN_PROFILE=botchain_testnet npm run aa:estimate:probe
```

The contract command deploys Factory/Account only inside Hardhat's ephemeral local EVM. The estimate probe calls only `eth_estimateUserOperationGas` through the read-only RPC allowlist. Until an approved Botchain deployment exists, `bundler_rejected` / `AA20 account not deployed` is expected and must not be relabeled as Account readiness.

## Common failures

| Code | Meaning | Action |
|---|---|---|
| `chain_profile_required` | no explicit profile | set `KTRACE_CHAIN_PROFILE=botchain_testnet` |
| `legacy_chain_environment_forbidden` | legacy Kite/HashKey variables are present | remove them from this process; do not map them |
| `chain_profile_locked_override` | endpoint/address/decimals differ | stop and review; do not bypass the lock |
| `chain_preflight_chain_id_mismatch` | RPC or bundler is on another chain | stop; verify endpoint ownership and DNS |
| `chain_preflight_code_hash_mismatch` | deployed code differs from the profile | stop; treat as a chain/deployment incident |
| `chain_write_not_authorized` | a write reached the gate | expected until exact Owner approval and a reviewed capability exist |

## Rollback

Code-side G0-G3 have no external writes. Revert the relevant stage commit and delete only new ignored local `.runtime/` data if desired. Never modify or migrate legacy runtime data as part of rollback.
