# AI Quality Control

> Entry point: [AI guidelines](../AI_GUIDELINES.md) · Data: [../architecture/database.md](../architecture/database.md)

The admin route `/admin/ai-quality` turns production AI responses into measurable, reviewable
signals without creating a second copy of customer conversations.

## Unit of measurement

Metrics count an **AI turn** (one persisted outbound message with `sender='ai'`), not a conversation.
A BMS conversation is long-lived per customer/channel and can contain several unrelated requests
across multiple days, so conversation-level rates would be misleading.

Every new AI turn stores a bounded `meta.aiQuality` object on its existing `bms_messages` row:

```json
{
  "outcome": "SUCCESS",
  "reasonCodes": ["VERIFIED_TOOL_RESULT"],
  "successfulToolCalls": 1,
  "failedToolCalls": 0
}
```

It never stores a prompt, tool arguments, customer reference, or an additional copy of message
text. The available outcomes are:

| Outcome | Meaning |
| --- | --- |
| `SUCCESS` | Answered normally, used a verified tool result, completed an order, or used an approved deterministic response |
| `CLARIFICATION` | Asked for a required product/order/payment field |
| `HANDOFF` | The turn-budget policy explicitly handed the conversation to staff |
| `UNRESOLVED` | Returned a safe guard/retry response without resolving the request |
| `FAILURE` | One or more tool calls failed and no tool call succeeded |

Rates shown in the UI are:

- `successRate = SUCCESS / total instrumented AI turns`
- `handoffRate = HANDOFF / total instrumented AI turns`
- `unresolvedRate = (UNRESOLVED + FAILURE) / total instrumented AI turns`

Clarification is shown separately and is not treated as failure: asking for a genuinely missing
field is correct behavior.

## Review queue

`bms_ai_quality_reviews` stores review metadata and foreign keys to the existing conversation and
AI message. It does not retain raw chat content. Rows are created for:

- every `FAILURE`, `HANDOFF`, and `UNRESOLVED` turn (`AUTO_FAILURE`);
- a stable sample of about 5% of other turns (`AUTO_SAMPLE`) to detect silent false positives and
  failures that automatic rules cannot see.

Deleting the source conversation/message cascades to its review row. List previews and the review
drawer redact email addresses, phone numbers, URLs, UUIDs, and long numeric identifiers on the
server before returning them to the UI.

Review-queue metadata is retained for 180 days and old rows are pruned tenant-by-tenant when a new
case is queued. This limit applies only to `bms_ai_quality_reviews`; the source Inbox message keeps
the product's existing conversation-retention policy.

Human reviewers record `PASS`, `FAIL`, or `UNCLEAR`, a bounded category, and an optional note.
Irrelevant samples can be marked `DISMISSED` and remain available through the status filter.
Review metadata is audited as `ai_quality.review` or `ai_quality.dismiss`; raw message text is not
copied into the audit log.

## Access control

- `ai_quality.view` permits tenant-scoped metrics and redacted review context.
- `ai_quality.review` permits recording or changing a human verdict.
- Managers receive both permissions by default. Administrators receive the full permission catalog.
- RLS on `bms_ai_quality_reviews` enforces tenant isolation.

The current UI is tenant-scoped. Platform admins use the existing tenant drill-down flow before
viewing a shop's quality data; there is no unrestricted cross-tenant chat export.

## Operational notes

Metrics start when migration `7.31` is deployed and new turns receive `meta.aiQuality`; old messages
are intentionally not guessed or backfilled. The automatic outcome is a triage signal, not ground
truth. Human verdicts are the evidence used to decide whether to adjust a prompt, tool, backend
rule, or handoff policy.
