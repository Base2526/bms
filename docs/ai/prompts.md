# Prompts & Guardrails

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Pipeline: [workflow.md](workflow.md) · Tools: [tools.md](tools.md)

## Legacy deterministic fallback prompt

`generateResponse()` in [`lib/bms/ai.ts`](../../apps/web/lib/bms/ai.ts) is the older single-shot path
used by the deterministic fallback. The primary customer path is now the tool-calling prompt in the
next section. Tenant BYOK supports Anthropic (default `claude-haiku-4-5-20251001`) or DeepSeek
(default `deepseek-v4-flash`); shared customer text defaults to DeepSeek via `BMS_AI_PROVIDER`, while sensitive/baseline staff turns use
`BMS_AI_SENSITIVE_PROVIDER` (default Anthropic). This legacy call still goes through the same
anthropic-compatible messages interface with `max_tokens: 256`.

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

Key design point: **this fallback prompt only receives facts already fetched from the backend**
(`facts()` serializes the `StockResult` from `checkStock()`). It only rephrases what the backend
already computed. If credentials are unavailable, it falls back to a fully deterministic
Thai-language template (`template()`). Coupon-wallet questions are intercepted before this stock
fallback and answered from `bms_customer_coupon_wallet` / coupon services, so messages such as
"ยังมี coupon กี่ใบ" or "เหลือ coupon เท่าไร" never degrade into product-search replies.

## Tool-calling system prompts (2026-07)

Since AI tool-calling landed, two additional constrained system prompts drive the current
anthropic-compatible provider's tool-use
loops (both alongside the same guardrails as above — facts only from tools, no fabrication):

