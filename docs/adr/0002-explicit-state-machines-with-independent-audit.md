---
status: accepted
---

# Keep workflow truth in explicit state machines

Commerce Run and Job state live in explicit aggregates, while a separate append-only Audit Event log records commands and transitions. Aggregate records—not audit replay—are loaded before every command, and the Store rejects audit updates. Event sourcing was rejected because no approved replay or multi-writer requirement justifies making an experimental event schema irreversible; cross-record transactions and multi-writer recovery remain outside the current file adapter.
