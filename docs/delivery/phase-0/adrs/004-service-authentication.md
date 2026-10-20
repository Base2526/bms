# ADR-004: Service authentication

- Status: `ACCEPTED` for the Phase 1 architecture on 2026-10-18
- Decision owner: Security + Platform
- Blocks: Phase 1 auth skeleton and Phase 5 BMS integration

## Context

- `VERIFIED`: BMS GraphQL currently supports web/admin/android/POS principals only. Admin JWT, POS
  device and customer token are not service credentials.
- `VERIFIED`: a generic tenant helper can fall back to a default tenant, which is unsafe here.

## Proposed decision

- `PROPOSED`: dedicated asymmetric short-lived service JWTs with issuer, exact audience, subject,
  `kid`, times, `jti` and narrow operation scopes; separate keys per caller/environment.
- `PROPOSED`: the service token authenticates the caller only. An enabled server-side mapping derives
  tenant/branch/order and is revalidated for every sensitive command; no default tenant.
- `PROPOSED`: key rotation uses published verification keys and overlap; emergency revocation disables
  key/principal. Mutations add request/correlation/idempotency ids and body hash.

## Consequences

- `PROPOSED`: compromise is bounded by audience/operation/expiry and can be revoked without user
  logout. Services need clock/key/revocation monitoring.
- `PROPOSED`: 401/403/404/business-rejection semantics become contract tests.

## Alternatives

- `PROPOSED`: shared static API key and ordinary admin JWT are rejected due to rotation, scope and
  audit ambiguity.
- `UNRESOLVED`: mTLS in addition to JWT may be required by deployment/network policy.

## Approval required

- `UNRESOLVED`: issuer/audience, algorithm/key owner, TTL/skew, mTLS/network, revocation, rotation,
  rate limits and operation scopes.
