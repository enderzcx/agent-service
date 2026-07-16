---
status: accepted
---

# Use a direct CREATE2 session-only account

Botchain AA uses a minimal, non-upgradeable Account deployed directly by a CREATE2 Factory. The Owner may authorize and revoke bounded Sessions, but normal ERC-4337 validation accepts only session-key signatures and execution is EntryPoint-only; this rejects the legacy V3 owner-signature, direct-call, proxy-upgrade, and backend-fallback surfaces because Botchain has no deployed compatibility burden. Local compatibility is owned by an exact-pinned `@account-abstraction/contracts@0.7.0` reference EntryPoint `handleOps` integration; a counterfactual Factory is usable only after its reviewed address is locked in the active Runtime Profile.
