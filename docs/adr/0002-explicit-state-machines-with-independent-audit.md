---
status: accepted
---

# Keep workflow truth in explicit state machines

Commerce Run and Job state live in explicit aggregates, while a separate append-only Audit Event log records commands and transitions. Event sourcing was rejected because no approved replay or multi-writer requirement justifies making an experimental event schema irreversible; audit storage must therefore never become the hidden source of domain truth.
