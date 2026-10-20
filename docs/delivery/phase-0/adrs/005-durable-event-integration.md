# ADR-005: Durable event and command integration

- Status: `ACCEPTED` for the Phase 1 architecture on 2026-10-18
- Decision owner: BMS + Delivery architecture/SRE
- Blocks: Phase 1 reliability skeleton and Phase 5 integration

## Context

- `VERIFIED`: BMS realtime is an at-least-once invalidation mechanism with minimal payload, not a
  replayable commerce/finance feed.
- `VERIFIED`: no cross-database transaction exists or is permitted.

## Proposed decision

- `PROPOSED`: each producer commits a versioned event to its local outbox with the source aggregate;
  an authenticated dispatcher delivers it to the consumer's durable inbox.
- `PROPOSED`: commands use narrow target-system adapters and stable idempotency/body fingerprints.
  Events state committed facts; commands request authority-owned transitions.
- `PROPOSED`: same identity/body duplicate succeeds; changed body conflicts; version gap triggers an
  authoritative snapshot reconciliation. Operator-visible dead letters preserve original identity.

## Consequences

- `PROPOSED`: outages and unknown responses converge without inventing state, at the cost of eventual
  consistency, workers, retention and reconciliation operations.
- `PROPOSED`: realtime may still refresh UI but cannot close a business transition.

## Alternatives

- `PROPOSED`: direct cross-DB write, distributed transaction and Redis-only stream are rejected.
- `UNRESOLVED`: managed broker versus authenticated HTTP push/pull remains a deploy-time choice behind
  a transport-neutral contract.

## Approval required

- `UNRESOLVED`: transport, envelope v1, event catalog, retention, retry/dead-letter thresholds,
  replay ownership and reconciliation SLO.
