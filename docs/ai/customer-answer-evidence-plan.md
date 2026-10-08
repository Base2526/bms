# Customer answer evidence — implementation plan

Status: implemented on the feature branch; deployment and production-like/live-model release checks remain pending.
Date: 2026-10-08. Branch: `codex/customer-ai-answer-evidence`.
Starting point: `17dd385e` on `develop`.

The owner reports no real customer rollout yet. Use this window to implement the complete
customer-turn contract before launch, with synthetic/sandbox fixtures. Preserve existing data,
applied migration checksums and public APIs; do not reset databases or backfill invented evidence.

## Outcome and boundaries

For each new persisted customer AI reply, an authorized reviewer can follow explicit links to:

1. The incoming message that triggered it.
2. Every tool attempt, its sequence, safe arguments and execution outcome.
3. A bounded snapshot of permitted facts available at that time.
4. The final sanitized reply after guards and deterministic replacement.

Capture coverage, tool/business outcomes, message delivery and answer correctness are separate
dimensions. A complete evidence record or a successful tool call does not prove a correct answer.
An outage can prevent recording; expose that gap rather than promising lossless capture.

Scope: customer `runPipeline` paths, approved customer tools, channel adapters, Inbox persistence,
AI Quality review UI and evidence maintenance. Staff assistant uses the same runtime and must
remain compatible, but its data capture is outside this release. Broad automatic semantic grading,
new provider calls, and raw prompt/model-response archives are follow-up work.

## Verified starting points

- `inbox.ts:logConversation` inserts IN/OUT messages together and stores only `meta.aiQuality`.
  It is best-effort, returns void and reports message loss separately from later UI/assignment errors.
- `runtime.ts` has in-memory input/summary traces and minimal `ai.tool_call` audits. Neither is
  a persisted per-turn result snapshot. Keep audit arguments and customer content out of the log.
- Both `runApprovedTool` and model-selected tool execution must be covered. `get_store_info`
  prefetch is projected again by `customerStoreMessages` before entering the model context.
- `pipeline.ts` has many early returns, guards, historical state and deterministic paths.
  Capturing only the final tool loop misses these paths.
- `aiQuality.ts` currently pairs a reply with the nearest earlier inbound message. New turns
  need exact message IDs, especially under concurrency. Legacy pairing remains labeled approximate.
- Review cases are sampled (~5% normal turns plus failure signals), not a list of every turn.
  Review metadata retention is 180 days, pruned when a new case is enqueued. This is not proof
  of a timed purge for all Inbox messages or all future evidence.
- LINE persists generated text before delivery. Saved OUT text is not proof of delivery.
- The catalog uses factories (including three board-game reads). Count registered tool names
  from the actual catalog, not source matches such as the earlier estimate of 35 definitions.

## Design decisions

### Identity and safe transport

Generate a server-owned `turnId` at the channel/pipeline entry and a per-attempt call ID. The
channel keeps the collector if pipeline execution throws, so error fallback preserves prior
attempt metadata. IDs never grant tenant/customer authority. Reuse verified inbound event
identity where the channel already has deduplication; do not deduplicate by text, customer or
timestamp. A persistence retry reuses the turn ID and never reruns a domain write.

Keep evidence server-only. Do not spread it into existing `NextResponse.json(result)` responses,
demo traces, widget replies or staff GraphQL. Add explicit public/debug response projections and
test these serialization boundaries before extending `PipelineResult` or `ExecCtx`.

Capture final sanitized text through its existing `bms_messages` row, not another text copy.
Store a digest of that text for mismatch detection; a digest does not prove factual truth or
protect against a privileged actor changing both records. No raw generated draft is retained.

### Data model (names provisional until implementation)

`bms_ai_turn_evidence` contains tenant/turn/conversation IDs, exact customer and AI message IDs,
reply origin (`MODEL`, `DETERMINISTIC`, `GUARD`, `HANDOFF`, `CHANNEL_FALLBACK`), schema version,
capture status, reason codes, original/retained attempt counts, final-reply digest, timestamps,
expiry and application/policy version. Provider/model and usage-event references are optional
server-derived metadata; do not copy usage costs or change accounting.

Capture status is `COMPLETE`, `PARTIAL`, `NOT_APPLICABLE`, `FAILED`, or `EXPIRED`. A legacy
message with no evidence is displayed as `NOT_CAPTURED`, not silently counted as complete.
`COMPLETE` means all required allowlisted evidence under that versioned contract was captured.
Intentional sensitive-field omissions remain visible. It never means all claims are checkable.

