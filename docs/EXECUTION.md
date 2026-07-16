# Botchain rebuild execution roadmap

This is the persistent progress artifact. Status vocabulary is strict:

- `attempted`: implementation exists but checker evidence is incomplete;
- `verified`: deterministic checks or external system evidence passed;
- `blocked`: an evidence-backed Owner or external gate prevents progress;
- `not_verified`: deliberately not claimed.

## Progress compass

位置：Final review / L1 two-axis code review / T1 evidence and residual-risk audit / next

总图：G0-G2 已由远端 CI 验证；G3 代码侧实现与本地证据完成，待远端 CI 和最终双轴审查

状态：Done 6 / Doing 0 / Todo 0 / Blocked 1

## Stage matrix

| Stage | Scope | Acceptance | Status | Evidence |
|---|---|---|---|---|
| S1 Source audit | handoff, rules, legacy references, live assumptions | migration map and explicit boundaries | verified | read-only audit; legacy status unchanged |
| S2 G0 | engineering baseline, locked profile, read-only preflight, deny-all WriteGate, CI | unknown/mixed profile rejects; Botchain probe has no legacy strings; preflight cannot write | verified | `npm run check`: 23 tests + lint/typecheck/build/secret scan; live preflight: chain 968, EntryPoint/USDT hashes, decimals 6, `canWrite=false`; GitHub Actions run `29488347741`: success |
| S3 G0.5 | fingerprint-scoped memory/file stores | every artifact/cache/session/job path and envelope rejects wrong fingerprint | verified | shared memory/file adapter contract; full SHA-256 physical namespace; 34 tests; profile/path/fingerprint/revision negatives; atomic file write; package dry-run plus isolated exports/bin install; pre-G1 profile fingerprint `sha256:900388...c14fe`; 0 audit vulnerabilities; GitHub Actions runs `29488622184`, `29488776211`, and review-repair run `29489421663`: success; final annotations empty |
| S4 G1 | AA contract, factory, local tests, local deployment/UserOp dry-run, bundler estimate | three-layer session-only fail closed; no send path | verified | commit `a4f91d9`; direct non-upgradeable CREATE2 Factory/Account; 8 Solidity + 39 TypeScript tests; standard ERC-7769 serialization; full `npm run check`; isolated installed-package verification; live fingerprint `sha256:2412e0...d23af6`; live estimate reached Botchain and honestly returned `AA20 account not deployed` / RPC `-32521`, `canWrite=false`, Account readiness `not_verified`; 0 audit vulnerabilities; GitHub Actions run `29490936769`: success; annotations empty |
| S5 G2 | chain-scoped bigint amount model | 6-decimal semantics across budgets/settlement/receipt; 18-decimal negative/compat tests | verified | commit `b30f088`; public `AssetAmount`; strict decimal parsing/formatting; schema-versioned raw-string storage; checked same-asset arithmetic and uint256 bounds; Session AA rejects native/same-asset-18-decimal inputs; 5 focused tests; full `npm run check`: 44 TypeScript + 8 Solidity tests; isolated installed-package amount import; live read-only estimate regression; 0 audit vulnerabilities; GitHub Actions run `29491372895`: success; annotations empty |
| S6 G3 | commerce and job state, receipt/evidence/audit | fixture end-to-end proof; real write paths remain not verified without approval | verified | explicit Commerce Run + Job state machines; persisted-state invariants; append-only audit Store contract; injected service simulator and failure stop; SessionOperation/amount/profile binding; canonical receipt hash; memory + atomic-file fixture tests; full `npm run check`: 57 TypeScript + 8 Solidity tests; isolated installed-package workflow import; actual ignored artifact readback: identity 1, negotiation 1, workflow 1, job 1, UserOperation 1, service result 1, receipt 1, evidence 3, audit 11; receipt `sha256:b0be1a...a25315e` recomputed true; transaction/UserOperation hashes null; live preflight and AA estimate regression; 0 audit vulnerabilities; remote CI pending |

## Verification ceiling without chain-write approval

- G1 code/dry-run: verified through `READONLY_BUNDLER_ESTIMATE`; deployment, setup and inclusion remain `not_verified`.
- G3 local fixture: `DRY_RUN_SIMULATED`; real settlement/inclusion: `not_verified`.
- Full testnet cutover: `HOLD_FULL_TESTNET`.

## Review closure

- Standards and spec review found path traversal/truncated namespace, mixed profile metadata, misleading `.env` instructions, and missing isolated-package verification.
- Fixes are locally verified by `npm run check`, dependency audit, isolated installed-package exports/bin execution, and a fresh Botchain read-only preflight.
- Review-repair commit `b2ece7d` passed GitHub Actions run `29489421663`; both review axes report no remaining P0-P2 findings.
- The repeated memory/file adapter CRUD shape is accepted as low-risk duplication for G0.5 because shared contract tests own behavioral parity; it can be consolidated when a database adapter is introduced.

## Next gate

Run the required final two-axis code review, repair all P0-P2 findings, rerun the full local/live-readonly/remote verification chain, then issue the code-side GO versus full-testnet HOLD decision and the minimal Owner-approved write checklist. No deployment or submission is authorized.
