# Provider failure and credential packet

Owners: SRE, Security and Integration Owner. Inventory each provider, approved sandbox endpoint,
credential owner, secret store, allowed egress, timeout/retry budget, rate limit, callback validation,
rotation/revocation procedure and outage escalation. Never commit credential values.

Exercise timeout, 4xx/5xx, malformed response, duplicate callback, stale callback, credential
revocation and rotation in non-production. Evidence must prove bounded retries, idempotent processing,
no sensitive logging, actionable alerts and clean recovery without data corruption.
