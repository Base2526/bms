# ADR-002: Repository and deployment layout

- Status: `ACCEPTED` for the Phase 1 architecture on 2026-10-18
- Decision owner: Engineering leadership + DevOps
- Blocks: Phase 1 project creation

## Context

- `VERIFIED`: BMS is a multi-application repository without a root JavaScript workspace manifest;
  apps/packages have independent package/runtime concerns.
- `VERIFIED`: CI uses Node 22 while the current web image uses Node 20. Current PostgreSQL is not
  PostGIS-enabled.

## Proposed decision

- `PROPOSED`: keep source in this monorepo for contract review and atomic compatibility changes, but
  deploy Delivery independently with `apps/fleet-delivery-api`, `apps/fleet-delivery-worker`,
  `apps/driver-mobile`, shared `packages/fleet-delivery-*`, and `infrastructure/fleet-delivery`.
- `PROPOSED`: use Delivery-owned PostgreSQL/PostGIS, Redis, object-storage namespace, roles,
  migrations, backups and networks. Do not connect Delivery to the BMS database.
- `PROPOSED`: standardize new services and shared packages on an approved Node 22 LTS baseline while
  compiling BMS consumers to their supported target.

## Consequences

- `PROPOSED`: contract changes can be reviewed together while release/deploy/data failure domains
  remain separate.
- `PROPOSED`: CI must test both producer and consumer compatibility and define cross-service
  migration order.

## Alternatives

- `PROPOSED`: separate repository improves ownership isolation but adds contract/release coordination;
  choose it only with a registry/versioning owner.
- `PROPOSED`: embedding in `apps/web` is rejected because it violates independent deployment/data
  ownership and creates a PostGIS/trust coupling.

## Approval required

- `UNRESOLVED`: approve repository, CI/release owners, Node baseline, environment promotion, mobile
  signing and infrastructure owner.
