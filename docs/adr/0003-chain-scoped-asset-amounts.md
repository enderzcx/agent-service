---
status: accepted
---

# Represent asset amounts as scoped raw units

Every monetary value carries canonical asset identity, decimals, and unsigned `bigint` raw units. Decimal text is parsed strictly at the boundary and storage uses a schema-versioned raw decimal string; JavaScript `number`, scientific notation, implicit 18-decimal defaults, cross-asset arithmetic, and uint256 overflow are rejected.
