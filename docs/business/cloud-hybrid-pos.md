# BMS Cloud + Hybrid POS product contract

BMS Cloud and BMS Hybrid POS are **one product**. “Hybrid POS” describes a continuity capability of
BMS, not a second edition, price plan, database, settlement engine, or source of truth.

## What can be sold today

- **BMS Cloud** is the normal operating mode. PostgreSQL and the existing backend services remain
  authoritative for price, stock, permission, payment, tax document, audit, and reporting.
- **Emergency Offline Mode** is included as a bounded resilience capability on Mobile POS. During a
  network outage it may accept only a plain retail cash sale into the encrypted device queue.
- On reconnect, Mobile recovers by the original idempotency key before retrying and submits serially
  through the existing server settlement path. The server repeats eligibility, price, stock, tax,
  shift, cashier, and permission checks before anything becomes a real bill.
- The on-device Sync Center keeps pending, interrupted, and rejected items visible, supports retry
  with the original key, binds new rows to the accepting device/branch/shift, and detects accidental
  queued-request or scope mutation before replay. Unknown queue formats and secure-storage write
  failures fail closed. The Sync Center does not offer a discard action after cash has been accepted.
- Both Mobile eligibility and the authoritative settlement service reject pharmacy, restaurant, and
  board-game archetypes from this retail outage path. The server also refuses to attribute a tender
  timestamp from before the current shift to a newly opened shift.
- An offline reference is not a receipt or tax document. Those exist only after the Cloud transaction
  commits, and shift close or device unpair remains blocked while accepted cash is unresolved.

Recommended customer-facing phrase:

> BMS is one cloud business platform with Emergency Offline Mode for basic retail cash continuity on
> Mobile POS.

Do not claim “works fully offline”, “local server”, “offline restaurant”, or “offline Desktop POS”.

## Current boundary

Emergency Offline Mode does not currently cover:

- Web or Desktop POS;
- restaurant, board-game, or pharmacy workflows;
- members, points, coupons, manual/approval discounts, deposits, or credit;
- QR, card, transfer, wallet, store credit, or split payments;
- weighted products, serial numbers, variants/modifiers requiring the excluded flow;
- returns, voids, refunds, shift close, receiving, transfer, count, or other stock operations;
- cold-start offline PIN login or an unrestricted offline product catalog; the cashier must already
  be signed in with the original shift open and must have loaded the product snapshot before outage.

The connected Cloud product supports many of those workflows; the list above is only the outage-mode
boundary.

## Rollout still required

Before broadening the Hybrid claim, complete and verify each capability rather than treating the name
as authority:

1. Bring the encrypted queue and recovery UX to Desktop without adding a second settlement path.
2. Extend the Mobile device-local Sync Center into an authorized fleet/admin reconciliation view;
   Mobile already preserves the original idempotency key and supports per-item review/retry.
3. Verify ESC/POS printing and cash-drawer control on supported real hardware.
4. Sign Windows releases, sign/notarize macOS releases, define Linux distribution trust, and provide a
   tested update channel.
5. Run real-device outage, power-loss, process-kill, reconnect, duplicate-response, and multi-hour soak
   tests with documented reconciliation.
6. Publish installation, outage, reconciliation, and remote-support runbooks.

A store-local server with broad feature parity is an Enterprise phase. It needs explicit replication,
conflict, identity, tax-document numbering, payment, and disaster-recovery design; the current Desktop
shell is not that architecture.
