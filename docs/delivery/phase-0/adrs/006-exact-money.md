# ADR-006: Exact money across BMS and Delivery

- Status: `ACCEPTED` for the Phase 1 architecture on 2026-10-18
- Decision owner: Finance + BMS/Delivery architecture
- Blocks: Phase 2 quote/ledger and Phase 5 adapter

## Context

- `VERIFIED`: BMS PostgreSQL money is exact numeric and amount due includes shipping fee; legacy
  GraphQL exposes many monetary fields as binary `Float`.
- `VERIFIED`: changing existing GraphQL field types would break clients.

## Proposed decision

- `PROPOSED`: Delivery stores THB as signed 64-bit integer satang. Cross-service contracts use satang
  integer plus `THB`; canonical two-decimal strings are permitted only at a documented BMS adapter.
- `PROPOSED`: add exact fields/operations rather than changing legacy `Float`. Reject exponent,
  fraction-of-satang, noncanonical decimal, unsupported currency and overflow.
- `PROPOSED`: effective-dated pricing/commission/subsidy components and one approved rounding result
  are snapshotted; historical amounts are never recomputed from current rules.

## Consequences

- `PROPOSED`: exact comparison/idempotency/journal balance are possible while old consumers remain
  compatible. UI formatting converts only at the edge.

## Alternatives

- `PROPOSED`: JavaScript number/GraphQL Float as authority is rejected.
- `PROPOSED`: arbitrary decimal library values without a canonical wire form are rejected.

## Approval required

- `UNRESOLVED`: rounding mode/point, VAT inclusion, commission-eligible components, maximum values and
  canonical error codes.
