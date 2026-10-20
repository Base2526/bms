# Production authorization record — template only

This file is not an authorization. Copy it into the approved evidence system and have the named
authority sign the completed record only after Phase 9 reports `PILOT_READY`.

Required record:

- authorization identifier, approver identity and authority role;
- approval and expiry timestamps;
- exact tenant and branch references;
- exact enabled capabilities and explicit exclusions;
- launch window and staffed owners;
- SLO/threshold evidence reference;
- rollback authority, triggers and runbook reference;
- rollout stages and minimum observation periods;
- accepted residual risks and linked decisions.

The evidence link must be durable HTTPS or repository-local, contain no secrets or customer PII and
be copied into `controlled-launch-plan.json`. General permission to continue development is not
production authorization.