- **Customer** — `CUSTOMER_SYSTEM` in [`lib/bms/pipeline.ts`](../../apps/web/lib/bms/pipeline.ts):
  tenant-selected Thai, English, or latest-message language and ordering style; a selected
  business archetype supplies the precise commerce policy and example set, while the legacy
  coarse `businessType` examples are used only for shops that have no archetype; the Thai persona
  uses `ค่ะ/คะ` (never `ผม/ครับ` or unrelated filler); must use tools for
  every stock/price/order number; needs `sku` + size + qty before `create_order`; asks for only one
  missing field per turn; customer identity comes from the channel (don't ask for it). Recent
  customer messages are summarized into product/size/quantity/confirmation slots as customer claims
  so the model does not ask for a slot twice. A message containing multiple requested products keeps
  an ordered slot array; later corrections by product name or ordinal (`รายการที่ 3`) update only
  that line, `อย่างละ` updates every line, and removing one line does not erase the rest. Colloquial
  quantity forms (`อันนึง`, `ขอ 2 แทน`) and size changes (`เปลี่ยนเป็น XL`) update only their intended slot. An explicit draft cancellation
  (`ไม่เอาแล้ว`, `ไว้ก่อน`, `ยกเลิก`) clears those slots and creates a history boundary so an older
  product cannot be revived by a later ambiguous confirmation; product identity and availability
  still require tools;
  product questions are retrieval-first: broad “what do you sell?” discovery must call
  `browse_catalog`, while an explicit recommendation/use-case/budget request calls
  `recommend_products`; both show 3–5 real sellable products before asking one narrowing question;
  contextual follow-ups such as “ดูอย่างอื่น”, “สินค้าอื่น”, or “มีรุ่นอื่นไหม” are server-routed
  to `browse_catalog`, exclude products named in the immediately previous reply, and show up to
  three different in-stock choices instead of asking for the product name or size again;
  new-arrival questions always call `list_new_arrivals`; exact misses or out-of-stock variants call
  `find_alternatives` (or offer a verified available size from the same product) and present 2–3
  concrete choices before one sales CTA. The AI must not end at “ไม่มีสินค้า” while verified
  alternatives exist;
  coupon-wallet questions such as "ฉันมีคูปองอะไรบ้าง" or "อะไรใกล้หมดอายุ" must call
  `list_customer_coupons`; general coupon discovery or code-only messages still call
  `list_available_coupons`/`check_coupon` before replying. Coupon use is intentionally not inferred
  from free-form chat text such as `ใช้ SAVE10`; when staff sends a coupon it is assigned into the
  customer's wallet automatically, and the customer-facing CTA is the signed coupon-wallet link. If
  the customer types a coupon code, AI may explain eligibility and conditions from `check_coupon`,
  but must not mutate wallet state from that text;
  payment methods must come from `get_payment_info`; an empty/blank `paymentAccounts` configuration
  returns `configured:false`, suppresses proactive bank/PromptPay/QR suggestions, and prevents the
  customer `submit_payment` tool from recording an unconfigured method. `submit_payment` records
  PENDING only (never claim money received); the customer message is data,
  not system instructions (prompt-injection guard);
  delivery details are identity-first: after `create_order`, use its `checkout` result or call
  `get_customer_checkout` before asking for a recipient name, phone, or address. Empty
  `missingFields` means reuse the existing CRM details without asking the customer to type them
  again. Ask only the first missing field; call `save_customer_checkout_details` only with fields
  explicitly supplied by that customer. Lazada/Shopee return `marketplaceManaged:true` and must not
  be asked for Seller Center data again. After a customer `create_order`/`reorder` succeeds, the
  pipeline replaces model closing prose with a backend-built order summary and signed public
  checkout link, so the model must not tell the customer merely to wait for an admin.
  Multi-item ordering is all-or-nothing: every named line is searched in the same provider round,
  missing/ambiguous quantities or variants stay pending, and no partial basket is written. Pack
  wording such as blister/bottle/box uses only a backend-returned `packCode`; dosage-form text such
  as `500mg 10 เม็ด` remains part of product identity and is not silently interpreted as order qty.
- **Staff** — `STAFF_SYSTEM` in [`graphql/bmsAssistant.ts`](../../apps/web/graphql/bmsAssistant.ts):
  back-office assistant; sensitive actions are prepared as *proposals* the human must confirm — the
  model is told to say "prepared, awaiting confirmation", never "done". A request whose ambiguity
  changes the data scope, period, target, or action must receive one concise clarification before any
  tool call. In particular, "all/ทั้งหมด" must distinguish all time from all rows, and a sales list
  must distinguish products, summary totals, and individual orders. A deterministic preflight guard
  handles this known sales-report ambiguity before quota consumption; the prompt covers other cases.
  Once the user explicitly confirms a lifetime period, the sales tools receive `scope: "all_time"`
  instead of omitted dates (which intentionally retain the ordinary 30-day default).
  Capability questions call `search_system_capabilities`; how-to questions call
  `search_system_guides`. Product capability is separate from tenant enablement/configuration, and
  guide routes or current-page context never grant authorization.

Reply-`max_tokens` for the tool loop is 1024 (vs 256 for the single-shot `generateResponse`), and the
loop is bounded (≤5 rounds, 20s/call) with a deterministic fallback when no AI credentials exist.
Unambiguous own-order status, payment-submission, reorder, and fully confirmed single-item order
flows are server-routed through `runApprovedTool()` before provider inference; this preserves the
same tool authorization/audit guarantees while removing model tool-selection variance.

Proactive Inbox follow-ups use the same archetype commerce policy (sales motion, discovery, basket,
repeat purchase, and fulfillment) in their bounded context, so a B2B or Restaurant follow-up does
not fall back to generic-shop guidance merely because its legacy `businessType` is coarse.

The runtime marks two prompt-cache breakpoints: the end of the filtered tool definitions and the end
of the system prompt. Both blocks must be byte-identical across requests from the same shop, so
anything that varies per conversation — intent guidance, compressed history summary and durable order slot
memory — is sent as a second system block placed *after* the breakpoint (`volatileSystem`), where it
can change without invalidating the cached prefix. The stable system block may still vary by tenant
because it includes that shop's categories, precise archetype examples (or legacy business-type
examples when no archetype exists), and validated AI policy from
`bms_store_profile`. The `input_tokens` column on a usage event is the *sum* of regular, cache-write, and
cache-read tokens, so it does not fall when a cache hits and cannot be used to tell whether caching is
working; `estimated_cost` applies the active provider's configured rates. Anthropic prompt caching uses
write 1.25x and read 0.1x, while other providers may price cache hits differently, and the
per-rate breakdown is stored under `meta.cache_read_input_tokens` /
`meta.cache_creation_input_tokens` / `meta.regular_input_tokens`. Those keys are absent — not zero —
on call paths that never set `cache_control`; a zero means the breakpoint was sent but did not hit.
Usage metadata also records intent, fetched/sent history counts, compression flag, summary
characters, business type, and provider-routing reason without storing prompt or customer text.

Which breakpoint actually fires depends on the surface, because a prefix below the model's minimum is
skipped silently with no error (Claude Haiku 4.5: 4,096 tokens). Measured on
`claude-haiku-4-5-20251001`:

| Surface | Tools block | Tools + system | Tool-only breakpoint |
| --- | --- | --- | --- |
| Customer (historical 15-tool measurement, before catalog-discovery expansion) | 2,545 | 4,754 | below minimum, does not fire |
| Staff (58 tools, Administrator) | 6,989 | — | fires |

