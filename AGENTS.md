# Agent Service Project Rules

## Scope

This repository owns the clean Botchain agent-service implementation. The active execution contract is `docs/EXECUTION.md`; `ARCHITECTURE.md`, `SECURITY.md`, and `docs/WORK_CONTRACT.md` define the durable boundaries.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:package
npm run check:secrets
npm run check
KTRACE_CHAIN_PROFILE=botchain_testnet npm run preflight
```

## Non-negotiable invariants

- No implicit Kite, HashKey, or unknown-chain fallback.
- All runtime selectors and locked chain facts fail closed.
- Every persistent object is scoped by the full profile fingerprint, not chain ID alone.
- Human amounts never use JavaScript `number`; on-chain values use `bigint` plus explicit token decimals and chain-scoped asset identity.
- Normal AA execution is session-key UserOperation only. Backend/owner normal-operation signing and EOA relay fallback are forbidden.
- All chain writes must pass the global `WriteGate`; this repository currently ships only a deny-all implementation.
- Never add a deploy, transfer, approve, bridge, or send command without explicit Ender approval and a reviewed bounded write capability.
- Dry-run and read-only evidence must never contain or claim a real successful transaction proof.
- Secrets, private keys, `.env`, runtime stores, generated artifacts, and collaborator job state stay untracked.
- No frontend expansion unless Ender explicitly changes scope.

## Working style

- Use the smallest vertical slice and test through the public module interface.
- Run targeted tests while editing and `npm run check` before every commit.
- Update `docs/EXECUTION.md` only after deterministic verification; distinguish `attempted`, `verified`, `blocked`, and `not_verified`.
- Keep stages independently revertible. Do not squash G0, G0.5, G1, G2, and G3 into one commit.
- Treat the legacy repository as read-only reference material. Never bulk-copy its worktree or depend on its local runtime state.
