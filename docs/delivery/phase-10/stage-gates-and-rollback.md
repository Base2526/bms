# Stage gates and rollback template

This is a non-executable template. Authorized owners must select percentages and observation periods
for the approved cohort; Engineering must not infer them.

Every stage needs: increasing percentage, minimum observation time, deployment identity, entry
checks, SLO thresholds, cross-system and financial reconciliation checks, incident/support checks,
rollback triggers, decision authority and a durable decision record. The next stage remains blocked
until every exit check passes and the named authority records `ADVANCE`.

Default decision behavior is fail closed:

- threshold breach, unexplained mismatch, unauthorized access, data loss, unsafe driver behavior,
  provider instability or missing observability means `HOLD` and rollback evaluation;
- expired authorization or absent rollback authority means `STOP`;
- rollback must disable the approved capability/cohort safely, drain or preserve durable work,
  reconcile state and retain accepted customer/driver obligations;
- recovery to a healthy system does not authorize renewed expansion; a new stage decision is needed.

Use the Phase 8 release/recovery runbook as technical preparation, then attach the approved triggers,
authority and rehearsal evidence to the production authorization record.
