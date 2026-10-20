# ADR-008: Admin placement and permission ownership

- Status: `ACCEPTED` as a future constraint on 2026-10-18; no Delivery Admin exists in Phase 1
- Decision owner: Product + Security + Operations
- Blocks: Phase 7

## Context

- `VERIFIED`: BMS Admin already enforces tenant/branch permissions for orders, payments and shipments.
  `/admin/system-health` is read-only. No first-party fleet dispatch/driver/finance surface exists.
- `UNRESOLVED`: platform-wide driver/dispatch/support/finance scope and separation of duties are not
  represented by current tenant Admin personas.

## Proposed decision

- `PROPOSED`: place merchant-owned order/readiness/handoff/settings projections in BMS Admin, calling
  BMS services/Delivery adapter under existing tenant and branch rules.
- `PROPOSED`: place platform fleet dispatch, driver verification, private evidence, disputes, COD,
  ledger and payouts in a separate Delivery Admin using Delivery-native permission/object scopes.
- `PROPOSED`: share identity through an approved federation boundary, not by sending the ordinary BMS
  admin JWT directly to Delivery. Keep system health read-only; recovery is in authorized ops queues.

## Consequences

- `PROPOSED`: merchant workflows remain near BMS order truth while platform/private/finance duties do
  not widen tenant Admin access. Two surfaces require navigation/federation/contract ownership.

## Alternatives

- `PROPOSED`: one BMS Admin surface is acceptable only if platform/tenant/branch/object scope and
  finance SoD are proved end-to-end; this is higher coupling.
- `PROPOSED`: Delivery-only Admin is rejected for BMS commerce mutations because it would duplicate
  or proxy too much BMS authorization/UI behavior.

## Approval required

- `UNRESOLVED`: surface ownership, SSO/federation, permission catalog ownership, platform versus
  tenant/branch scope, evidence permissions and mutually exclusive finance duties.
