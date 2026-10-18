# ADR-001: First-party delivery bounded-context name

- Status: `ACCEPTED` for the Phase 1 architecture on 2026-10-18
- Decision owner: BMS architecture + Product
- Blocks: Phase 1 naming and routes

## Context

- `VERIFIED`: `deliveryPlatforms`, `/api/bms/delivery/*`, `/admin/delivery-platforms`, and
  `delivery.*` permissions already mean third-party food-platform integration.
- `VERIFIED`: reusing those names would create ambiguous services, routes, permissions, events and
  operational ownership.

## Proposed decision

- `PROPOSED`: use `fleet-delivery` in paths/packages/deployment and `fleetDelivery` in TypeScript/
  GraphQL symbols until a product name is approved.
- `PROPOSED`: reserve `fleet-delivery.*` event and permission families and never add first-party
  routes below existing `/api/bms/delivery/*`.

## Consequences

- `PROPOSED`: third-party provider integration remains behaviorally untouched and searches/audits
  clearly distinguish both domains.
- `PROPOSED`: a later user-facing rename does not require changing stable wire/database identifiers.

## Alternatives rejected

- `PROPOSED`: `delivery` alone is rejected because it already has repository meaning.
- `PROPOSED`: a vendor/product brand is rejected before trademark/product approval.

## Approval required

- `UNRESOLVED`: Architecture/Product must approve stable internal name, route prefix, event prefix
  and permission prefix.
