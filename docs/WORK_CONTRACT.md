# Work Contract: Botchain migration and architecture rebuild

## Intent

Build a clean, public Agent Service that reaches code-side G0-G3 readiness for Botchain testnet without importing legacy runtime state or executing unapproved chain writes.

## Phase and gravity

- Phase: Production Lane engineering, pre-release.
- Gravity: G3 because chain identity, funds, signing authority, isolation and evidence semantics are involved.
- Handoff: AFK inside the written boundary; HITL at named Owner gates.

## Fixed decisions

- Node.js + strict TypeScript, backend/SDK/CLI first.
- Botchain testnet is `eip155:968`; locked values are in `src/chain/profile.ts`.
- Unknown or mixed profiles fail closed.
- Existing Kite/HashKey data is neither copied nor rewritten.
- Normal AA path is session-key UserOperation only.
- No deployment, funding, transfer, approval, bridge or other chain write without exact Owner approval.
- Verification claims distinguish local, dry-run, read-only and approved testnet-write evidence.

## Owner Decision Gate

State: `clear` for G0 and G0.5; `owner-decision-required` before G1 contract implementation and G3 domain source-of-truth lock.

Recommendation:

- choose a minimal Botchain-specific session account/factory because there is no deployed Botchain compatibility burden and the legacy account exposes broader owner/direct-call behavior;
- choose explicit commerce/job state machines plus an independent append-only audit log.

Reopen condition: new source audit shows a reviewed legacy contract has equivalent session-only invariants, or a concrete multi-writer requirement makes event sourcing materially safer.

## Boundaries

Allowed:

- files in this repository;
- read-only legacy source inspection;
- tests, local contract execution, deterministic dry-runs;
- read-only Botchain RPC/bundler/explorer calls;
- commits and pushes of verified slices.

Forbidden:

- writes to the legacy repository;
- secrets or runtime artifacts in git;
- public HTTP API lock-in or frontend expansion;
- any chain write before the exact Owner gate;
- claiming dry-run evidence as real testnet inclusion.

## Skill and collaborator routing

- `init`, `codebase-design`, `implement`, `tdd`: baseline and vertical implementation.
- `grok-companion`: one pre-decision adversarial review, job `20260716-173301-adversarial-review-34003e71`.
- `verification-evidence-pack`: stage closeout proof.
- `code-review`: required before final implementation closeout.
- Memory recall: local memory index/rollout plus `nmem wm/search`; save: none without Ender approval.

## Evidence and verified-state ownership

Deterministic tests, lint, typecheck, build, secret scan, live read-only preflight, GitHub Actions terminal result, and later local contract tests own verification state. Maker text alone may only say `attempted` or `changed`.

## Human approval gates

| Gate | Required decision |
|---|---|
| G1 design lock | legacy V3 pin+tighten vs minimal Botchain session account |
| G3 design lock | event-sourced truth vs explicit state machines + independent audit |
| Testnet write | exact contracts/actions/wallets/maximum amounts and evidence plan |
| Release/cutover | residual risks and GO/HOLD decision |

## Stop conditions

- a locked chain fact fails live verification;
- implementation would cross either pending design lock;
- a required proof needs a secret, funded account or unapproved external write;
- verification fails and cannot be resolved within the approved stage.
