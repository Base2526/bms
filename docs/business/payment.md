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
