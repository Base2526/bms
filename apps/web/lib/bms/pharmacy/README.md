# AI Pharmacy Intake Assistant

AI takes a structured intake from a pharmacy customer (symptoms, allergies, current
medications, red flags) and hands a summary to a **licensed pharmacist**, who makes and
types the actual clinical decision. AI **never** diagnoses, creates a drug order, or
approves anything, and never sends a drug-related message to the customer directly —
every safety-critical decision (red flags, missing fields, state transitions, who may
approve) is enforced by deterministic server-side code, never by the LLM's own judgment.

**One deliberate, tightly-scoped exception** (added after the base module, at the user's
explicit request — see § AI medication suggestions below): AI may suggest specific drug/
strength/dosage candidates, but *only* as a pharmacist-only draft the pharmacist must
review, edit, and explicitly choose to use — this never reaches the customer on its own
and never bypasses the approve gate below.

## Status

Code + `tsc`/lint pass. **Not yet verified against a live Postgres or a live AI provider**
on this machine (no docker/DB running while this module was built) — see "Before relying on
this in production" below before treating any of it as verified end-to-end.

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `PHARMACY_INTAKE_ENABLED` | `false` | Master switch. Every entry point (pipeline branch, GraphQL resolvers, cron route) checks this first. |
| `PHARMACY_AI_ENABLED` | `false` | Whether the AI (extraction/next-question/summary) may run at all. `false` forces every turn straight to manual pharmacist review — no guessing. |
| `PHARMACY_PROTOCOLS_ENABLED` | *(empty)* | Comma list of `protocol_key`s allowed to run, e.g. `headache,cough,diarrhea`. A protocol also needs its own DB `enabled=true` — **both** gates must agree. |
| `PHARMACY_AI_PROVIDER` | *(unset → shared routing)* | Force `anthropic` or `deepseek` for pharmacy calls specifically. |
| `PHARMACY_AI_MODEL` | *(unset)* | Model override when `PHARMACY_AI_PROVIDER` is set. |
| `PHARMACY_ASSESSMENT_TTL_MINUTES` | `60` | Case expiry window; extended on every re-engagement loop. |

