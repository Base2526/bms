# Controlled launch operator checklist

This checklist prepares a launch but does not authorize or execute one.

Before the window, verify Phase 9 is `PILOT_READY`, authorization is current, the exact tenant and
branch cohort is loaded, capabilities match the signed record, migrations and configuration are
verified, dashboards and paging are live, support/on-call roles acknowledge the window, backups and
rollback tooling are available, and reconciliation has a named operator.

At each stage, record the stage identity, cohort percentage, start/end timestamps, deployment
version, health/SLO measurements, queue and reconciliation state, incidents, support volume and the
named `ADVANCE`, `HOLD` or `ROLLBACK` decision. Never advance automatically.

After the window, reconcile every cross-system boundary, record unresolved incidents and residual
risk, return disabled capabilities to their approved state, and complete ownership handoff. Stop if
authorization expires, evidence is unavailable, an owner is absent or any rollback trigger fires.
