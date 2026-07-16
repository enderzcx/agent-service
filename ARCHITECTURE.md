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

The accepted implementation is a minimal, non-upgradeable `BotchainSessionAccount` deployed by a direct CREATE2 `BotchainSessionAccountFactory`. The immutable Owner may authorize/revoke Sessions and configure cumulative token budgets or target-selector call counts. Normal execution is EntryPoint-only, validation accepts only the configured Session key, native-value execution is absent, and session IDs/action IDs cannot be replayed.

The TypeScript seam constructs the two allowed account calls, binds every draft to the Runtime Profile fingerprint and EntryPoint, emits ERC-7769 `factory`/`factoryData` fields for bundler estimation, and exposes no submission method. A submission intent can only reach the deny-all `WriteGate`.

### AgentWorkflow

Interface: advance explicit commerce and job states through identity, negotiation, settlement and execution ports; return typed receipt/evidence.

Commerce Run and Job truth live in explicit state machines. A separate append-only Audit Event log records commands and transitions but cannot reconstruct or override aggregate state. This keeps evidence storage from becoming a hidden event-sourced domain model.

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
| Settlement | session-only AA after approved deployment/setup | deterministic dry-run | no proof -> no execution |
| Service executor | pending | fixture executor | failure -> failed receipt, never success |

## Data and concurrency

- G0.5 data root: `${KTRACE_DATA_DIR}/<full-profile-namespace>/...`.
- Runtime envelopes include schema version, profile fingerprint, namespace, artifact kind, ID and verification level.
- Atomic temp-file + rename protects one writer from partial files.
- Cross-process locking, database transactions and multi-writer idempotency are not claimed in the initial file adapter. Adding them is a separate G3 design/release gate.
- Existing Kite/HashKey records are not rewritten or imported.

## Accepted decisions and remaining gate

Ender accepted the minimal direct CREATE2 Session Account and explicit state-machine/independent-audit architecture on 2026-07-16. The remaining Owner gate is operational: the exact Factory deployment, Account creation, Session setup, funding/transfer limits and UserOperation submission must be approved separately before any Botchain write.

## Rollback

Every stage is a separate commit. Code rollback is `git revert <stage-commit>`. No data migration or chain write occurs before explicit approval, so code-side G0-G3 rollback has no external-state rollback requirement.
