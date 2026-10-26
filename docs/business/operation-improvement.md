# Release F — SOP learning, recurring issues and weekly improvement

Implementation on `codex/restaurant-operations-release-ab`; not production rollout or food-safety
certification. `/admin/operations` → Standards & improvement. Requires A–E and **10.95** after
10.91–10.94, then **10.96** for distinct TRAINED evidence, before the new app (E waste now writes
an exact movement reference too). 10.96 widens the learning-kind constraint; never collapse training
completion into a passing assessment. Readiness requires ACK + TRAINED + PASS when training is required.

## SOP and learning

- Publish a branch/duty SOP with pinned non-draft checklist or exact recipe version. Content/source
  are immutable; publication retires the prior active family version. Branch/duty cannot move.
- ACK is always the signed-in person, not proof of competence. Another trainer records TRAINED
  separately from PASS or PRACTICE with evidence text; latest assessment controls current readiness.
  No certificate/file upload.
- New versions default to fresh acknowledgement/assessment. Explicit carry flags retain previous
  evidence bases with a required reason. Newly required training cannot inherit a nonexistent pass.
  Learning details filter ACK and training/assessment by their respective bases, so a partial carry
  never displays reset evidence as applicable to the new version.
- Roster readiness is current evidence, not presence/attendance. Missing configuration is UNKNOWN;
  warnings never block shifts or grant RBAC. Staff see their own learning; trainers see branch-scoped
  evidence. Lists use server search/pagination; newest 100 history entries show truncation explicitly.

## Recurring issues and corrective work

- Issues require real non-void FAIL corrective actions. Each action belongs to at most one issue;
  repeated result revisions are not new incidents. Category is a stable key.
- Severity/owner, unconfirmed hypothesis and observed cause are separate. The issue register is
  analysis, not another work queue. Changing its label never resolves original actions.
- Assign target, person and due time using an ACTIVE same-branch separate-review checklist. This
  creates canonical work, My Work, assignment notice and configured reminder/escalation. Immutable
  baseline optionally links a weekly review. No stock/payroll side effect.
  The followup selector filters ACTIVE/separate-review eligibility on the server before its bounded
  result page; retired SOP source versions cannot hide eligible followup templates.
- Close requires a different person from owner, observed cause, all sources VERIFIED and non-void,
  and at least one approved recheck since opening/reopening. Every recheck in that cycle must be
  APPROVED; cancelled work is not a pass. Reason/version/audit required.
- Linking a new failure reopens a closed issue. Renewed failure on an already-linked action shows
  follow-up needed; a manager explicitly reopens. Historical closure evidence remains intact.

## Weekly and multi-branch review

- Seven calendar days in Asia/Bangkok; authorized branches remain separate, no synthetic ranking.
- Due-time cohort: currently APPROVED by due time / non-VOID tasks already due. Future/cancelled
  separate; no percentage for zero denominator. This differs intentionally from C's all-cohort rate.
- Backlog/readiness are CURRENT, not reconstructed history. Older open actions show age and known
  issue severity; unclassified is not LOW. Repeats group template family AND version/category/item
  with distinct runs, not result revisions.
- Yield compares POSTED batches within same recipe version/output variant/base unit in the due
  cohort. Draft/ready/cancelled remain source evidence, not actual output.
- Waste uses posting date and exact canonical movement/value entry. Decimal known subtotal and
  unknown count are separate. Missing reference/value is unknown, not zero; historical waste is
  never backfilled by guessing amount, time or reason.
- Handovers follow roster start: on-time/late/waiting/cancelled distinct. Readiness uses current SOP
  and assessment for published assignments, not historical qualifications. Source links retain dates.
  New weekly snapshots also pin acknowledgement/training/latest-assessment row IDs and their basis
  IDs. A newer assessment changes the fingerprint even when its verdict is unchanged. Older saved
  snapshots remain unchanged and do not acquire invented evidence references.
- Bounds: 200 branches / 5,000 facts per domain. Excess rejects REPORT_TOO_LARGE, never silently
  truncates totals. Select a narrower branch/window.
- Confirm one branch with shown fingerprint and previous review version. Changed facts require
  refresh. Every confirmation preserves snapshot, actor and note permanently; current facts stay
  separate. Open a snapshot issue, then assign an improvement linked by snapshot ID. Before baseline
  and current outcome remain separate; humans decide causes/progress/closure.

## Authority and rollout

Services own SQL; GraphQL is thin. Confirmed tenant writes use RBAC, branch/version checks, stable
replay and atomic audit. SERIALIZABLE plus canonical run locks protect closure; serialization/deadlock
returns RETRY_REQUIRED. Lost-response UI retries the same key and revalidates current access.

Manager defaults: `operations.standard.manage`, `operations.standard.assess`,
`operations.improvement.manage`. Close requires `operations.checklist.review`; followup also requires
`operations.checklist.manage`; weekly requires `operations.summary.review` AND `report.view`;
recipe sources need `product.view`. Checklist viewing throughout. No AI tool, external message,
new cron or realtime trigger. F data refreshes on view/explicit reload; tasks use existing notices.

Pilot real branch roles, SOP changes, trainer evidence, repeated issue and weekly review. Excludes
payroll/OT, attendance, maintenance, LINE/email, offline, hourly expiry and demand forecasting.
Rollback disables F commands before app rollback; retain evidence and movement references, no
destructive down migration or stock reversal.

## Verification

Actual runs are recorded in `scripts/README.md`. Browser tests use compiled pages/schema with mocked
transport/auth, not live-account acceptance. DB tests use restored isolated `bms_realtime_test` on
localhost:5433. No production deployment is implied.
