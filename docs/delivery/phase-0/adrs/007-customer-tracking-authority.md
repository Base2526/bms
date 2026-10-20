# ADR-007: Customer tracking authority

- Status: `ACCEPTED` as a future production constraint on 2026-10-18; synthetic coarse-status slice implemented
- Decision owner: Security + Product + Privacy
- Blocks: Phase 5 customer integration

## Context

- `VERIFIED`: the BMS checkout token binds tenant/order/expiry but has no tracking action, delivery
  id or revocation handle. Audited checkout routes also lack an explicit shared rate-limit guard.
- `VERIFIED`: caller-supplied tenant/order ids cannot be authority.

## Proposed decision

- `PROPOSED`: issue a distinct opaque or signed, purpose-bound grant containing audience, opaque grant
  id, order/delivery binding, allowed actions, expiry, key id and revocation/version handle.
- `PROPOSED`: default grant is read-only tracking. Cancellation is a separate permission that submits
  a BMS-authoritative request. Rotation/revocation invalidates earlier links.
- `PROPOSED`: no-store/no-referrer/noindex responses, grant+IP rate limiting, token fingerprint logs,
  coarsened/stale-labelled location and no driver contact/KYC/raw audit/finance data.

## Synthetic implementation evidence

- `VERIFIED`: migration `0013` adds `TRACK` only to newly issued synthetic grants; existing grants
  are not expanded. The live grant is rechecked inside the tenant read snapshot.
- `VERIFIED`: `GET /v1/customer/deliveries/current` derives order scope from the grant and returns
  state, version, coarse match stage, frozen amounts and timestamps only. It returns no caller scope,
  driver identity/contact/KYC, assignment id, GPS, POD or raw evidence.
- `VERIFIED`: the local runner reached `DRIVER_ASSIGNED` after service-owned payment/readiness and
  dispatch plus driver-owned acceptance. This is local synthetic evidence, not production approval.

## Consequences

- `PROPOSED`: leaked checkout URLs do not gain Delivery authority and tracking access can be revoked.
  BMS/customer UX must support link regeneration.

## Alternatives

- `PROPOSED`: reusing checkout bearer or raw order id is rejected.
- `UNRESOLVED`: an authenticated BMS customer session may supplement/replace link grants later.

## Approval required

- `UNRESOLVED`: expiry, allowed cancellation stage, leaked-link recovery, location precision,
  customer POD access, rate limits and support verification.
