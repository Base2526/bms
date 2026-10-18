# Phase 9 — pilot certification and blocker closure

Status: **NO-GO — 1/11 gates pass**.

Phase 9 converts the Phase 8 narrative blockers into a strict, reviewable evidence manifest. It does
not implement blocked capabilities, contact external systems, onboard real drivers or authorize a
pilot. The current manifest deliberately fixes `productionEnabled` to `false`; even a future
`PILOT_READY` result is not production authorization.

## Deliverables

- `readiness-gates.json` records each gate, accountable roles, evidence, blockers and approvals.
- `certification-workbook.json` maps every gate to required artifacts, non-production exercises,
  acceptance criteria, open actions and a review packet under `evidence/`.
- Review packets are preparation material only. They are deliberately separate from accepted
  evidence so an empty template can never make a gate pass.
- `pilotReadinessManifestV1Schema` rejects duplicate gates, unsupported fields, a passing gate with
  blockers or no evidence, and a passing gate missing any required owner-role approval.
- `pilotCertificationWorkbookV1Schema` rejects duplicate requirements, completion without evidence,
  open work without an action and any attempt to claim production authorization.
- `evaluatePilotCertificationWorkbookV1()` requires one aligned workbook item per readiness gate and
  rejects evidence that is not also recorded in the authoritative readiness manifest.
- `evaluatePilotReadinessV1()` returns `NO_GO` if any gate remains blocked.
- Evidence references accept only safe repository-relative paths or HTTPS URLs; the readiness command
  verifies that every repository-local reference exists.
- `npm run pilot:readiness` produces the deterministic current decision. Add
  `-- --require-pilot-ready` in an explicitly requested pilot-release workflow; it exits 2 while the
  decision is `NO_GO`. It also validates workbook alignment and all local packet references.
- `npm run certification:verify` reports the artifact/exercise inventory without changing a gate.
- `approval-requests.json` and `approval-requests/` contain a role-complete request bundle for all
  blocked gates. `npm run approval-requests:verify` proves packet/gate/role coverage while fixing the
  bundle itself to `NOT_DISPATCHED`, `productionAuthorized=false` and no granted approvals.

Approval entries must identify a real authorized person and link to durable evidence. Engineering
must not create or infer an approval from a coding instruction, test result or general permission to
continue phases.

## Current decision

Only the synthetic engineering foundation passes. Repository instructions, independent security,
privacy/retention, real-device and safety, BMS cross-system authority, finance/tax/legal, Admin
access, SRE capacity/observability, approved recovery objectives and provider-failure certification
remain blocked.

The certification workbook now covers all 11 gates with 11 required artifact sets and 9 controlled
non-production exercises. Ten packets remain open because authorized reviews, owner decisions,
approved environments, real devices or non-production credentials have not been supplied.

Six grouped approval requests are ready to send to all 14 required roles. They have not been
dispatched because no connected Slack/email channel or named authorized recipient was supplied.
The request bundle is preparation material only and does not unblock implementation.

**NO-GO.** Keep real users, BMS mutations, provider traffic, customer tracking, physical handoff,
private evidence and real money disabled. Phase 10 requires `PILOT_READY` plus a separate explicit
production-launch authorization; this document supplies neither.
