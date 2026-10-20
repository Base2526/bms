# Phase 10 — controlled production launch and stabilization

Status: **PREPARED, NOT AUTHORIZED — NO-GO**.

This phase currently contains launch-control scaffolding only. It does not deploy, enable production,
contact a provider, mutate BMS data or create an authorization. Phase 9 is still `NO_GO`, and no
production-launch authority has identified an approved tenant/branch cohort, capabilities, window,
monitoring thresholds or rollback authority.

## Fail-closed control

- `controlled-launch-plan.json` records the current empty cohort and `NOT_GRANTED` authorization.
- `launch-readiness-workbook.json` maps all nine launch-control families to accountable roles,
  acceptance criteria, evidence and open actions without claiming authorization.
- `production-authorization-template.md` defines the minimum durable authorization record but is
  explicitly not an authorization.
- `operator-checklist.md` and `stage-gates-and-rollback.md` define STOP/ADVANCE/ROLLBACK evidence and
  prohibit automatic stage expansion.
- `controlledLaunchPlanV1Schema` rejects production enablement without a granted authorization,
  incomplete launch controls, unauthorized/active stages, duplicate/non-increasing stages and
  invalid launch windows.
- `evaluateControlledLaunchV1()` independently reads the real Phase 9 manifest and requires every
  cohort, capability, current authorization, active window, monitoring, rollback and rollout-stage
  control.
- `npm run launch:readiness` reports the current decision without changing anything.
- `npm run launch-controls:verify` checks that every live launch blocker maps to an open workbook
  control and rejects a workbook that marks a blocked control complete.
- The command validates all Phase 9/10 repository-local evidence paths before calculating readiness.
- `npm run launch:readiness -- --require-ready-to-enable` exits 2 unless the decision is exactly
  `READY_TO_ENABLE`. It does not deploy when the check succeeds.

## Current blockers

The deterministic preflight reports Phase 9 not ready, production authorization absent, no tenant or
branch cohort, no approved capabilities/window/monitoring thresholds/rollback triggers and no staged
rollout plan. The workbook covers all nine control families and remains aligned with those blockers.
These are authority and operating-policy inputs, not values Engineering may invent.

**NO-GO.** `productionEnabled` remains `false`. A future `READY_TO_ENABLE` result is only a preflight
result; the actual launch still requires the separately authorized deployment workflow and a STOP
after each rollout stage.
