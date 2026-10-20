# Repository and cross-system owner approval request

Subject: Approval request: Fleet Delivery repository and BMS authority contracts

The following owner decisions are still mandatory in addition to the roles named in the feature
request:

- Repository Owner: author and approve the missing `RTK.md`; Engineering must not invent it.
- BMS Architecture: approve the service principal, exact audience/scopes, tenant/branch/order mapping,
  identity federation and network boundary.
- Commerce Owner: approve order eligibility, handoff, cancellation/return/refund ownership and
  customer tracking/contact authority.
- Inventory Owner: approve the exact physical-handoff and stock authority; Delivery must never infer
  inventory movement from a driver action.
- Integration Owner: approve producer/consumer versions, retry/replay/reconciliation window,
  provider credential ownership and failure escalation.

Requested evidence: signed authority matrix, versioned API/event contracts and synthetic E2E results
for duplicate, delayed, missing, replayed and conflicting events. BMS remains authoritative for
commerce, payment and inventory throughout.