`bms_ai_tool_evidence` contains tenant/turn IDs, sequence/call ID, tool name, source
(`PREFETCH`, `MODEL_SELECTED`, `DETERMINISTIC`), execution outcome, safe input/output,
projection version, timing, byte counts, omitted fields and truncation reasons. Separate
transport success from a tool's business status (for example REQUESTED, not CONFIRMED).
Duplicate suppression records a reference to the original execution rather than implying a
second write. A fresh read remains a distinct snapshot. Timeout means outcome unknown when
the underlying operation may still complete; it is not proof that nothing was written.

Use a new ordered idempotent migration, never rewrite applied SQL. Add unique tenant/turn and
turn/sequence keys, an AI-message uniqueness constraint, tenant/date and FK indexes, RLS and
grants. Enforce same tenant/conversation on source-message links in the service and suitable
composite constraints; globally unique IDs alone do not enforce tenant consistency. Missing
tenant context must not grant access. Message/conversation deletion cascades to evidence.

### Evidence projections

Each registered customer tool declares a pure, versioned allowlist projection policy. Default
for an unknown/missing policy is metadata-only PARTIAL, with a contract failure before release.
Drop unknown payload fields and record omission; never copy the raw object as a fallback.
Projection failure affects capture only, not the business operation's recorded outcome.

| Tool family | Retain for review | Exclude or restrict |
| --- | --- | --- |
| Store, parking, public tables, playable library | Published facts, requested/resolved public branch labels, null/unknown/truncation and read time | Unpublished profile data, occupants, session/table/customer identifiers |
| Catalog, stock, prices | Bounded products/variants, units, currency, prices, availability and explicit query scope | Cost/margin, private supplier or customer data |
| Own orders, bookings, writes | Safe action status, quantities/amounts, confirmation evidence status, authorized record references | Bearer links/tokens, contact/address fields, unrelated customer history |
| Checkout contact | Completeness flags, missing field names, write status | Raw name, email, phone, address and external identity |
| Payments | Configured methods, safe status and numeric amounts | Account/PromptPay identifiers, QR payloads, slip data and signed checkout URLs |
| Pharmacy | Approved coarse workflow states only | Clinical notes, OCR, prescriptions, patient details and evidence-file identifiers |

An allowlisted string can still contain PII or an embedded credential. Apply bounded per-field
redaction, URL query/fragment rules and malicious-content fixtures. Never execute/render it as
HTML. Public store contacts differ from customer contacts; explicitly classify any allowed
contact field instead of assuming a global phone/email regex provides complete privacy.

Do not add new HMAC key infrastructure for account-number comparison in phase 1. Such claims
are marked not checkable from retained evidence. A future verifier must define keyed digest
normalization, rotation and access before comparing sensitive values.

Snapshot both source role and consumption role: facts returned by a tool are not necessarily
the same projection forwarded to the model. Store the safe model-visible projection where
applicable and identify server-only facts used by final guards. Avoid duplicating identical
snapshots. A prefetch subsequently replaced by a failed read remains in the timeline but cannot
be presented as current authority for the reply.

Initialize a collector before early returns. Record deterministic policy IDs and safe provenance
for history/confirmed-state dependencies, or PARTIAL when reconstruction is unavailable. Do
not copy full chat history, summaries or system prompts. A factual no-tool answer is not
automatically NOT_APPLICABLE; classify whether factual authority was required.

### Persistence and failures

Use a tenant-scoped service with an object-shaped turn input; message-pair IDs and evidence
header are linked explicitly. Prepare bounded projections before acquiring the transaction.
Use bulk insertion for call rows. No provider or network call runs inside the transaction.

On a healthy database, messages, header and evidence commit together. Use a savepoint around
optional evidence-detail writes: on failure, preserve IN/OUT messages, mark capture FAILED with
a stable reason, and report an operational failure after commit. If the evidence schema is
unavailable during rollout, preserve messages with a small missing-capture marker. The review
queue, assignment and notifications must not roll back saved messages. Complete database
failure remains observable best-effort loss; never retry the model or an order to recover QA.

This replaces the earlier suggestion to roll back chat messages just because QA storage failed.
No source messages are deliberately discarded for missing analytics. Persisting only at turn
completion cannot recover a process crash mid-execution; a durable per-call journal would be
separate work if that guarantee is later required.

Persist generated reply independently of delivery. Reuse existing channel delivery reporting
and associate its outcome with the exact saved reply when supported. Display SENT/FAILED/UNKNOWN
only when backed by transport evidence; a returned HTTP response is not proof the customer read it.
Failure of delivery must not rerun the pipeline or create another business action.

### Access, retention and size

Use existing `ai_quality.view` for already-approved redacted customer evidence and
`ai_quality.review` for verdicts. Generic quality access must not widen access to clinical or
otherwise restricted domain data; use metadata-only projections there and existing domain gates
for drill-down. Tenant scope comes from the authenticated session. No customer-facing evidence API.

