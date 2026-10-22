# Salon operations (`10.87`)

The salon module is enabled for the existing `beauty_personal_care` archetype. It adds operational
state around the existing POS rather than creating a second checkout engine.

## Supported workflow

- Configure a sellable salon service from an active `NON_STOCK` product SKU, including duration,
  cleanup buffer and whether it may later be exposed to online booking.
- Configure branch-owned chairs, rooms, beds and equipment.
- Create staff or walk-in appointments and assign a stylist and optional resource to each service.
  Transaction advisory locks and overlap checks prevent two app instances from booking the same
  stylist or resource at the same time.
- Move appointments through `BOOKED -> CONFIRMED -> CHECKED_IN -> IN_SERVICE -> COMPLETED`, with
  explicit cancellation and no-show states. Completion requires a completed/returned POS order for
  the same customer. Payment, discounts, tender, tax, stock and refunds therefore remain owned by
  the existing POS transaction.
- Keep tenant-scoped client care notes (allergies, formula, preferences) and independent photo and
  marketing consent flags. Reading/writing these notes uses the narrower
  `salon.client_notes.manage` permission.
- Define prepaid service packages using one `NON_STOCK` sale SKU and one `NON_STOCK` covered-service
  SKU. Entitlements can only be activated from a completed POS order item belonging to that customer;
  each redemption is an append-only ledger row tied to one appointment service.
- Tips use a dedicated `NON_STOCK` product or POS extra line, so the normal payment total and drawer
  remain authoritative. Salon reporting may classify that configured SKU/label separately; tips
  must not be written as an unbacked side-table cash amount.

Existing BMS modules provide mixed tender, deposits, store credit/gift cards, membership and points,
coupons, stock/lot/expiry, shifts, tax documents, branch reporting, follow-up rules and effective-dated
commission. For multi-stylist salon work, the appointment service assignment is the delivery record;
the cashier remains the financial actor on the POS order.

## Deliberate boundaries

`online_bookable` is publication eligibility, not a public booking endpoint. A later public surface
must apply rate limiting, server-derived tenant/branch identity, availability recheck and an explicit
deposit policy. Customer reminders reuse the existing follow-up/outbound-message machinery; this
module does not send messages while saving an appointment.

Package redemptions are liabilities and are never Product stock. Activating or redeeming them needs
`salon.package.manage`; updating client care notes needs `salon.client_notes.manage`; ordinary
calendar reads and writes use `salon.view` and `salon.manage`.
