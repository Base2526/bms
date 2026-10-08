# AI Quality Control

> Entry point: [AI guidelines](../AI_GUIDELINES.md) · Data: [../architecture/database.md](../architecture/database.md)

The admin route `/admin/ai-quality` turns production AI responses into measurable, reviewable
signals without creating a second copy of customer conversations.

Customer answer evidence (`10.53`) now supplements the existing quality signals. The
[design and release checklist](customer-answer-evidence-plan.md) records scope and rollout gates.

## Per-turn answer evidence

Every persisted customer `runPipeline` result carries server-only evidence via a request-local
collector and a WeakMap association with its quality object. Nothing is added to the enumerable
public pipeline result. All registered customer tools have an explicit public-fact or status-only
projection policy; unknown tools default to empty PARTIAL snapshots. Both server-selected and
model-selected attempts are captured, including denial, error, duplicate suppression and timeout
(`timeout_effect_unknown`: the underlying operation may still commit). Store prefetch records the
safe projection actually forwarded into model context. Staff tools are not captured.

`logConversation` commits the IN/OUT pair and evidence together, using a savepoint for evidence
failure. Failed snapshots leave an explicit FAILED marker while keeping messages. The same turn
ID deduplicates persistence retries under an advisory lock; it does not rerun business actions.
The output metadata holds the exact input message ID even when evidence fails. Legacy rows retain
the old approximate queue preview, while evidence inspection explicitly says no exact pair exists.
Pipeline exceptions return one safe terminal reply with the original collector for every channel.
Fallback counters retain completed attempts even beyond the detailed-snapshot cap; the terminal
reply asks staff to check an order/booking/payment before repeating it, since a write may have
completed before a later failure. Projection/JSON-decoding failures affect evidence only, not replies.
Non-text/manual replies and intentionally non-persisted playground turns are not AI evidence turns.

In `/admin/ai-quality`, open a review or search by AI message ID, including messages outside the
sampled review queue. `ai_quality.view` gates both lookup and capture counters; tenant context comes
from the session. The timeline shows safe inputs/outputs, timing, execution origin and omissions.
COMPLETE/PARTIAL/FAILED/NOT_CAPTURED/EXPIRED are not human PASS/FAIL. Coverage counts describe the
**capture-time status of all AI OUT messages** in the selected period, not accuracy. Delivery is
UNKNOWN because provider receipts are not yet linked to individual evidence records. Reply digests
detect stored-text mismatch, not privileged tampering or correctness.
The pipeline digest is preserved at persistence, not recomputed to bless a changed reply: a
pre-save mismatch is FAILED in both the header and capture counters. Missing original digests
are PARTIAL with `replyMatches: null`, never a successful match. Persistence validates a same-tenant,
same-conversation customer IN / AI OUT pair. Lookup rechecks exact message links, digest and saved
call counts; an integrity mismatch is FAILED, and a mismatched link hides the unverified timeline.
Read-time failures do not rewrite the historical capture counters. Header expiry is enforced on
read as well as snapshot expiry, even if the purge worker is delayed.

Privacy limits: no raw prompts, generated drafts, checkout names/contacts/addresses, bank accounts,
PromptPay identifiers, payment QR, signed URLs, clinical notes/OCR/prescription/file IDs or error
stacks are stored in snapshots. Clinical tools retain coarse metadata only. Public free text is
bounded and redacted; discarded fields and all status-only projections are visibly PARTIAL.
Projection v2 rejects scalar/nested-array entries in record arrays; only explicitly declared
scalar arrays (such as sizes/tags) accept them. This is a bounded structural allowlist and pattern
redaction, not a guarantee of detecting every identifier embedded in public free text.
History/state dependencies are not duplicated: their absence is explicitly marked. Current shop
settings are never used to reconstruct old facts. Retained strings render as text, never HTML.

Limits: 2 KiB safe input, 8 KiB safe output, 64 KiB projected payload per turn, 20 detailed attempts,
30 elements per array, 500 characters per string and depth 8. Original attempt count survives caps.
Caps affect recording, never whether business actions execute. Some legitimate answers will be
PARTIAL by design; inspect the reason codes rather than treating it as an AI failure.

Snapshots expire after 90 days; headers after 180 days. Reads immediately hide expired payloads.
`POST /api/bms/ai/evidence/purge-expired` requires configured cron authority, uses tenant RLS and
locked bounded batches, and records `ai-answer-evidence-retention` job runs. Its `afterTenant`
cursor is fleet progress, never tenant authorization. Cloud runs the paginated worker daily from
its own matrix entry in `bms-cron.yml`; Retail Local starts the same authenticated worker
after server startup and every six hours. Missing secrets fail visibly. Online source-message
deletion cascades evidence; backups retain snapshots until that backup's own expiry. Operators
must configure and verify backup retention separately (online deletion is not backup erasure).

Rollout: apply `10.53` before the application; check schema readiness and retention job history.
Missing tables degrade to FAILED evidence without losing message pairs. No destructive backfill,
new provider calls, usage charge changes, automated accuracy grading, deploy or installer build
is part of this change. Production-like full-schema and live-model sandbox checks remain release
gates even after disposable DB and mocked-browser checks pass.

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
