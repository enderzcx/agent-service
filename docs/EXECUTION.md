# Botchain rebuild execution roadmap

This is the persistent progress artifact. Status vocabulary is strict:

- `attempted`: implementation exists but checker evidence is incomplete;
- `verified`: deterministic checks or external system evidence passed;
- `blocked`: an evidence-backed Owner or external gate prevents progress;
- `not_verified`: deliberately not claimed.

## Progress compass

位置：S2 G0 fail-closed runtime / L3 verification and commit / T3 stage closeout / G0 push gate

总图：整体第 2/6 阶段；本阶段第 3/3 小片

状态：Done 2 / Doing 0 / Todo 4 / Blocked 2

## Stage matrix

| Stage | Scope | Acceptance | Status | Evidence |
|---|---|---|---|---|
| S1 Source audit | handoff, rules, legacy references, live assumptions | migration map and explicit boundaries | verified | read-only audit; legacy status unchanged |
| S2 G0 | engineering baseline, locked profile, read-only preflight, deny-all WriteGate, CI | unknown/mixed profile rejects; Botchain probe has no legacy strings; preflight cannot write | verified | `npm run check`: 23 tests + lint/typecheck/build/secret scan; live preflight: chain 968, EntryPoint/USDT hashes, decimals 6, `canWrite=false`; `npm audit`: 0 vulnerabilities |
| S3 G0.5 | fingerprint-scoped memory/file stores | every artifact/cache/session/job path and envelope rejects wrong fingerprint | todo | pending G0 commit |
| S4 G1 | AA contract, factory, local tests, deployment/UserOp dry-run, bundler estimate | three-layer session-only fail closed; no send path | blocked | Owner contract-strategy decision required |
| S5 G2 | chain-scoped bigint amount model | 6-decimal semantics across budgets/settlement/receipt; 18-decimal negative/compat tests | todo | starts after G1 design lock |
| S6 G3 | commerce and job state, receipt/evidence/audit | fixture end-to-end proof; real write paths remain not verified without approval | blocked | Owner workflow-source-of-truth decision required |

## Verification ceiling without chain-write approval

- G1 maximum: `READONLY_BUNDLER_ESTIMATE`.
- G3 settlement/inclusion: `not_verified`.
- Full testnet cutover: `HOLD_FULL_TESTNET`.

## Next gate

Push G0, then implement and push G0.5. Stop before G1 contract implementation and ask the two questions in `docs/OWNER_DECISIONS.md`.
