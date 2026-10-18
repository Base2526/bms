# Independent security review packet

Owner: Security. Review trust boundaries, service JWT validation, scope enforcement, tenant/branch
mapping, RLS, idempotency, event replay, webhook/provider boundaries, private evidence, logs and
denial-of-service controls. The reviewer must be independent of the implementation author.

Exercise cross-tenant access, missing/incorrect scope, forged identity, replay, duplicate mutation,
oversized input and dependency failure in non-production. Accepted evidence includes the report,
test record, remediation verification and signed acceptance for any residual risk. Unaccepted high
severity findings keep this gate `BLOCKED`.
