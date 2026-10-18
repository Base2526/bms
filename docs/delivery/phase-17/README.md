# Phase 17 — API and authorization contract drift verification

Status: **CURRENT ROUTER CONTRACT VERIFIED; PRODUCTION NO-GO**.

Phase 17 binds the API router source to a strict inventory of method, path template, static/dynamic
matcher, access class, service scope and idempotency requirement. The verifier also requires every
route/scope pair to remain present in the Phase 8 human inventory.

Current boundary: two public health routes and nineteen `/v1/**` service routes. Every service route
has an explicit scope; eleven business mutations require an idempotency key, while durable event
ingest uses the envelope message identity instead.

Run `npm run api-contract:verify`; CI runs it before tests. A new or removed branch, changed dynamic
regex, scope drift, idempotency drift or undocumented route fails closed.

This static verifier does not replace HTTP denial/success integration tests or prove runtime network
policy. **NO-GO:** contract consistency does not authorize production.