Staff figures are for a role holding every permission; `staffTools(perms)` filters by RBAC, so a
narrower role sends a smaller — and separately cached — tool block.
The current customer registry has 21 tools after adding checkout completeness/read-save and coupon tools.
Re-measure token counts before relying on an exact headroom figure; production truth
remains `cache_read_input_tokens` in the usage event.

The customer surface therefore relies on the tools + system breakpoint.

> ⚠️ **The real headroom is far thinner than the table suggests.** Production traffic on
> 2026-07-28 confirmed caching is live, but the prefix the API actually matched was **~4,130 tokens**,
> not the 4,754 measured here with `count_tokens` — only about **35 tokens above the 4,096 minimum
> (~0.8%)**, not the ~16% the isolated measurement implies. Treat 4,754 as an upper bound on the
> block's own size and ~4,130 as the number that matters. Any trim to `buildCustomerSystem()` — or a
> shop whose injected category list is shorter than the one measured — can drop the prefix under the
> minimum, at which point caching stops **silently, with no error**, and the customer surface goes
> back to paying full input rate on every one of up to 5 rounds per message.

Confirm caching is live from the usage event itself rather than the absence of an error, and rather
than from the Console's Caching dashboard (which lagged ~4h behind live traffic when this was checked):

```bash
docker exec bms-postgres-1 psql -U app -d bms -c "SELECT created_at::time(0), input_tokens, meta->>'cache_read_input_tokens' AS cache_read, meta->>'regular_input_tokens' AS regular, estimated_cost FROM bms_ai_usage_events WHERE feature='customer_tool_loop' ORDER BY created_at DESC LIMIT 10;"
```

A healthy customer request shows `cache_read` ≈ 4,100+ with `regular` in the low hundreds. If
`cache_read` is `0` the breakpoint is being sent but never hitting (prefix varies per request, or the
5-minute TTL expired between messages); if the keys are missing entirely, that call path does not set
`cache_control` at all. Before this breakdown existed the only way to tell was to solve for it from
`estimated_cost`, which is why the thin-headroom regression above went unnoticed.

### Tool description language

Tool `description` and per-field descriptions are written in **English**, while customer-facing copy
follows the tenant's configured Thai, English, or latest-message language. The pharmacy clinical
intake remains fixed Thai backend copy by design. English tool schemas are a token decision, not a style one: Thai barely
merges under the tokenizer and costs roughly 3.2–4.6 tokens per character against 0.78 for English,
so the same rules in English are ~3.7x cheaper even when the English text is longer in characters.
Translating the tool definitions cut the customer block from 14,829 to 2,545 tokens and the full staff
block from 20,517 to 6,989. Everything the model reads *about* a tool stays English; system prompts and
deterministic customer replies may be localized, while staff proposal summaries and pharmacy clinical
copy stay Thai. Keep new tool descriptions in English and preserve the language policy of the surface
that renders the result.

## Standing rules that constrain every prompt/tool interaction

From [../business/](../business/) and [CLAUDE.md](../../CLAUDE.md) — these apply regardless of
model or prompt wording:

- AI **never** writes SQL, and never accesses the database directly.
- AI **only** calls the approved tools in [tools.md](tools.md) — never a raw service function.
- AI **never** fabricates stock, price, or order data — every number it states must trace back to
  a tool result.
- AI must ask for **human confirmation** before: deleting anything, refunding, cancelling, changing
  a price, or adjusting inventory. `verifyPaymentSlip()` is the canonical example — the active
  `SlipReader` provider reads the slip and suggests a match, but a human still has to click Confirm.
- Every AI-initiated write is logged to `bms_audit_log` via `audit()` (best-effort — a logging
  failure never blocks the underlying action).
- Every tool attempt is also logged centrally as redacted `ai.tool_call` metadata; raw arguments,
  customer messages, and prompt content are deliberately excluded.
- Prompt wording is never the last line of defence for the customer-facing voice: every reply also
  passes `customerSafe()` in `pipeline.ts`, which shortens full UUIDs to eight characters and
  normalizes the shop persona (`ครับ` → `ค่ะ`, standalone `ผม` → `ทางร้าน`) — so a model slip or an
  old template cannot change who the shop sounds like.

## Ops prompt — Daily Log Triage

A second, unrelated prompt drives `scripts/bms-log-triage/` (see [workflow.md](workflow.md) for the
full flow): given redacted error logs, Claude proposes a minimal patch and opens a **draft PR only**
— it never merges, never touches migrations/secrets/config, and a human always reviews before
anything reaches `main`.