Working retention default: snapshots for 90 days, review metadata for its existing 180 days.
Source-message deletion or shorter applicable retention wins. After payload expiry retain only
bounded capture/expiry metadata needed for the linked review, then purge it on the defined
header-retention schedule. Document backup expiry separately; online deletion does not erase
old backups immediately. This is a product default, not a legal retention determination.

Implement a bounded, indexed purge job with `authorizeCronRequest`, multi-instance-safe batches,
`recordJobRun`, operations-schedule visibility and wiring for both Cloud and Retail Local. Do
not rely exclusively on future customer traffic to trigger cleanup.

Starting capture limits: 2 KiB safe arguments, 8 KiB safe output per attempt, 64 KiB total per
turn and 20 detailed attempts. Count UTF-8 bytes after projection; preserve valid JSON and
explicit omission reasons. Metadata counts include omitted attempts. Evidence caps never stop
business execution. Five provider rounds do not cap the number of calls in each round.
Tune only after measuring representative fixtures. For illustration, 10,000 turns/day at an
average 8 KiB adds about 78 MiB/day (~6.9 GiB/90 days) of payload alone, excluding indexes/WAL/backups.

## Ordered implementation work

| Step | Changes and principal files | Completion evidence |
| --- | --- | --- |
| 1. Inventory and contract | Enumerate actual `customerTools()` variants/factories; map all pipeline returns, state dependencies, channel fallbacks and response serializers. Define projections in `tools/types.ts` plus a focused evidence module. | Registry coverage matrix; each tool/path captured or explicitly limited; no evidence in public responses |
| 2. Storage and lifecycle | New migration, tenant-scoped `aiAnswerEvidence.ts`, readiness entries, retention worker and scheduler wiring | Local disposable DB tests for RLS, cross-tenant/message mismatch, idempotency, cascades, savepoint failure and expiry |
| 3. Collect evidence | `tools/runtime.ts`, `tools/catalog.ts`, `customerStoreContext.ts`, pipeline entry/finalization | Both execution paths, prefetch projection, repeated reads, dedup, errors and late timeout completion covered |
| 4. Persist every channel | `inbox.ts`, chat/demo/Web/LINE/Meta/TikTok/Shopee/Lazada adapters and fallback paths | Exact message pairing, retry/concurrency behavior, capture failure and delivery failure tests; zero repeated domain writes |
| 5. Review surface | `aiQuality.ts`, `bmsAiQuality.ts`, GraphQL typeDefs/export, AI Quality page/CSS, th/en dictionaries | Evidence timeline and exact triggering input; COMPLETE/PARTIAL/FAILED/EXPIRED/legacy states; access tests and desktop/mobile browser check |
| 6. Operations and documentation | `docs/AI_GUIDELINES.md`, invariants, quality/tools/workflow docs, database/API docs and admin manual | New safe evidence store explicitly distinguished from raw-data-free audit; usage charges unchanged; Cloud/Local deployment checks documented |
| 7. Prelaunch verification | Meaningful pure/DB suites, schema export, typecheck, build, sandbox live-model exercise | Acceptance matrix below and measured latency/storage; release report distinguishes mocked, DB and live results |

Each step is a reviewable commit. Steps 2 and 3 follow the agreed types from step 1; all steps
must be complete before claiming per-turn evidence coverage. Capture every supported new turn,
while keeping the human review queue sampled. Add lookup from an authorized Inbox message or
turn search so a non-sampled reply is inspectable too. Resolve exact paths and migration number
from the current repository during implementation.

AI Quality must display operational SUCCESS separately from human PASS and future factual
checks. Add evidence coverage rates with explicit eligible-turn denominators; do not call
tool success or evidence completeness an accuracy percentage. Additive GraphQL fields preserve
existing consumers. Safe JSON payloads are server-projected and bounded, never arbitrary raw exports.

## Acceptance matrix

- Restaurant, board-game and retail store/parking answers retain the selected branch facts,
  null/zero/publication distinction, fee conditions and time of read. No live-vacancy claim is inferred.
- Prefetch, new branch read, repeated publication change and failed latest read are separately
  visible; the final answer is linked to the actual final guard outcome.
- Catalog multi-item and no-provider answers retain every required safe source, with explicit
  PARTIAL for overflow; no second requested-item splitter or pricing implementation is introduced.
- A successful write followed by provider/persistence/delivery failure does not repeat the write.
- Wrong/unknown tool, denied args, tool error, timeout, proposal and duplicate suppression have
  distinct execution records; errors contain stable codes without SQL/stack/customer details.
- Secrets and prohibited data planted at every nesting level never enter evidence, audit, browser
  responses or operational error messages. Existing tool tests still verify authorization behavior.
