# Board Game Cafe

`board_game_cafe` is the archetype for shops whose primary sale is a timed in-store play session,
often mixed with snacks, drinks, retail accessories, memberships, and a play-library of board games.

## Domain Boundary

Keep three concepts separate:

| Concept | Source of truth | Why |
| --- | --- | --- |
| Sellable goods | Product + Inventory | Snacks, drinks, sleeves, dice, and games sold as retail stock still leave the shelf through POS. |
| Play time | Board-game session/rate module | Time charges depend on participants, start/end time, rounding, grace periods, discounts, and membership rules. |
| Play-library games | Game Library assets | A playable game copy is borrowed, returned, inspected, damaged, or retired. It is not sold and should not reduce stock when played. |

The register opens a board-game session, calculates time charges in the backend, adds sellable
products to the same bill, then settles through the existing POS/payment path. Board-game sessions do
not create a second payment flow.

## Implemented Shape

The first operational release includes:

1. `board_game_cafe` archetype and onboarding policy.
2. Board-game table/session records: open, extend, close, cancel.
3. Participant rates: general, student, member, observer/guardian.
4. Time-billing rules: minimum minutes, rounding minutes, grace period, overtime behaviour.
5. Session alerts for ending-soon and overdue states.
6. POS bill generation using existing order/payment settlement.
7. Game Library: title + physical copy with condition/status.
8. Purchase receiving destination: stock for resale or Game Library for play copies.
9. Existing CRM customer/member identity linkage and POS split-payment support.
10. Public discovery: opt-in listing, location, opening hours, published rates, game highlights, and aggregate availability.

The public directory is `/board-game`. A branch stays private until a manager explicitly publishes
it with valid coordinates. The public API exposes aggregate table availability only; it never returns
table identifiers, active sessions, participants, or customer data.

Dedicated monthly/yearly subscription contracts, encrypted identity-document storage, and advanced
board-game analytics are intentionally a later phase. They should extend the existing CRM and report
domains instead of duplicating customer or payment records inside this module.

## Dev/Test Fixtures

`POST /api/dev/fake/bms-board-game` is platform-admin only and disabled in production unless fake
seeding is explicitly enabled. It prepares a board-game cafe with `FAKE`-marked zones/tables, four
rate types, CRM members, open-ended and fixed-duration sessions, ending/overdue/closing examples,
multiple billing groups, game titles/copies, active and returned loans, an issue case, and an
unpublished public-profile draft. The full-shop provisioner runs the same fixture automatically when
the selected archetype is `board_game_cafe`.

`DELETE /api/dev/fake/cleanup` removes linked fake POS orders before sessions and then removes the
library, floor, rates, and unpublished profile fixtures in foreign-key order. It does not delete a
public profile after an operator has published it.

## UX Rules

- Products are only for things the shop sells.
- Time rates are configured in a board-game settings surface, not in the product form.
- Play-library copies have copy codes and condition/status, not sellable SKU stock.
- Public discovery must be opt-in and read only published/aggregate data.
- Any action that changes money, such as editing `started_at`, waiving overtime, changing a rate, or discounting a session, needs permission and audit.

## Reuse Existing BMS

Reuse existing services for:

- product catalog and inventory for retail goods;
- purchase orders and receiving for supplier workflow;
- POS shifts, payments, receipts, returns/voids, and tax documents;
- customer/CRM records and membership identity;
- RBAC, audit, realtime, and reports.

New board-game services must live under `apps/web/lib/bms/` and keep API/routes thin. Every
tenant-owned table needs `tenant_id`, RLS, and `bms_app` grants.
