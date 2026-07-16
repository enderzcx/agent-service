# Legacy-to-clean migration map

The legacy worktree was audited read-only at commit `410bc41b0f00c7acf7805e5b8ff73e12910dce35`. Existing uncommitted user changes are not source-controlled inputs to this repository unless a file and behavior are explicitly pinned.

| Legacy surface | Finding | Clean target |
|---|---|---|
| `backend/lib/chainRuntimeProfile.js` | useful G0 seed, but permits a legacy Kite default and leaves AA addresses empty | `src/chain/profile.ts`: one explicit locked profile, no default |
| `backend/scripts/verify-chain-runtime-profile.mjs` | verifies profile and x402 serialization, but mixes several historical networks | interface tests under `tests/chain/` |
| `backend/cli/runtimeConfig.js` | defaults CLI to Kite | read-only `src/cli.ts`, explicit selector required |
| `backend/runtime/config.js` | centralizes settings but writes every store into flat `data/` | `ChainRuntime` + G0.5 `ProfileStore` |
| `backend/cli/lib/sessionRuntime.js` | real AA session entry; contains 18-decimal budgets and a HashKey direct-call branch | G1 `SessionAA`, no EOA/direct-call normal path |
| `backend/services/aaSessionRuntime.js` | referenced by the handoff but absent from the legacy tree | no migration source; do not invent compatibility |
| `backend/lib/gokite-aa-sdk.js` | useful v0.7/userOp logic; local address fallback used the wrong initializer shape | clean ERC-7769 Session AA builder, no inherited fallback |
| `backend/contracts/KTraceAccountV3SessionExecute.sol` | clean tracked source, but broad owner/direct-call behavior conflicts with the accepted invariant | rejected; minimal Botchain Session Account implemented independently |
| `backend/contracts/KTraceAccountFactoryV2.sol` | useful CREATE2 reference but tied to the legacy proxy implementation | rejected; direct non-upgradeable CREATE2 Factory implemented independently |
| `backend/lib/x402WorkflowHelpers.js` | historical scheme names and default decimals were chain-sensitive | G2 chain-scoped amount/settlement types |
| `backend/services/persistenceStore.js` | document store returns null/false on DB errors and has no profile key invariant | fail-closed adapters behind `ProfileStore` |
| flat JSON runtime stores | records, x402, sessions, jobs, workflows, evidence and caches share one directory | fingerprint namespace plus typed envelopes |
| receipt/evidence/job routes | valuable field vocabulary, but transport and persistence are intertwined | explicit domain state plus independent evidence adapter |

## Protected legacy state

The audit performed no write, reset, clean, install, build or format command in the legacy repository. Its dirty status before and after the audit was unchanged.
