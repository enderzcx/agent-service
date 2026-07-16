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
cp .env.example .env
npm run check
KTRACE_CHAIN_PROFILE=botchain_testnet npm run profile:show
```

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

G0/G0.5 have no external writes. Revert the stage commit and delete only the new ignored local `.runtime/` directory if desired. Never modify or migrate legacy runtime data as part of rollback.
