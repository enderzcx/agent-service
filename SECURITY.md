# Security Policy

## Current security boundary

This repository is pre-release and supports only local verification and live read-only Botchain probes. Do not use it to custody funds or sign/send transactions.

Report vulnerabilities privately to the repository owner rather than opening an issue with exploit details.

## Chain-write policy

- Deployments, transfers, approvals, bridge deposits, contract configuration and UserOperation submission are denied by default.
- The current `WriteGate` has no enable path.
- A future enable path requires explicit Owner approval for the exact testnet action and a reviewed bounded capability. An environment flag alone is insufficient.
- Normal operations must be signed by a session key inside ERC-4337 v0.7. Backend signing, owner normal-operation signing and EOA relay fallback are forbidden.
- Owner authority is limited to setup, session authorization/revocation, upgrade/recovery decisions that are separately reviewed and approved.

## Secrets

- Never commit private keys, mnemonics, API tokens, cookies, `.env` files, deployment credentials or funded wallet material.
- `.env.example` contains public, non-secret selectors only.
- `npm run check:secrets` scans tracked and unignored candidate files for high-confidence credential patterns.
- Generated runtime data and collaborator job state are ignored.

## Evidence truthfulness

Every artifact carries a verification level. A dry-run or read-only artifact must not include a successful real transaction claim. `OWNER_APPROVED_TESTNET_WRITE` requires an approved action plus RPC receipt/event-log evidence; an explorer page alone is insufficient.

## Supported versions

There is no supported production release yet. Security fixes land on the active development branch until a release policy is declared.
