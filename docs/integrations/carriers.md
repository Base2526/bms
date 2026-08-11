# Carrier integrations (Flash / Kerry)

> Code: `apps/web/lib/bms/carriers/` and `apps/web/lib/bms/shipping.ts` · Data:
> migrations `7.76` and `7.77` · Admin UI: `/admin/shipment`

## Current status

Flash and Kerry are **mock-ready integration adapters, not verified live adapters**. Setting a key
does not change that: `getStatus()` reports `not_implemented`, and create/track/rate return a typed
result instead of sending a guessed request. The Flash public site exposes consumer tracking/rate
tools but no merchant API contract. Kerry publishes a Smart-EDI specification, but it identifies
the interface as subscriber-only and still requires an account-issued base URL, credentials,
consignment-number rules, sender fields, and a customer callback endpoint.

References:

- Flash Express Thailand: <https://flashexpress.com/en/>
- Kerry Smart-EDI specification V2.1.8:
  <https://exch.th.kerryexpress.com/ediwebapi/manual/Smart-EDI%20Specification%20V2.1.8.pdf>

## Safety contract already implemented

- Local fulfillment commits and releases order/inventory locks before a carrier request starts.
- The BMS shipment UUID is the stable idempotency key for every booking retry.
- Booking has explicit `ready` / `booking` / `booked` / failure states; failures are visible and
  retryable through `bmsBookShipmentLive`, never hidden as carrier success.
- Carrier calls have a 10-second boundary timeout and normalize thrown errors into typed results.
- Tracking re-locks the shipment after the network call, rejects concurrent carrier/tracking edits,
  preserves terminal states, and writes status plus normalized event history atomically.
- Only HTTPS label links are retained. Mock data is always tagged `source: mock` and cannot run in
  production. Lazada/Shopee remain marketplace-managed and never invoke these booking adapters.
- `POST /api/bms/shipping/sync-carriers` polls stale active shipments and records job-run history;
  it skips unconfigured and `not_implemented` adapters.

## Before enabling a live adapter

1. Obtain the carrier-issued merchant/subscriber package: production and sandbox base URLs,
   authentication/signing rules, credentials, rate limits, idempotency mechanism, status codes,
   webhook verification, label behavior, and cancellation/reconciliation procedure.
2. Decide whether credentials are platform-wide or tenant-owned. If tenant-owned, store them using
   the encrypted tenant-secret pattern; do not put them in a public field or browser environment.
3. Map the carrier payload in its adapter only. Normalize responses into `CarrierClient`; never leak
   a provider-specific shape into `shipping.ts` or GraphQL.
4. Forward `CarrierCreateShipmentRequest.idempotencyKey` using the carrier's supported reference or
   idempotency field. A live adapter must return the same remote shipment for the same key.
5. Add every required runtime variable to all three Compose web-service environments and deployment
   secret stores only after its exact meaning is verified.
6. Add sanitized contract fixtures for create, duplicate retry, timeout, tracking event ordering,
   delivered/returned status, invalid label URL, webhook signature, and carrier error responses.
7. Exercise sandbox booking, retry/reconciliation, label download, polling/webhook, and cancellation
   before changing `getStatus()` from `not_implemented` to `configured`.

No live credential should be committed to this repository.
