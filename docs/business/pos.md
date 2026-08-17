# Point of Sale (POS)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Payments: [payment.md](payment.md) · Inventory: [inventory.md](inventory.md)

The BMS POS at `/pos` is an online, general-retail checkout surface. A device token identifies the
tenant, branch, and register; a cashier user plus PIN identifies every sale, shift action, return,
and refund settlement. The browser never supplies authoritative tenant, price, pack conversion, or
stock values.

## Supported counter workflow

1. An administrator creates an active location and POS device at `/admin/pos-devices`, issues its
   one-time token, and pairs the browser.
2. Staff PINs and RBAC are configured. Selling, opening/closing a shift, returning goods, and
   confirming a non-cash refund each have independent server-side permission checks.
3. The cashier opens a shift with the drawer float, scans a barcode/SKU or searches the live catalog,
   and can sell base units or configured packs.
4. One bill can be split across cash, QR, card, bank transfer, or wallet. The method is picked from
   a row of buttons under the amount; cash opens the quick-tender pad, the other methods take a
   reference number and keep their amount locked to the bill total. "Split payment" switches to the
   multi-row form. The payment rows must add up to the server-computed order amount; cash
   tender/change is recorded per cash row.
5. Successful settlement changes the order to `COMPLETED`, consumes reserved/current stock, assigns
   lots FEFO where lots are tracked, records movements, and issues an abbreviated tax document when
   the tenant is VAT-registered. These steps commit atomically.
6. Recent sales can be searched by order UUID or receipt/tax document number, previewed by line,
   and reprinted. Each bill in that list is one compact row; return, refund, and exchange controls
   open on demand for one bill at a time, and the reason code plus detail are shared by the partial
   and full return actions. An exchange loads the remaining original items into a new cart; it is a
   new sale, not a mutation of the old receipt.
7. Returns may be full or partial. A reason code plus detail is mandatory, returned quantities are
   cumulative and cannot exceed the sold quantity, net refund uses the original order-level discount,
   and stock/lot provenance is restored atomically.
8. Cash refunds complete immediately. Card/QR/bank/wallet refunds remain `PENDING` until a user with
   `payment.refund` records the external refund reference. A shift cannot close while any refund
   allocation from that shift is pending.
9. Closing a shift calculates expected cash from opening float + cash collected - completed cash
   refunds, then records counted cash and variance.

## Counter screen layout

A till is typically 768px tall, so vertical space is the scarce axis. Work that happens a few times
a shift sits on a 68px icon rail down the left — sell, returns, shift, settings — and only the left
column of the screen changes with it. The totals, cash pad, and pay button stay on the right at all
times, because queues overlap: the first customer is still paying when the next one hands over a
bill to return. Below 768px wide the rail becomes a bottom bar.

The page itself never scrolls; each column scrolls inside its own box, so the pay button cannot be
pushed off screen by a long cart. Three things stay outside the rail on purpose: the "can't sell
yet" checklist, the cashier selector with the PIN field (memory-only, so it is needed again after
every reload), and the name of whoever is currently selling. Leaving the sell tab and coming back
returns focus to the scan box — a scanner typing into the wrong field is the worst failure this
screen has.

## Tax settings

VAT registration, rate, VAT rounding method, document calendar era, abbreviated-invoice approval,
and cash rounding live on the store profile row and are edited at `/admin/pos-readiness`
(permission `tax.setting.manage`, every change audited with before/after). They apply to new bills
only — an issued document keeps the rate and amounts stored on its own row.

Cash rounding applies solely to bills paid entirely in cash. The rounded difference is its own line
on the bill and on the receipt; it is not a discount and does not change the VAT base. The counter
screen reads the same setting through `/api/pos/session` and charges the rounded amount, so the
amount it sends matches what the server computes — a mismatch would cancel the bill outright.

## e-Tax submission queue

Issuing a tax document at the counter never talks to the Revenue Department by itself — it only
writes the local document row described above. Submitting that document as e-Tax XML is a separate
background queue (`bms_etax_submissions`, migration `7.94`), gated off by default via
`ETAX_ENABLED`/`bms_store_profile.etax_enabled`. When enabled, `processEtaxQueue()` drives each
submission through `PENDING → BUILT → SIGNED → SENT → ACCEPTED/REJECTED/FAILED` with bounded
retry/backoff; `POST /api/bms/jobs/etax` runs one pass. That route authenticates with
`x-job-token`/`BMS_JOB_TOKEN` (not the `x-cron-secret` the other cron routes use — see
[api.md](../architecture/api.md)) and does not yet record into `bms_job_runs`, so it has no run
history on `/admin/operations-schedule` today. Until a real signing/submission provider is wired up
and verified, leave `ETAX_ENABLED` off and rely on locally generated documents plus the accountant's
own filing process.

