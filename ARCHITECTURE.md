# Architecture

## System overview

Agent Service is a backend/SDK/CLI core for one auditable path:

```text
identity -> negotiation -> settlement -> service execution -> receipt/evidence/audit
                                                          -> job lifecycle
```

Botchain identity is explicit and immutable within a runtime instance. Network configuration, persistence, money, AA execution, and evidence all carry the same profile fingerprint. Unknown or mixed identities fail closed.

No HTTP public contract is fixed in the current stage. The first interfaces are TypeScript modules and a read-only CLI so architecture can be verified without accidentally committing to a transport shape.

## Keystone surface

| Surface | Gravity | Irreversible or high-impact behavior |
|---|---:|---|
| `ChainRuntime` | G3 | Selects the chain, EntryPoint, asset and namespace identity |
| `WriteGate` | G3 | Controls every transaction, deployment, approval, bridge and UserOperation submission |
| `ProfileStore` | G3 | Prevents cross-chain/profile data and evidence contamination |
| `SessionAA` | G3 | Builds and validates session-key-only ERC-4337 v0.7 operations |
| `AgentWorkflow` | G3 | Controls settlement release, service execution and job transitions |
| `Evidence` | G3 | Separates local/dry-run/read-only facts from approved on-chain proof |
| kernel value types | G2 | Chain-scoped money, verification level, idempotency and identifiers |
| CLI adapters | G1 | Expose approved module interfaces without owning domain rules |

## Deep modules and seams

### ChainRuntime

Interface: resolve one explicit locked profile, derive its canonical fingerprint/namespace, and run a read-only preflight.

Implementation hides selector normalization, locked override checks, read-only JSON-RPC allowlisting, code/hash/decimals checks, and error classification. `ready_for_dry_run` always returns `canWrite: false`.

### WriteGate

Interface: `assertAllowed(writeIntent)`.

The shipped adapter always denies. A future allow adapter requires a separately approved design with an Owner-issued, action/profile/expiry/amount-bounded capability plus a second runtime control. No caller may bypass this seam.

### ProfileStore

Interface: create/read/list typed envelopes within one materialized profile identity.

Each envelope and physical namespace must match the full fingerprint of `{schema, profile, chain, RPC, bundler, explorer, EntryPoint address/code hash, settlement asset address/code hash/decimals, AA deployment identity, signing policy}`. G0.5 provides memory and atomic-file adapters; multi-writer support is not claimed.

### SessionAA

Interface: build and locally validate a session-key ERC-4337 v0.7 UserOperation, then hand any submission intent to `WriteGate`.

Contract choice is intentionally not locked yet. See Pending Owner Decisions. No G1 implementation may silently carry over owner/EOA normal execution.

### AgentWorkflow

Interface: advance explicit commerce and job states through identity, negotiation, settlement and execution ports; return typed receipt/evidence.

Whether state is event-sourced or held in explicit state machines is an Owner decision. The current recommendation is explicit state machines with a separate append-only audit log so evidence storage does not become the hidden source of truth.

### Evidence

Interface: construct a proof bundle whose variant is determined by `VerificationLevel`.

Dry-run/read-only variants cannot contain successful real transaction claims. Testnet-write variants require Owner approval plus transaction receipt/event-log evidence. Explorer links are secondary cross-checks, never the sole proof source.

## External ports

| Port | Production adapter | Test adapter | Failure rule |
|---|---|---|---|
| Chain RPC | HTTPS JSON-RPC | fixture RPC | mismatch/unavailable -> fail closed |
| Bundler RPC | HTTPS ERC-4337 RPC | fixture bundler | wrong chain/EntryPoint -> fail closed |
| Store | atomic local files initially | in-memory | fingerprint mismatch -> reject |
| Identity | pending | deterministic fake | unverified -> no negotiation |
| Settlement | pending session AA | deterministic dry-run | no proof -> no execution |
| Service executor | pending | fixture executor | failure -> failed receipt, never success |

## Data and concurrency

- G0.5 data root: `${KTRACE_DATA_DIR}/<full-profile-namespace>/...`.
- Runtime envelopes include schema version, profile fingerprint, namespace, artifact kind, ID and verification level.
- Atomic temp-file + rename protects one writer from partial files.
- Cross-process locking, database transactions and multi-writer idempotency are not claimed in the initial file adapter. Adding them is a separate G3 design/release gate.
- Existing Kite/HashKey records are not rewritten or imported.

## Pending Owner decisions

1. AA contract strategy:
   - pin and tighten legacy KTrace V3 Account + FactoryV2; or
   - implement a minimal Botchain-specific session account/factory.
2. Workflow source of truth:
   - event-sourced workflow state; or
   - explicit commerce/job state machines plus an independent audit/evidence log.

Implementation stops before these design locks. The current recommendation and tradeoffs live in `docs/OWNER_DECISIONS.md`.

## Rollback

Every stage is a separate commit. Code rollback is `git revert <stage-commit>`. No data migration or chain write occurs before explicit approval, so G0/G0.5 rollback has no external-state rollback requirement.
