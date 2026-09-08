# AI Usage Accounting How-To

This guide explains how BMS calculates customer-facing AI credits, provider calls, tokens, and
attributed provider cost. These are separate dimensions and must not be converted into one another.

## 1. Billable credits

BMS bills by logical request, not by token count:

```text
billable_credits =
  1  when a finite-plan logical request starts at least one shared-provider call
  0  for BYOK, an unlimited plan, a provider retry/fallback, or no provider call
```

A logical request is one customer message, one staff-assistant turn, or one system action such as
generating a follow-up. A tool loop can call the provider up to five times and still consume one
credit. OCR primary and fallback events share `meta.usage_group_id`, so they also remain one logical
request.

`limit` is therefore a request ceiling and **never a token ceiling**. Measured on real traffic a
single credit averaged roughly 20,000 tokens (customer tool loops) — so a shop can spend millions of
tokens in a month while the credit counter is nowhere near full. That is the counter working as
designed, not a miscount. If you need to answer "how much did we actually use", read the token and
cost figures, not `count`/`limit`.

The system reserves a finite-plan shared credit before provider I/O so concurrent requests cannot
exceed quota. If the request ends with `provider_calls = 0`, finalization returns the credit and
appends a `refund` ledger entry atomically.

A reservation left unfinished for more than 15 minutes is swept, and the sweep resolves **three**
different states — collapsing them into one is how a shop gets free quota for calls it really paid
for:

| State on the row | What happened | Credit |
| --- | --- | --- |
| `provider_calls = 0`, no incident | Aborted before any provider I/O | Refunded (`provider_not_started_timeout`) |
| `provider_calls = 0`, `ai.provider_attempt_unrecorded` incident for the event | The provider *was* called; only the bookkeeping write failed | **Kept** (`provider_attempt_unrecorded`) |
| `provider_calls > 0` | Provider ran, finalization never completed | **Kept** (`usage_finalization_timeout`) |

The middle row is only distinguishable because `recordAiProviderAttempt()` reports an incident when
its write does not land. Both zero-call rows look identical on the event itself.

## 2. Provider calls

`provider_calls` counts actual provider attempts, including failed attempts:

```text
provider_calls = initial call + tool-loop rounds + validation retries + provider fallbacks
```

This number explains operational load. It does not determine credits. For example:

```text
One shared tool-loop request
Provider round 1 -> tool call
Provider round 2 -> tool call
Provider round 3 -> final answer

Result: 1 logical request, 1 billable credit, 3 provider calls
```

## 3. Tokens and attributed cost

For a call without prompt caching:

```text
cost_usd =
  (input_tokens  / 1,000,000 * input_rate_usd_per_million) +
  (output_tokens / 1,000,000 * output_rate_usd_per_million)
```

For a call with prompt caching:

```text
cost_usd =
  (regular_input_tokens        / 1,000,000 * input_rate) +
  (cache_creation_input_tokens / 1,000,000 * input_rate * cache_write_multiplier) +
  (cache_read_input_tokens     / 1,000,000 * input_rate * cache_read_multiplier) +
  (output_tokens               / 1,000,000 * output_rate)
```

The provider/model rate card in `apps/web/lib/bms/aiUsage.ts` is authoritative for attribution.
Environment overrides are supported where documented for regional Qwen OCR pricing. Changing a rate
changes attributed USD cost, not the logical-request credit policy.

`input_tokens` on the event is the total of regular, cache-creation, and cache-read input tokens. The
breakdown remains in event metadata as `regular_input_tokens`, `cache_creation_input_tokens`, and
`cache_read_input_tokens`.

## 4. Partial or missing usage

- If every attempt returns usage and the model rate is known, `actual_cost_usd` contains the attributed
  cost and `unpriced_provider_calls = 0`.
- If only some usage is available, BMS retains the cost it can prove and counts incomplete attempts in
  `unpriced_provider_calls`.
- If no attempt can be priced, `actual_cost_usd` is `NULL`, not zero.
- An unknown model is unpriced rather than silently assigned another model's rate.

- If finalization itself fails, the row keeps no tokens and no cost at all. The provider response is
  gone by then, so **those tokens are unrecoverable and must not be back-filled with a guess** — the
  row stays visible as an unpriced attempt and raises `ai.usage_finalize_failed`. This is not
  hypothetical: a parameter that Postgres inferred as `integer` made every fractional-cost
  finalization throw, so BMS-LIVE recorded `0 in / 0 out` for months while the calls were real. Any
  surface showing tokens must render "unknown" as unknown, never as `0`.

`actual_cost_usd` is an internal cost attribution based on provider-reported usage and the configured
rate card. It is not the provider invoice and excludes platform-wide health probes.

To check whether a database is affected, run
[`db/checks/ai-usage-consistency.sql`](../../db/checks/ai-usage-consistency.sql) — read-only, and
written as SQL rather than a script because the production host has no Node. It reports how often the
real finalization path succeeded, the matching incidents, monthly-counter drift against the events,
and the share of provider calls with no token data.

## 5. Audit a charge

Use `/admin/billing` in this order:

1. **Used this month** shows total `billable_credits`, logical requests, and provider calls.
2. **Tokens used this month** shows the input/output totals the events recorded. It is labelled as
   not counting against the quota on purpose, because that is the question the credit card cannot
   answer.
3. **Usage split** explains credits, calls, tokens, known cost, and unpriced calls by feature — the
   total says how much was spent, this says what spent it.
4. **Credit ledger** shows every grant, consume, adjustment, bonus, and refund with `balance_after`.
5. **Provider cost from usage** sums known `actual_cost_usd`; check the unpriced warning before treating
   it as complete.

The reconciliation identity for a finite plan is:

```text
remaining = max(granted + bonus + adjusted - consumed, 0)

consumed = sum(billable_credits for finalized and active reserved events)
```

Examples:

| Scenario | Logical requests | Billable credits | Provider calls | Cost |
| --- | ---: | ---: | ---: | --- |
| Shared provider succeeds once | 1 | 1 | 1 | Tokens from one call |
| Shared tool loop uses three rounds | 1 | 1 | 3 | Sum of three calls |
| Qwen OCR fails, Anthropic fallback succeeds | 1 | 1 | 2 | Known cost plus one unpriced call when failure returned no usage |
| Tenant BYOK succeeds | 1 | 0 | 1 | Attributed to the tenant event, paid through its own key |
| Slip image cannot be loaded | 1 | 0 after refund | 0 | $0 |
| Unlimited-plan shared call | 1 | 0 | 1 | Provider cost is still attributed |
