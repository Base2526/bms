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

`verifyPaymentSlip()` uses Claude vision to read a payment slip image and compare it against the
expected amount — but it is **advisory only**. It never changes payment status itself; a human
must still click Confirm. Without `ANTHROPIC_API_KEY` or without a slip image, it falls back to a
heuristic that just asks the human to check manually.

## Permissions

`payment.view` / `payment.submit` / `payment.confirm` / `payment.refund` — refunding additionally
requires Manager-level approval in practice (permission is granted narrowly).
