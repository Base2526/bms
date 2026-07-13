# Prompts & Guardrails

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Pipeline: [workflow.md](workflow.md) · Tools: [tools.md](tools.md)

## The actual customer-facing system prompt

`generateResponse()` in [`lib/bms/ai.ts`](../../apps/web/lib/bms/ai.ts) is the only place a prompt
is sent to Claude for customer replies. Model defaults to `claude-haiku-4-5-20251001`
(override via `BMS_AI_MODEL`), `max_tokens: 256`.

```
System:
  คุณเป็นแอดมินร้านค้าออนไลน์ ตอบลูกค้าเป็นภาษาไทย สุภาพ กระชับ เป็นกันเอง
  ใช้ข้อมูลสต็อกที่ให้เท่านั้น ห้ามเดา/แต่งตัวเลขสต็อกหรือราคาเอง
  ถ้ามีของให้ชวนปิดการขาย ถ้าหมดให้เสนอไซซ์อื่น

User:
  ข้อเท็จจริงสต็อก: {facts from checkStock()}

  ลูกค้าถาม: "{customer message}"

  ช่วยตอบลูกค้าให้หน่อยค่ะ
```

Key design point: **the prompt only ever receives facts already fetched from the backend**
(`facts()` serializes the `StockResult` from `checkStock()`). The model is never given DB access,
a tool-calling loop, or the ability to invent numbers — it only rephrases what the backend already
computed. If `ANTHROPIC_API_KEY` is unset, or the Claude call fails for any reason, it falls back
to a fully deterministic Thai-language template (`template()`) so replies never silently break.

## Standing rules that constrain every prompt/tool interaction

From [../business/](../business/) and [CLAUDE.md](../../CLAUDE.md) — these apply regardless of
model or prompt wording:

- AI **never** writes SQL, and never accesses the database directly.
- AI **only** calls the approved tools in [tools.md](tools.md) — never a raw service function.
- AI **never** fabricates stock, price, or order data — every number it states must trace back to
  a tool result.
- AI must ask for **human confirmation** before: deleting anything, refunding, cancelling, changing
  a price, or adjusting inventory. `verifyPaymentSlip()` is the canonical example — Claude vision
  reads the slip and suggests a match, but a human still has to click Confirm.
- Every AI-initiated write is logged to `bms_audit_log` via `audit()` (best-effort — a logging
  failure never blocks the underlying action).

## Ops prompt — Daily Log Triage

A second, unrelated prompt drives `scripts/bms-log-triage/` (see [workflow.md](workflow.md) for the
full flow): given redacted error logs, Claude proposes a minimal patch and opens a **draft PR only**
— it never merges, never touches migrations/secrets/config, and a human always reviews before
anything reaches `main`.
