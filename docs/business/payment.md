# Payments

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_payments` ([../architecture/database.md](../architecture/database.md))

An order cannot move to `PAID` without payment verification, and **only the backend confirms
payment** — AI may assist by reading a payment slip, but it never decides the outcome itself.

## Methods & lifecycle (`bms_payments`)

Methods: `BANK_TRANSFER` / `QR` / `CARD` / `TIKTOK` / `CASH`.

```
PENDING → CONFIRMED → REFUNDED
        ↘ REJECTED
```

`CONFIRMED` is atomic with the order transition `PENDING → PAID`.

## Public checkout

Every successful customer chat order receives a signed `/checkout?t=...` link generated from the
persisted tenant/order pair. `GET/PATCH /api/bms/checkout` reads the order snapshot and reuses CRM
recipient/phone/default shipping address; the form renders only missing fields unless the customer
explicitly chooses to edit existing data. Lazada/Shopee remain in Seller Center.

`POST /api/bms/checkout/payment` accepts only JPG/PNG/WEBP slips up to 8 MB and only
`BANK_TRANSFER`/`QR` methods backed by the shop's currently configured BANK/PromptPay account. The
amount always comes from the order, not the browser. `submitPaymentOnce()` locks the order and
returns an existing `PENDING`/`CONFIRMED` payment to prevent duplicate submissions; a `REJECTED`
payment may be replaced. A successful upload creates `PENDING` only and requires the existing human
Confirm action before the order becomes `PAID`.

## AI slip verification

`verifyPaymentSlip()` loads and normalizes the image, obtains the active provider through
`lib/bms/slipReaders/index.ts`, calls the provider-neutral `SlipReader` contract, and compares the
extracted amount against the expected backend amount. The current adapters are
`lib/bms/slipReaders/anthropic.ts` and `lib/bms/slipReaders/qwen.ts`; provider selection now lives
in the slip-reader registry, so adding an internal OCR service must be done as another registered
adapter rather than adding provider logic back into `payments.ts`.

Provider output is untrusted: the reader accepts only the exact `amount` / `date` / `ref` / `bank`
JSON contract and applies a bounded request timeout. Since OCR is read-only, a runtime provider
failure may retry the configured fallback once; each attempt consumes/records usage independently.
If both fail, the flow falls back to manual review. Verification is still **advisory only** and never changes payment
status; a human with `payment.confirm` must click Confirm. Without available AI credentials,
credits, or a readable slip image, the service asks the human to check manually.

## Permissions

`payment.view` / `payment.submit` / `payment.confirm` / `payment.refund` — refunding additionally
requires Manager-level approval in practice (permission is granted narrowly).

## POS settlement

POS payment rows are created as `CONFIRMED` inside the same transaction that marks the order paid,
fulfils stock, allocates lots, and issues the abbreviated tax document. A bill may have multiple
payment rows, but their rounded total must equal the server-computed amount. Browser-supplied product
prices and pack conversions are never authoritative.

Goods return and money settlement are deliberately separate. `bms_pos_returns`/return-item rows
record the accepted goods and restored stock; `bms_pos_refund_allocations` allocates the net refund
against the original confirmed payments. Cash completes immediately. Non-cash methods stay pending
until a user with `payment.refund` records an external reference, and the register shift cannot close
while one of its allocations is pending. Full workflow: [pos.md](pos.md).