- Concurrent turns pair their own inputs/outputs; repeated persistence of one turn is idempotent.
- Missing migration, projector failure and evidence-insert failure preserve chat availability and
  expose missing evidence. Total DB failure is reported without claiming persistence succeeded.
- Tenant/RBAC/domain restrictions hold on list/detail/lookup and when following record links.
- Expired and legacy evidence cannot render as complete or be rebuilt from today's shop settings.
- UI retains Thai/English parity and works at desktop/mobile sizes with long bounded payloads.
- Schema export, appropriate contract suites, typecheck and build pass; pre-existing failures are
  documented separately. No full build is required for this planning-only change.

## Release and follow-up

Deploy the additive migration before enabling capture, then the application/retention job and
verify healthy capture on a synthetic shop. Retail Local packages must contain the matching
migration and app version; there is no installer-question change in this feature. Do not publish
or deploy as part of planning. App rollback may disable capture while preserving collected rows;
do not remove the tables or change applied migration checksums for rollback.

After evidence capture works end to end, add narrow factual checks for parking/table facts,
then catalog/stock/order/booking status. Store machine checks separately from human verdicts,
with checker version, supported claim types and NOT_CHECKABLE results. Broad prose quality and
condition completeness still need reviewer judgment. No old answer is marked factually verified
by re-reading present-day data.

## Progress

- [x] Inspect current paths and create the implementation branch.
- [x] Record design, corrections to the earlier proposal, scope and acceptance criteria.
- [x] Inventory and finalize evidence types/projection policies (actual customer registry coverage test).
- [x] Implement storage, collector and channel persistence (`10.53`, savepoint failure marker and exact pairing).
- [x] Implement review UI and retention/operational wiring (Cloud daily and Retail Local six-hour timer).
- [ ] Complete DB, integration, UI and sandbox verification before rollout.

### Implemented contract and verification

- The implementation uses `customerAnswerEvidence.ts` (pure projections/request-local collection)
  and `answerEvidenceStore.ts` (tenant-scoped storage/lookup/retention). A WeakMap keyed by the
  existing quality object keeps evidence out of public JSON without changing channel response shapes.
- Origins distinguish model-with-guards, deterministic-or-guarded, and terminal fallback rather
  than claiming a precise model-versus-guard split that the current pipeline cannot establish.
  Historical-state provenance and private/status-only fields remain explicitly PARTIAL. Schema
  and projection version are recorded; provider usage linkage and deployment commit linkage are
  not added in this release. Duplicate entries are labeled suppressed, not counted as new writes.
- Pure tests cover actual registry policies, public table/parking facts, private-field omission,
  UTF-8 caps, concurrent tenant isolation, output serialization, prefetch projection, fallback,
  denied/unknown/malformed/duplicate attempts, timeout and late completion, cron pagination/authority.
- Disposable PostgreSQL tests exercise the new migration twice, actual runtime RLS and grants,
  tenant/message FK rejection, concurrent dedup, exact pairing, batched snapshot insertion,
  evidence savepoint rollback with messages preserved, missing schema reads, expiry and cascades.
  This is an isolated minimal schema, not a restored production-like migration chain.
- Browser smoke uses the actual `/admin/ai-quality` route with synthetic API fixtures, Thai and
  English, 1440 px and 390 px widths, non-sampled lookup and capture states; no live provider or
  business mutation is involved. Production-like full-schema and live-model sandbox verification
  remain release gates; no real customer data, deployment, push or installer package is needed
  for this implementation request.
- Run `node scripts/run-contract-tests.mjs pure customer-answer-evidence`; disposable DB suite
  requires `BMS_EVIDENCE_DISPOSABLE_DB=1` and a fresh isolated PostgreSQL at 127.0.0.1:55453 named
  `evidence_test` (see the suite's deliberately fixed test-only credentials). Browser smoke is
  `scripts/answer-evidence-browser-smoke.mjs` with `BMS_SMOKE_URL` and `BMS_PLAYWRIGHT_MODULE`.
- The existing full-suite failure in `admin-navigation-contract` concerns dismiss buttons in
  `CustomerOrderDetail.tsx:33` and `DashboardActions.tsx:111`, outside this feature's changes.

Local verification on 2026-10-08: typecheck and production build passed (build-time reads of the
unconfigured default localhost:5432 database logged the existing connection warnings); the full
pure suite passed 2,522 tests, failed the one unrelated alert contract above, and skipped two.
The 12 dedicated evidence contracts and the disposable PostgreSQL integration test passed.
Browser smoke passed for both languages at both viewport widths after the final UI build.
The temporary PostgreSQL fixture is disposable and contains synthetic records only.
