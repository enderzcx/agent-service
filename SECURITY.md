# Security Policy

## Current security boundary

This repository is pre-release and supports only local verification and live read-only Botchain probes. Do not use it to custody funds or sign/send transactions.

Report vulnerabilities privately to the repository owner rather than opening an issue with exploit details.

## Chain-write policy

- Deployments, transfers, approvals, bridge deposits, contract configuration and UserOperation submission are denied by default.
- The current `WriteGate` has no enable path.
- A future enable path requires explicit Owner approval for the exact testnet action and a reviewed bounded capability. An environment flag alone is insufficient.
- Normal operations must be signed by a session key inside ERC-4337 v0.7. Backend signing, owner normal-operation signing and EOA relay fallback are forbidden.
- Owner authority is limited to approved setup plus session authorization/revocation and permission configuration. Account v1 is non-upgradeable, has an immutable Owner, and intentionally has no recovery path.
- Session token transfers consume cumulative per-token budgets. Generic calls consume target-and-selector call counts; neither path can send native value.
- Monetary inputs never accept JavaScript `number` or an implicit decimals default. Asset identity, decimals and uint256 bounds are checked before AA calldata encoding; persisted raw units are strings.

## Secrets

- Never commit private keys, mnemonics, API tokens, cookies, `.env` files, deployment credentials or funded wallet material.
- `.env.example` contains public, non-secret selectors only.
- `npm run check:secrets` scans tracked and unignored candidate files for high-confidence credential patterns.
- Generated runtime data and collaborator job state are ignored.

## Evidence truthfulness

Every artifact carries a verification level. A dry-run or read-only artifact must not include a successful real transaction claim. `OWNER_APPROVED_TESTNET_WRITE` requires an approved action plus RPC receipt/event-log evidence; an explorer page alone is insufficient.

Workflow audit records are append-only and independent from aggregate truth. Simulation receipts are canonical-hashed and force transaction/UserOperation hashes to null; service-simulator exceptions cannot produce a success receipt.

## Supported versions

There is no supported production release yet. Security fixes land on the active development branch until a release policy is declared.
