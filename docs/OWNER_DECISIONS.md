# Owner Decision Gate

These choices affect chain contract semantics and the core workflow model. They are intentionally not inferred from implementation detail.

## A. Botchain AA contract strategy

Recommendation: choose a minimal Botchain-specific session account + factory.

Why: Botchain has no deployed KTrace compatibility burden. The legacy V3 account contains owner-signed UserOperation and direct-call surfaces that conflict with the new session-key-only normal path. Removing those behaviors from a smaller contract makes the invariant easier to review and test.

Alternative: pin `KTraceAccountV3SessionExecute.sol` and `KTraceAccountFactoryV2.sol` at legacy commit `410bc41...`, then tighten them behind a symbol/behavior allowlist. This retains more job functionality but carries a larger audit and regression surface.

Owner question: minimal Botchain account, or pin-and-tighten legacy V3?

## B. Workflow source of truth

Recommendation: explicit commerce/job state machines plus a separate append-only audit/evidence log.

Why: it keeps settlement release and job transition rules visible in pure domain state, while allowing the storage/evidence format to evolve. It also avoids making an experimental event schema the irreversible source of truth before multi-writer requirements exist.

Alternative: event-sourced workflow state. This is stronger when replay/multi-writer requirements are already concrete, but none are approved in the current scope.

Owner question: explicit state machines + audit log, or event-sourced truth?

## Approval scope

Either answer approves only local code, tests, dry-run and read-only verification. It does not approve deployment, funding, transfer, session setup or UserOperation submission.
