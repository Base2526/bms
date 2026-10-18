# Phase 17 — API and authorization contract drift verification

Status: **CURRENT ROUTER CONTRACT VERIFIED; PRODUCTION NO-GO**.

Phase 17 binds the API router source to a strict inventory of method, path template, static/dynamic
matcher, access class, service scope/customer purpose and idempotency requirement. The verifier also requires every
route/scope pair to remain present in the Phase 8 human inventory.

Current boundary: 27 routes — two public health, 22 service-token and three purpose-bound customer-grant
routes. Every non-health route has an explicit scope/purpose; 16 business mutations require an
idempotency key, while durable event ingest uses the envelope message identity instead. Customer
routes are limited to `QUOTE`, `CREATE_DELIVERY` and the read-only `TRACK` projection. They derive
tenant/branch/order authority from the live grant rather than request fields, and tracking returns no
driver identity, contact details or location.

Run `npm run api-contract:verify`; CI runs it before tests. A new or removed branch, changed dynamic
regex, scope drift, idempotency drift or undocumented route fails closed.

This static verifier does not replace HTTP denial/success integration tests or prove runtime network
policy. **NO-GO:** contract consistency does not authorize production.