## Receipt preview

The preview dialog is one card: a header stating the outcome (document number, amount, payment
method, change), the receipt paper, and the action bar. `Enter` prints, `Esc` closes, and the cash
drawer button appears only when an ESC/POS printer is connected over WebUSB — the browser print
dialog cannot open a drawer.

Paper content for a VAT-registered tenant carries the shop's tax id, the split between net amount,
VAT, VAT-exempt goods, and cash rounding, and a Code 39 barcode of the document number for scanning
the bill back at return time. Those tax figures are read from the abbreviated tax document that was
issued with the sale; the browser never derives them from the bill total, because a bill mixing
exempt goods would then print numbers that disagree with the filed document. Return and exchange
slips omit the VAT block — a credit note is a separate document.

The shop tax id comes from the store profile (`/admin/store`); leaving it blank prints a receipt
without the `TAX#` line, which is not a valid abbreviated tax invoice.

## Failure and retry behavior

- Every sale has a UUID idempotency key. A lost response or network interruption leaves a recovery
  record in browser storage; pressing Pay again reuses the same key and cannot create a second bill.
- A `PENDING` or `PAID` sale can resume its settlement transaction. A completed key replays the
  original result. Keys tied to cancelled/returned terminal states cannot be reused as a new sale.
- Returns also require an idempotency key based on the receipt and cumulative returned quantities.
- This is not an offline POS. Search, sale, return, settlement, and shift actions require the BMS
  server and PostgreSQL to be reachable. Keep a documented manual outage procedure and enter those
  transactions only after connectivity returns.

## Go-live checklist

Treat every line below as a blocker unless explicitly marked as a warning:

- Apply migrations through `7.95__bms_credit_note_and_cash_rounding.sql` on the target database
  (includes `7.92` cashier-only accounts, `7.93` per-size packs, `7.94` e-Tax submissions).
- Create at least one active location, one active paired device per register, and confirm the device
  is attached to the intended branch.
- Set cashier PINs and verify role permissions: `pos.sell`, `pos.shift.open`, `pos.shift.close`,
  `order.return`; supervisors settling non-cash refunds need `payment.refund`.
- Confirm every active product has a SKU, sale price, inventory row at the device location, barcode
  where scanning is used, and correct pack conversion/pack price where packs are sold.
- If inventory lots are used, reconcile lot totals to inventory before opening; expired lots are
  skipped and a tracked SKU cannot sell more than its unexpired lots.
- For VAT-registered tenants, set the tax settings at `/admin/pos-readiness`, fill in the shop tax id
  at `/admin/settings`, and set the tax category on every sellable product. Verify numbering and receipt content with the business's accountant/tax adviser.
  BMS generates documents locally by default; e-Tax submission to the Revenue Department is a
  separate background queue (`bms_etax_submissions`, migration `7.94`), gated off unless
  `ETAX_ENABLED`/`bms_store_profile.etax_enabled` is turned on — see "e-Tax submission queue" below.
- A `pos_only` cashier account (migration `7.92`) is hard-blocked from `/admin` login by `loginAdmin`
  itself, not just a hidden menu item; it also cannot toggle its own `pos_only` flag or an
  Administrator's.
- Pair the actual scanner (keyboard-wedge input), receipt printer, paper size, cash drawer process,
  and payment terminals. Printing falls back to the browser print dialog; the ESC/POS path over
  WebUSB (receipt, barcode, drawer kick) is written but has never been run against real hardware, so
  test it per printer model before go-live. There is no EDC driver.
- Run a rehearsal on each register: cash sale/change, split payment, card/QR reference, reprint,
  partial return, full return, non-cash refund settlement, rejected unauthorized action, and shift
  close with a known cash variance.
- Confirm backups, monitoring, stable network/power, and the manual outage/reconciliation procedure.

## Known operating boundaries

The implemented scope is a general-retail POS. It does not include restaurant table/floor plans,
kitchen display/printer routing, modifiers/toppings, queue numbers, reservations, or offline-first
sync. Hardware integrations are browser/OS driven. These are separate product modules, not hidden
configuration switches in the current POS.