Pharmacy AI **always uses the platform shared key — never a tenant's own BYOK key**
(`lib/bms/pharmacy/ai.ts`'s `resolvePharmacyAiCredentials()` deliberately skips the BYOK
branch that `lib/bms/ai.ts`'s `resolveAiCredentials()` tries first for every other module).
This is a deliberate deviation, decided with the user: platform ops controls model/prompt
quality for this feature end-to-end, not each shop's own key. It still consumes the
tenant's monthly AI quota like any other shared-key call.

## Migrations (apply in order)

- `7.57__bms_pharmacy_rbac.sql` — new `Pharmacist` role, `users.is_licensed_pharmacist` +
  `pharmacist_license_no`, the 8 `pharmacy.*` permissions seeded to `Pharmacist` (all) and
  `Manager` (read/assign/protocol.manage/audit.read only — never
  review/approve/reject/request_more_information).
- `7.58__bms_pharmacy_protocols.sql` — protocol registry table + 3 MVP protocols
  (headache/cough/diarrhea) seeded **DRAFT, disabled, `clinically_approved=false`**.
- `7.59__bms_pharmacy_assessments.sql` — the core case entity.
- `7.60__bms_pharmacy_events.sql` — append-only clinical event trail
  (`bms_pharmacy_assessment_events`), in addition to `bms_audit_log`.
- `7.61__bms_conversations_pharmacy_intake.sql` — `bms_conversations.pharmacy_intake_case_id`.
- `7.62__bms_pharmacy_medication_suggestions.sql` — `bms_pharmacy_assessments.medication_suggestions`
  (pharmacist-only AI drug/dosage draft — see § AI medication suggestions).
- `7.64__bms_pharmacist_license_check.sql` — tenant-scoped `SECURITY DEFINER` boolean check used
  by clinical decisions, avoiding a broad `SELECT` grant on the `users` table.
- `7.71__bms_pharmacy_product_policy.sql` — SKU-level product type/regulatory/sale policy. Every
  row starts as Draft and requires licensed-pharmacist review; pharmacy order creation fails closed
  when an SKU has no approved policy.
- `7.72__bms_pharmacy_regulatory_classification.sql` — closed-set regulatory framework/class plus
  evidence source/reference; the admin workflow no longer accepts an arbitrary class string. Existing
  approved policies return to Draft once so a licensed pharmacist can verify the new evidence fields.
- `7.73__bms_pharmacy_product_framework_consistency.sql` — DB-level product-type/framework consistency;
  contradictory legacy rows fail closed to `UNKNOWN`/`DRAFT`.
- `7.83__bms_pharmacy_seed_protocol_safety_fields.sql` — repairs untouched MVP Drafts by declaring
  every safety/red-flag question referenced by their rules. This lets stores converted to the
  Pharmacy archetype submit the samples for review without weakening field-reference validation.

## Permissions

`pharmacy.assessment.read` / `.assign` / `.request_more_information` / `.review` /
`.approve` / `.reject`, `pharmacy.protocol.manage`, `pharmacy.audit.read`.

**`.approve`/`.reject`/`.review`'s permission check is not the whole story.** Every clinical
decision (`approveAssessment`/`rejectAssessment`/`referToDoctor` in `assessments.ts`) *also*
checks `users.is_licensed_pharmacist` unconditionally, with **no `Administrator` super-role
shortcut** — `loadPermissions()` in `lib/bms/permissions.ts` gives `Administrator` every
`BMS_PERMISSIONS` string automatically, and that bypass must never extend to "is this
person actually a licensed pharmacist," which is a fact about the human, not a
role/permission. A tenant's own `Administrator` account **cannot approve a case** unless
someone has separately set `is_licensed_pharmacist = true` on that user row.

## State machine

```
DRAFT → COLLECTING_INFORMATION → PENDING_CONFIRMATION → WAITING_FOR_PHARMACIST → PHARMACIST_REVIEWING
                    ↑                        ↑                    │
                    └── NEED_MORE_INFORMATION ┘         ┌──────────┼──────────┬─────────────────┐
                                                          ▼          ▼          ▼                 ▼
                                                     APPROVED   REJECTED  REFER_TO_DOCTOR   (any open state)
                                                          │          │          │            EMERGENCY_REFERRAL
                                                          └──────────┴──────────┴──────────────────┘
                                                                              ▼
                                                                           CLOSED
```

Only `PHARMACIST_REVIEWING` can reach `APPROVED`/`REJECTED`/`REFER_TO_DOCTOR` — a case can
never be one-hop approved straight out of intake. `EMERGENCY_REFERRAL` is reachable from
every open state because a red flag can appear mid-intake and must short-circuit
immediately. See `lib/bms/pharmacy/stateMachine.ts` for the full matrix and
`lib/bms/pharmacy/assessments.ts` for the guarded `UPDATE ... WHERE status = ANY($from)`
writes (same style as `lib/bms/orders.ts`/`lib/bms/payments.ts` — no generic FSM engine
exists in this codebase, and this module doesn't invent one either).

**Mechanical guarantee that AI can never approve**: `approveAssessment()` in
`assessments.ts` is the *only* function in the codebase that writes `status = 'APPROVED'`
(grep for the literal string across `lib/bms/pharmacy/**` and `graphql/**` to verify). No
function reachable from the AI/rule-engine layer (`lib/bms/pharmacy/intake.ts`) ever
includes `status` in a `SET` clause.

## Workflow

1. Customer says something matching a symptom keyword → deterministic entry, not AI-decided.
   Medicine-shaped but unclear wording is first clarified as named-product purchase vs symptom
   assessment. Pack count/container text alone never makes a generic symptom medicine a named
   product. A named-product purchase exits to commerce; it is not a clinical protocol.
   A direct request to speak with a pharmacist enters the existing assessment queue when an intake
   is active; without an active assessment it creates an internal Inbox handoff note and notifies
   available licensed pharmacists plus the assigned staff member, without creating synthetic health data.
   In Pharmacy Intake Lab, an approved `DIRECT_SALE` SKU is added to a session cart using the
   live catalog price. The customer can add multiple SKUs, change the latest item's quantity,
   remove an item, review line totals and the cart total, then confirm the cart once. Confirmation
   re-reads every SKU's current price/stock and Product Policy before creating a real test-channel
   order through the same `createOrder()` service used elsewhere; it does not create a pharmacy
   assessment queue row for this direct-sale path.
   If backend Product Policy requires a short safety check or pharmacist approval after the customer
   confirms an exact SKU/size/quantity, the customer tool creates an idempotent product-review case
   in the same Pharmacy Queue and returns an eight-character tracking id.
   Production customer chat also preserves a structured multi-item draft across turns. Corrections
   by product name or line number update only that line; an incomplete or ambiguous line prevents a
   partial order. Named-product lines mixed with generic symptom-medicine wording are retained while
   the customer clarifies purchase-vs-assessment intent, and one named item never makes the generic
   clinical line bypass that clarification. Configured selling units are resolved from
   `bms_product_packs` again inside the order transaction; tablet/capsule counts used as strength or
   package descriptors are not assumed to be the requested quantity.
   If one named line matches several live catalog SKUs, production chat persists server-owned,
   line-scoped choice codes (`A1/B2`, not repeated bare `1/2/3/4`) and requires exactly one choice
   for every ambiguous line. The selected SKU, size, stock, and configured selling unit are checked
   again before the backend composes a fresh whole-basket confirmation. A word such as `ยืนยัน`
   attached to the choice reply confirms only the selection step; it cannot skip the subsequent
   itemised basket confirmation or create a partial order.
2. Disclaimer ("AI ≠ pharmacist") + consent prompt, both fixed backend copy.
3. Consent granted → AI (or a deterministic fallback if AI is off) asks one question at a
   time, chosen from the protocol's own field list — it can never invent a new question.
   For the same canonical customer and `SELF` relationship only, the intake can reuse the newest
   consented and customer-confirmed age (up to 365 days old), biological sex, allergies, and chronic
   diseases. Purchase history by itself is not health-memory consent. Current medications,
   pregnancy, breastfeeding, and dependent-patient data are always collected again. Reuse is
   disclosed without echoing health values early, audited with per-field source assessment ids, and
   every value is shown again in the final confirmation; the customer's latest non-blank correction
   always wins and a null/blank AI extraction cannot erase known data.
4. Every answer is run through the deterministic rule engine
   (`lib/bms/pharmacy/ruleEngine.ts`): red flag → `EMERGENCY_REFERRAL` immediately (stop
   asking); missing fields → ask the next one; conflicting answers → ask for clarification;
   complete → AI summarizes (never recommends) → customer confirms summary → `WAITING_FOR_PHARMACIST`.
   Emergency text is checked before expiry/database maintenance so the fixed emergency reply is
   still returned if persistence fails. Cancellation/restart closes the case from every open intake
   stage, including `DRAFT` and `PENDING_CONFIRMATION`, before unlinking it from the conversation.
5. A pharmacist claims the case (`WAITING_FOR_PHARMACIST → PHARMACIST_REVIEWING`), reviews
   raw conversation + AI summary + missing/conflicting fields + red flags, can request more
   info, edit, and finally Approve/Reject/Refer/Emergency-refer. On approve the pharmacist
   may also attach a tenant-catalog-backed checkout draft (SKU + size + qty); if the customer
   later replies `ยืนยันสั่งซื้อ` in that same conversation, the normal BMS order/checkout
   flow creates a real order and returns the usual checkout link.
6. On Approve, the customer receives **the pharmacist's own typed text, verbatim** —
   delivered as a `staff:<email>`-attributed message, never AI-authored, never paraphrased.
   Reject/Refer-to-doctor/Emergency-referral each deliver a fixed, safe, non-clinical-detail
   notice instead (the pharmacist's internal reason text is not customer-facing copy). All
   four are wired through `notifyCustomerOfDecision()` in `assessments.ts`, which fires
   right after the DB transaction commits — a delivery failure never undoes the decision.
   A pharmacist reviewing a case can also independently trigger **Emergency referral**
   (`bmsEscalateAssessmentToEmergency`) — this is a "become more conservative" action, not
   an authorization to dispense, so it's gated by `pharmacy.assessment.review` only, not the
   `is_licensed_pharmacist` check.
7. A pharmacist can also **edit the AI-drafted summary** before deciding
   (`bmsEditAssessmentSummary`) — tracked separately from AI-authored summaries
   (`pharmacist_edits` on the case record + a dedicated `assessment.summary_edited` event).
8. Every state transition and clinical event is logged to both `bms_audit_log` (actor/
   action/target, same convention as every other BMS module) and the pharmacy-specific
   `bms_pharmacy_assessment_events` (queryable previous/next state), via the single choke
   point `recordPharmacyEvent()`/`minimizeForAudit()` in `events.ts` — raw health data
   (`raw_messages`/`structured_answers`/`medical_info`/`complaint`/`ai_summary`) is never
   written into either log.

## AI abstraction

```ts
interface PharmacyIntakeAI {
  extractStructuredData(input: IntakeAIInput): Promise<IntakeExtraction | null>;
  selectNextQuestion(input: NextQuestionInput): Promise<NextQuestionResult | null>;
  summarizeAssessment(input: SummaryInput): Promise<AssessmentSummary | null>;
  suggestMedications(input: MedicationSuggestionInput): Promise<MedicationSuggestionResult | null>;
}
```

`lib/bms/pharmacy/ai.ts`'s `AnthropicCompatiblePharmacyIntakeAI` is the only implementation,
reusing the existing provider-agnostic transport (`callAnthropicCompatibleMessages()` in
`lib/bms/aiProvider.ts` — the same function both Anthropic and DeepSeek already speak
through). AI output is validated with **hand-rolled validators** (no zod/ajv anywhere in
this codebase — matches `lib/bms/tools/types.ts`'s `reqString`/`enumVal`/`ToolArgError`
style exactly), retried up to `MAX_AI_VALIDATION_RETRIES` (2) times on failure, and returns
`null` on exhaustion — the caller (`intake.ts`) then treats it exactly like "AI unavailable"
and hands the case to a human; it never persists a partial/guessed answer.

`selectNextQuestion`'s validator checks the returned `questionKey` against the protocol's
own field keys — the model can pick *which* known question to ask, never invent one.
`summarizeAssessment`'s validator runs a denylist regex for drug-name/dosage-shaped text
(`\d+\s*mg` etc. + a short Thai/English OTC drug-name list) and treats a match as a
validation failure, never a passed-through recommendation.

A test seam (`__pharmacyAiTest`, mirroring `lib/bms/tools/runtime.ts`'s `__toolLoopTest`)
lets `scripts/ai-eval/pharmacy-intake-contract.test.mts` inject a fake provider/credential
resolver with zero network calls.

## AI medication suggestions (pharmacist-only — a deliberate scope expansion)

The rest of this module was built around "AI never recommends a drug." This one capability
is the explicit, narrow exception the user asked for, added after the base module — read
this section before touching it, the safety boundary is entirely procedural (there is no
technical wall stopping a future change from misusing `suggestMedications()`'s output; the
call sites listed below are what currently enforces the boundary):

- **Staff-initiated only, never automatic.** `suggestMedications()` is called from exactly
  one place: the `bmsGenerateMedicationSuggestions` GraphQL mutation
  (`graphql/bmsPharmacy.ts`), which a pharmacist triggers with an explicit button click on
  the case page. It is **never** called from `lib/bms/pharmacy/intake.ts`'s customer-facing
  turn handler — grep `suggestMedications(` to confirm there is exactly one call site.
- **Gated by `pharmacy.assessment.review` + `status === 'PHARMACIST_REVIEWING'`** — a case
  still being collected, or already decided, cannot generate suggestions.
- **Minimum medication-safety profile is mandatory.** Age, biological sex, allergies, and
  current medications must be known; female patients additionally require pregnancy and
  breastfeeding status. The GraphQL mutation rejects the request and lists missing fields
  instead of asking the model to guess.
- **Two independent safety layers before a pharmacist ever sees it**: (1) the model itself
  is prompted with the patient's allergies/current meds/pregnancy/breastfeeding/age and told
  to exclude anything contraindicated; (2) `filterMedicationSuggestionsAgainstAllergies()`
  (`ai.ts`) is a second, deterministic, non-AI check — a plain substring match against the
  patient's own reported allergy text — applied *after* AI validation, *before* anything is
  persisted. Excluded items are kept (tagged `excluded: true` + a reason), not silently
  dropped, so the pharmacist can see what AI proposed and why it got filtered.
- **Persisted to `bms_pharmacy_assessments.medication_suggestions`** for audit/traceability
  only — this column is denylisted in `events.ts`'s `minimizeForAudit()` (never copied into
  `bms_audit_log`/`bms_pharmacy_assessment_events` meta) and is **never read by
  `notifyCustomerOfDecision()`** or any customer-facing code path.
- **Never auto-applied.** The case page's "ใช้คำแนะนำนี้" (use this) button copies the
  suggestion's text into the *same editable* `pharmacistResponse` textarea the pharmacist
  already types their own advice into — it does not skip or shortcut the existing
  Approve/Reject/Refer flow, and the pharmacist can edit or delete it before Approve like
  any other text they typed themselves.
- **Catalog matching is factual but non-clinical.** Each AI draft is searched against the
  tenant's current active, in-stock catalog through `listSellableProducts()`. Bounded matches
  show SKU, price, and availability to the pharmacist, but are labelled as name matches only:
  the product schema does not yet model active ingredient/dosage form/strength well enough to
  claim therapeutic equivalence.
- **Not available to Manager/Administrator via a role shortcut** — same
  `is_licensed_pharmacist` boundary as approve/reject/refer still applies at the point the
  *case* is actually approved; generating a suggestion doesn't itself authorize anything.

**What this does NOT change**: the customer-facing pipeline, `extractStructuredData()`,
`selectNextQuestion()`, and `summarizeAssessment()` are completely unaffected — the
drug-name/dosage denylist inside `summarizeAssessment()`'s validator is still active, so the
AI *summary* still can never contain a recommendation; only this one new, separately-gated
function can.

## AI-unavailable fallback

No credentials / quota exhausted / validation exhausted after retries / provider error →
the customer always sees one fixed Thai message (never AI-generated): *"ขออภัยค่ะ ระบบ
ผู้ช่วยไม่พร้อมใช้งานชั่วคราว ทางร้านได้บันทึกอาการที่แจ้งไว้แล้ว เภสัชกรจะติดต่อกลับโดยตรงค่ะ"*
The case is marked `needs_manual_intake = true` and sent to `WAITING_FOR_PHARMACIST` with
whatever partial structured answers exist — the pharmacist reads the raw conversation
directly. Every fallback is logged via `recordPharmacyEvent(action:"ai.fallback"|
"ai.validation_exhausted", ...)` **and** `reportBmsFailure({code:"pharmacy_ai.unavailable"|
"pharmacy_ai.validation_exhausted", ...})` (`lib/bms/failureAlert.ts`, reused as-is — no new
alerting pipe).

## Testing

```bash
cd apps/web && npx tsx ../../scripts/ai-eval/pharmacy-intake-contract.test.mts
```

`node:test` + `node:assert/strict`, no network/DB — the only test framework used anywhere
in this repo. Covers: rule-engine red-flag/missing-field/conflict/completion logic
(including "unknown must never collapse to missing/false") for all 3 MVP protocols, the
full state-transition matrix, `minimizeForAudit()`'s health-data stripping, and the AI
validation/retry/manual-fallback seam (malformed JSON, unknown `questionKey`, drug-name
leak, no-credentials short-circuit, prompt-injection-shaped payloads being ignored because
the validators only ever read whitelisted keys).

**Explicitly NOT covered by this test file** (requires a live Postgres — run these as a
manual/integration pass before production, matching this codebase's own convention of
saying so rather than claiming an unverified pass):
- non-pharmacist / `Administrator`-bypass rejection on approve/reject/refer (needs a real
  `users.is_licensed_pharmacist` row)
- cross-tenant read/write blocked by RLS
- two concurrent `approveAssessment()` calls resolving to exactly one `APPROVED` + one
  `INVALID_STATE`
- approving an expired assessment being rejected without re-evaluation
- duplicate case creation for the same conversation being deduped
- a pharmacist edit producing an audit/event row end-to-end through the GraphQL layer

## Demo data

`POST /api/dev/fake/bms-pharmacy-assessments` (same `requirePlatformAdminSeeder()`/
`BMS_ALLOW_FAKE_SEED` gate as the other 9 fake-seed routes) creates the 5 required
scenarios: normal-complete, incomplete, allergy-history, high-risk-group (pregnancy),
emergency-red-flag. Marked with `channel_id = 'FAKE-DEMO'`; `DELETE` on the same route
removes them. **Not yet wired into the `/admin/dev/fake` page's buttons or the global
Cleanup action** — call it directly for now.

## An approval is spent once

`checkPharmacySaleInTx()` clears a sku only while the approving case is still unspent. It selects the
assessment `FOR UPDATE` (two registers scanning the same case code serialise on that lock) and treats
a `checkout_order_draft.status` of `ORDER_CREATED` as spent, contributing no approved skus — so the
basket falls back to needing a fresh review rather than passing silently.
`markAssessmentOrderCreatedInTx()` writes that marker, and the reversal trail with it, inside the same
transaction that reserves the stock the approval authorises.

Before this, the marker was written fire-and-forget *after* the sale had committed and nothing ever
read it back, so a single approved case could dispense an approval-gated drug an unlimited number of
times. Two deliberate consequences of the fix:

- **A cancelled bill does not return the approval.** The customer needs a new review. Releasing it
  would turn "cancel the bill" into a way to earn another dispense, which is worse than the
  inconvenience.
- **`ONLINE_SALE_PROHIBITED` is channel-scoped.** `evaluatePharmacySale()` takes a `channel`; online
  stays a hard refusal, while the counter falls through to `PHARMACY_REVIEW_REQUIRED` — the
  classification says a product may not be sold *online*, never that a pharmacist may not hand it
  over in person. The parameter defaults to `"online"`, so a caller that does not pass one keeps the
  strict behaviour. Counter approvals therefore also clear this policy, or an approved case would sit
  approved and refused forever.

Covered by `scripts/pharmacy-approval-reuse-db-contract.test.mts`, which builds and drops its own
tenant rather than borrowing the first one — flipping a shared shop's `business_archetype` to
`pharmacy` changes gating for every product it sells.

## Clinical evidence at the counter (9.25)

`bms_pharmacy_clinical_evidence` holds three kinds of record against one case, and
`lib/bms/pharmacy/clinicalEvidence.ts` is the only thing that writes it:

| kind | holds |
| --- | --- |
| `PRESCRIPTION_IMAGE` | a photo or PDF of the prescription (`file_id`, no text) |
| `PRESCRIPTION_REF` | the prescriber's reference number |
| `COUNSELING_NOTE` | what the pharmacist actually advised |

A table CHECK makes the wrong combination unrepresentable, so an image row can never
carry text and a text row can never carry a file.

**Decided with the user, not defaults to change casually:**

- **Nothing expires.** Retention is manual; rows live until somebody deletes them.
  Deletion is a soft delete (`deleted_at`/`deleted_by`) — a prescription that
  vanished without trace is worse than one marked deleted.
- **Attaching is never forced.** The pharmacist decides whether a case needs
  evidence; no policy blocks a sale for lacking it.
- **Audience is narrower than the case.** `pharmacy.evidence.read` and
  `pharmacy.evidence.manage` are seeded to `Pharmacist` only. Administrator is a
  super-role in `lib/bms/permissions.ts` and gets them automatically, so the
  audience is exactly admin + pharmacist. Manager can read the case but not the
  prescription image, because that image is health data about an identifiable
  patient.

**Never serve an image through `/api/files/[id]`.** That route authenticates
nothing and its ids are sequential integers, so anything reachable there is
effectively public. `file_id` is deliberately absent from every shape the service
returns; images stream from `/api/bms/pharmacy/evidence/[id]/file`, which requires
a session, `pharmacy.evidence.read`, and a tenant match on the evidence row, sends
`Cache-Control: private, no-store`, and refuses to serve anything but PNG/JPEG/
WebP/GIF/PDF inline (an SVG would execute script on our own origin).

The counter **writes but cannot read**: `/api/pos/pharmacy-evidence` authenticates
a device token plus cashier PIN and needs `pos.sell`, and it returns only an id —
so a cashier can capture the prescription a customer hands over without being able
to browse other patients' prescriptions from the register.

Both write paths record `assessment.clinical_evidence_added` /
`assessment.clinical_evidence_deleted` in the same transaction as the row, and the
trail carries only metadata (kind, source, id) — never the note text or the
reference number, which are health data.

Covered by `scripts/pharmacy-clinical-evidence-db-contract.test.mts`.

## Known limitations (MVP scope, decided with the user)

- The queue detail's manual medication picker reads through the pharmacy-scoped
  `bmsPharmacyCatalog` query. It reuses `listSellableProducts()` and returns only this tenant's
  active, in-stock products, so a pharmacist reviewing a case does not also need the broader
  `product.view` permission. It also returns Product Policy status; missing/draft,
  prescription-required, and online-prohibited products cannot be selected into an approval draft.
  The service checks the policy again during approval and order creation.

- **Plain-text delivery only, no custom chat widget.** LINE/Facebook/Instagram render their
  own native chat UI (this repo cannot ship custom interactive widgets into them), and there
  is no in-house customer-facing chat widget for the `web` channel either — every intake
  question/answer is a plain backend-composed Thai sentence, works identically on every
  channel. `bms_messages.meta.pharmacyIntake` carries `{kind, caseId}` only (not the richer
  per-message-kind shape a custom widget might eventually want).
- **`complaint`/`medical_info` JSONB columns exist per the original spec's category split
  but are not populated in this pass** — all extracted fields (including allergies/current
  medications) are stored flat in `structured_answers`, which is what the rule engine, the
  AI, and the pharmacist review UI all actually read. Splitting by category would need each
  protocol field to declare which bucket it belongs to; not implemented yet.
- **Conflict detection is a small built-in heuristic** (`ruleEngine.ts`'s `detectConflicts()`
  — currently only "male + pregnant/breastfeeding"), not a protocol-declared rule set.
  Extend with a `conflictRules` JSON column if more conflict types are needed.
- **No hard-delete/retention policy implemented.** `deleted_at` exists (matches the
  existing soft-delete convention) but nothing sets it yet — health-record retention
  duration is a legal/compliance decision this pass deliberately did not make unilaterally.
- **Protocol authoring and clinical review** live at `/admin/pharmacy-protocols`.
  New protocols are always `DRAFT`; backend validation checks field references,
  conditional rules, red-flag operators, completion fields, and trigger terms before
  a draft can move to `PENDING_REVIEW`. Only a licensed pharmacist can move it to
  `APPROVED`, and approval does not enable it automatically. Runtime additionally
  requires `APPROVED + clinically_approved + enabled + PHARMACY_PROTOCOLS_ENABLED`.
- Protocol discovery is data-driven through `display_label` and `trigger_terms`.
  LINE/customer intake and Pharmacy Intake Lab load the same active definitions;
  adding a protocol does not require another hardcoded starter or trigger regex.
- Red-flag rules accept either the legacy single-field shape or a bounded condition tree:
  `allOf`, `anyOf`, `not`, and leaf comparisons (`equals`, `notEquals`, `in`,
  `greaterThan*`, `lessThan*`, `exists`). Trees are limited to five levels and validated
  against declared/global field keys. `escalation_rules.bySeverity` deterministically maps
  `EMERGENCY` to emergency referral, `HIGH` to urgent medical review, `MODERATE` to direct
  pharmacist review, and `LOW` to continue (each mapping is configurable on the approved
  protocol). The model never selects an escalation tier.
- End-to-end rollout workflow and the migration/protocol/LINE/Lab/compound-rule QA matrix
  are documented in `docs/testing/pharmacy-protocol-workflow-and-test-cases.md`.
- **`PHARMACY_INTAKE_ENABLED`/`PHARMACY_AI_ENABLED`/`PHARMACY_PROTOCOLS_ENABLED` default to
  off/empty** — nothing in this module runs until a shop/ops explicitly turns it on, and
  even then the 3 seeded protocols ship `enabled=false`/`clinically_approved=false` — a
  pharmacist must review and flip a protocol's `enabled` flag (via
  `bmsSetPharmacyProtocolEnabled`) before any live intake can start.
- **Cron `POST /api/bms/pharmacy/assessments/expire-stale` is not yet scheduled** (same gap
  as every other cron endpoint in this codebase — ready, just not automated).
- **`/admin/pharmacy-queue`'s sidebar badge counts `riskLevel=EMERGENCY` cases regardless of
  open/closed status** (the read API doesn't support a multi-status filter yet) — an
  approximate signal like several other sidebar badges in this codebase, not exact.
- **`out_of_scope_reason` column exists but nothing sets it yet** — intake only starts on an
  explicit protocol-keyword trigger, so an organic "this doesn't fit any protocol" case
  mid-conversation isn't classified into this field today.

**Fixed after the first completeness pass (2nd review round):**
- ~~Approving a case never delivered anything to the customer's chat~~ — fixed:
  `notifyCustomerOfDecision()` in `assessments.ts` now sends the pharmacist's verbatim text
  (Approve) or a fixed safe notice (Reject/Refer/Emergency) right after each decision commits.
- ~~No Emergency-referral action for a pharmacist actively reviewing a case~~ — fixed:
  `escalateToEmergency()` now also accepts `PHARMACIST_REVIEWING`, exposed as
  `bmsEscalateAssessmentToEmergency` + a button on the case page.
- ~~No way to edit the AI-drafted summary~~ — fixed: `editAssessmentSummary()` /
  `bmsEditAssessmentSummary` + an inline edit control, tracked in `pharmacist_edits` and a
  dedicated `assessment.summary_edited` event.
- ~~"message sent to customer" was never logged~~ — fixed, fired from
  `notifyCustomerOfDecision()`.
- ~~Queue page only had risk-level tabs~~ — fixed: added status/channel/time-range filters.
- ~~**A real dead end**: if AI degraded mid-conversation, `missing_fields` stayed populated
  forever — `approveAssessment()` blocks on it, and "request more info" just re-entered the
  same broken AI extraction loop~~ — fixed: `applyManualAnswers()` /
  `bmsManualFillAssessmentFields` lets a pharmacist type the answers in by hand, re-run
  through the exact same `evaluateAnswer()` rule engine (never a looser check), exposed as a
  small per-field form on the case page whenever `missingFields` is non-empty.
  Manual entry now accepts only fields that are actually missing, normalizes typed values
  (including a Thai-labelled `SELF/CHILD/PARENT/OTHER` selector), re-runs the deterministic
  rule engine, and records `assessment.manual_answer_recorded`. That event is the explicit,
  audited alternative to customer summary confirmation; approval still requires
  `completeness_status=COMPLETE`, no conflicts/anomalies, and all other pharmacist gates.
- ~~Pharmacy Lab queue rows could show `patient_relationship=SELF` while simultaneously
  listing `patient_relationship` as missing~~ — fixed: Lab now preserves the normalized
  relationship answer and stores `UNKNOWN` rather than inventing `SELF` when none was given.
- ~~`users.is_licensed_pharmacist` had no UI at all — the entire approve-gate was only
  reachable via raw SQL~~ — fixed: `bmsSetPharmacistLicense` (Administrator-only, standalone
  check, does not touch the shared `users`/`upsertUser` resolver) + `/admin/pharmacy-protocols/licenses`.

## Before relying on this in production

1. Apply migrations `7.57`–`7.73` plus `7.83` and confirm they're idempotent (re-run once).
2. Set `PHARMACY_INTAKE_ENABLED=true` and `PHARMACY_AI_ENABLED=true` for a dev/sandbox
   tenant only.
3. As an Administrator, flip at least one real user's pharmacist license switch at
   `/admin/pharmacy-protocols/licenses`.
4. Save the protocol as `DRAFT`, submit it to `PENDING_REVIEW`, have a licensed pharmacist
   approve it through `/admin/pharmacy-protocols`, then separately enable it. Approval sets
   `clinically_approved`; it deliberately does not enable the protocol automatically.
5. Add the reviewed `protocol_key` to `PHARMACY_PROTOCOLS_ENABLED` and restart the service;
   all four runtime gates must agree before LINE OA or Lab can discover it.
6. Drive one full flow end-to-end: trigger a keyword, answer questions, hit a red flag,
   confirm it lands in `EMERGENCY_REFERRAL`, confirm a non-pharmacist cannot approve, confirm
   a licensed pharmacist can.
