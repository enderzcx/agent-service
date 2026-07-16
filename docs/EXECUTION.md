# Botchain rebuild execution roadmap

This is the persistent progress artifact. Status vocabulary is strict:

- `attempted`: implementation exists but checker evidence is incomplete;
- `verified`: deterministic checks or external system evidence passed;
- `blocked`: an evidence-backed Owner or external gate prevents progress;
- `not_verified`: deliberately not claimed.

## Progress compass

位置：Final review repair / L2 local verification complete / T1 remote CI / next

总图：G0-G3 已由远端 CI 验证；最终双轴审查 P0-P2 已在本地关闭，待 repair commit 远端 CI

状态：Done 6 / Doing 1 / Todo 0 / Blocked 1

## Stage matrix

| Stage | Scope | Acceptance | Status | Evidence |
|---|---|---|---|---|
| S1 Source audit | handoff, rules, legacy references, live assumptions | migration map and explicit boundaries | verified | read-only audit; legacy status unchanged |
| S2 G0 | engineering baseline, locked profile, read-only preflight, deny-all WriteGate, CI | unknown/mixed profile rejects; Botchain probe has no legacy strings; preflight cannot write | verified | `npm run check`: 23 tests + lint/typecheck/build/secret scan; live preflight: chain 968, EntryPoint/USDT hashes, decimals 6, `canWrite=false`; GitHub Actions run `29488347741`: success |
| S3 G0.5 | fingerprint-scoped memory/file stores | every artifact/cache/session/job path and envelope rejects wrong fingerprint | verified | shared memory/file adapter contract; full SHA-256 physical namespace; 34 tests; profile/path/fingerprint/revision negatives; atomic file write; package dry-run plus isolated exports/bin install; pre-G1 profile fingerprint `sha256:900388...c14fe`; 0 audit vulnerabilities; GitHub Actions runs `29488622184`, `29488776211`, and review-repair run `29489421663`: success; final annotations empty |
| S4 G1 | AA contract, factory, local tests, local deployment/UserOp dry-run, bundler estimate | three-layer session-only fail closed; no send path | verified | commit `a4f91d9`; direct non-upgradeable CREATE2 Factory/Account; exact-pinned reference EntryPoint v0.7 `handleOps` integration now verifies signed Session execution/action/call-limit consumption on local Hardhat; canonical Operation revalidation and profile-locked Factory initCode; standard ERC-7769 serialization; live fingerprint `sha256:2412e0...d23af6`; live estimate reached Botchain and honestly returned `AA20 account not deployed` / RPC `-32521`, `canWrite=false`, Account readiness `not_verified`; original GitHub Actions run `29490936769`: success; final repair CI pending |
| S5 G2 | chain-scoped bigint amount model | 6-decimal semantics across budgets/settlement/receipt; 18-decimal negative/compat tests | verified | commit `b30f088`; public `AssetAmount`; strict decimal parsing/formatting; schema-versioned raw-string storage; checked same-asset arithmetic and uint256 bounds; Session AA rejects native/same-asset-18-decimal inputs; 5 focused tests; full `npm run check`: 44 TypeScript + 8 Solidity tests; isolated installed-package amount import; live read-only estimate regression; 0 audit vulnerabilities; GitHub Actions run `29491372895`: success; annotations empty |
| S6 G3 | commerce and job state, receipt/evidence/audit | fixture end-to-end proof; real write paths remain not verified without approval | verified | explicit Commerce Run + Job state machines; persisted-state invariants; append-only audit Store contract; injected service simulator and failure stop; decoded SessionOperation/amount/profile binding; uint256-valid persisted amounts; canonical receipt hash; memory + atomic-file fixture tests; original artifact readback: identity 1, negotiation 1, workflow 1, job 1, UserOperation 1, service result 1, receipt 1, evidence 3, audit 11; transaction/UserOperation hashes null; GitHub Actions run `29492264009`: success; annotations empty; final repair local fixture receipt `sha256:cce6c4...0573d2f`, repair CI pending |

## Verification ceiling without chain-write approval

- G1 code/dry-run: verified through `READONLY_BUNDLER_ESTIMATE`; deployment, setup and inclusion remain `not_verified`.
- G3 local fixture: `DRY_RUN_SIMULATED`; real settlement/inclusion: `not_verified`.
- Full testnet cutover: `HOLD_FULL_TESTNET`.

## Review closure

### Final G0-G3 two-axis review

- Spec axis: no P0; one P1 found forged settlement calldata could still produce a hash-valid success receipt; one P2 found no reference EntryPoint v0.7 `handleOps` integration.
- Standards axis: no P0; two P1 found the same structural Operation trust gap and overly broad green RPC-error classification; one P2 found persisted amounts could bypass uint256 checks. One P3 repeated-switch smell is accepted because transition exhaustiveness is test-owned and refactoring now would expand risk.
- Repairs: runtime calldata decode/canonical re-encode at draft/workflow boundaries; exact profile Factory/initCode binding; exact `AA20`/`-32521` probe classification; persisted/receipt amount revalidation; reference EntryPoint `0.7.0` successful `handleOps` test.
- Local verification: `npm run check` passes 61 TypeScript + 9 Solidity tests, reference `handleOps`, lint, typecheck, build, pack, isolated install and secret scan; `npm audit --audit-level=moderate` reports 0 vulnerabilities.
- Live read-only regression: Bundler returns the exact expected undeployed-account rejection; preflight first attempt had `rpc_transport_failed` on `eth_getBlockByNumber`, immediate second attempt passed chain 968, EntryPoint/USDT code hashes, USDT decimals 6 and finalized block with `canWrite=false`.
- Independent repair re-review: both spec and standards axes report P0-P2 clear and no repair-introduced P0-P2; the standards-axis P3 repeated-switch note remains accepted and deferred.

### Earlier G0.5 review

- Standards and spec review found path traversal/truncated namespace, mixed profile metadata, misleading `.env` instructions, and missing isolated-package verification.
- Fixes are locally verified by `npm run check`, dependency audit, isolated installed-package exports/bin execution, and a fresh Botchain read-only preflight.
- Review-repair commit `b2ece7d` passed GitHub Actions run `29489421663`; both review axes report no remaining P0-P2 findings.
- The repeated memory/file adapter CRUD shape is accepted as low-risk duplication for G0.5 because shared contract tests own behavioral parity; it can be consolidated when a database adapter is introduced.

## Next gate

Commit and push the final review repair, wait for terminal GitHub Actions evidence, then issue the code-side GO versus full-testnet HOLD decision and the minimal Owner-approved write checklist. No deployment or submission is authorized.
