# Phase 7 — operations read foundation

Status: **IN PROGRESS / ADMIN PLACEMENT BLOCKED**.

ADR-008 keeps merchant-owned projections near BMS Admin and proposes a separate Delivery Admin for
platform fleet/private/finance duties, but Product, Security and Operations have not approved the
surface ownership, federation or permission catalogs. This slice therefore adds no Admin UI, SSO,
mutating operator command or finance projection.

## Implemented safe boundary

- `GET /v1/operations/overview` requires `operations.read`, fail-closed rate limiting and an active
  service-principal tenant/branch mapping. In one tenant RLS read snapshot it returns Delivery counts
  by state, open manual-dispatch count, action-required integration count and latest Delivery update.
- `GET /v1/operations/deliveries` uses the same authorization and returns a bounded server-backed
  list ordered by `(updated_at, id)` with an opaque keyset cursor, optional exact state filter and a
  maximum page size of 100.
- The read contracts expose only Delivery/BMS opaque references, state, version and timestamps. They
  deliberately exclude customer identity/contact/address, coordinates, driver evidence and all
  prices, ledger, COD, earning, payout, transfer and tax fields.
- Migration `0010_phase7_operations_read_models.sql` adds tenant/branch/state pagination indexes and
  an open-manual-queue index. It adds no business row or authority.
- The existing Phase 5 reconciliation issue feed remains the bounded detail queue behind the
  overview's action-required count.

## Deliberately absent

- no BMS Admin or Delivery Admin pages;
- no ordinary BMS session/JWT forwarded to Delivery;
- no live map, exact driver location or private evidence;
- no manual assignment, driver verification, merchant/pricing mutation or recovery button;
- no finance/COD/payout/report projection while Phase 6 policy is unresolved;
- no cross-tenant/platform fleet scope;
- no placeholder metrics represented as real data.

## Gate to continue Phase 7

Product, Security and Operations must approve ADR-008 placement, identity federation, platform versus
tenant/branch permissions, private-evidence access and finance separation of duties. The selected UI
must then call these read models through an approved adapter, use server-backed pagination for large
lists, enforce the same object scope on every mutation and pass desktop/mobile browser verification.
