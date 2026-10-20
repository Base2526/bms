# ADR-003: Driver-pool tenancy

- Status: `ACCEPTED` as the safe pilot constraint on 2026-10-18; implemented for synthetic Phase 3 only
- Decision owner: Product + Operations + Legal
- Blocks: Phase 3 driver/dispatch model

## Context

- `VERIFIED`: BMS operations are tenant and often branch scoped; a platform-wide driver pool is not
  represented by current BMS identities or permissions.
- `UNRESOLVED`: driver employment/contract, insurance, cross-tenant work and data visibility have no
  authoritative approval in the repository.

## Proposed decision

- `VERIFIED`: pilot with Delivery-native synthetic drivers explicitly authorized through tenant/branch fleet
  memberships. One active shift serves one tenant and its approved branches; no cross-tenant batch.
- `PROPOSED`: platform Operations may review/dispatch only through explicit platform permissions and
  object scope; platform status does not imply private evidence or finance access.
- `VERIFIED`: memberships allow a later hybrid/platform pool without changing driver
  identity, but leave cross-tenant memberships disabled.

## Consequences

- `VERIFIED`: synthetic pilot scope has simpler visibility, reconciliation and dispatch isolation.
- `PROPOSED`: utilization is lower than a shared marketplace pool; expansion requires a new approved
  policy and tests.

## Alternatives

- `UNRESOLVED`: platform-wide independent drivers or hybrid pools require commercial/legal status,
  allocation/fairness, insurance, contact/privacy and settlement decisions first.

## Approval required

- `UNRESOLVED`: approve ownership, allowed tenant/branch overlap, shift rule, who can offer/assign,
  deactivation/drain and legal operator.
