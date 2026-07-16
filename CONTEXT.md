# Agent Service

Agent Service coordinates session-authorized agent commerce on one explicitly identified chain profile while keeping execution claims auditable and verification-bounded.

## Chain and authority

**Runtime Profile**:
The complete, immutable identity of a chain runtime, including endpoints, contracts, assets, signing policy, and its full fingerprint.
_Avoid_: Network config, chain settings

**Session Account**:
An ERC-4337 account whose normal operations are authorized only by an active, bounded Session; its Owner can configure or revoke authority but cannot sign normal UserOperations.
_Avoid_: Wallet, proxy account, owner wallet

**Owner**:
The immutable configuration authority of a Session Account; v1 has no upgrade or recovery path.
_Avoid_: Normal signer, backend signer, upgrade admin

**Session**:
A time-bounded authority granted to one session key with explicit token budgets and target-selector call permissions.
_Avoid_: API key, owner key

**UserOperation**:
An ERC-4337 v0.7 operation validated by the Session Account and handled by the locked EntryPoint.
_Avoid_: Transaction, relay request

## Commerce and evidence

**Commerce Run**:
One identity-to-negotiation-to-settlement-to-service lifecycle governed by an explicit state machine.
_Avoid_: Workflow event stream, order

**Settlement**:
The chain-scoped transfer obligation agreed for a Commerce Run, represented as raw bigint units plus explicit asset identity and decimals.
_Avoid_: Floating amount, payment number

**Job**:
A service-execution lifecycle associated with a Commerce Run and governed by its own explicit state machine.
_Avoid_: Background task, queue item

**Receipt**:
The terminal result of a service or simulation, including its verification level and referenced Evidence.
_Avoid_: Log line, transaction claim

**Evidence**:
A typed fact whose allowed claims are bounded by its verification level.
_Avoid_: Proof without level, explorer link

**Audit Event**:
An append-only record of a command and resulting state transition; it is independent evidence and is not the source of workflow truth.
_Avoid_: Domain event source, mutable activity log
