# BMS cross-system certification packet

Owners: BMS Architecture, Commerce Owner and Inventory Owner. Approve the service principal,
producer/consumer contract, tenant/branch derivation, order authority, stock/handoff authority,
customer tracking permission and reconciliation ownership. Fleet Delivery must never become the
authority for BMS commerce, stock or payment facts.

Exercise create/retry, duplicate event, delayed event, missed event, handoff, cancellation and
reconciliation in non-production. Evidence must prove idempotent convergence, no double stock or
money mutation, backward compatibility and an operator-owned repair path.
