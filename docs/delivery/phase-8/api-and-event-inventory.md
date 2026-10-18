# Synthetic API and event inventory

All `/v1/**` routes require fail-closed Redis rate limiting. Service routes require a verified
service token and listed scope. The three customer routes instead require a short-lived, revocable,
purpose-bound synthetic customer grant; they resolve tenant, branch, order and order version on the
server and reject those authority fields in the request body. Service operations additionally
require an active server-side tenant/branch mapping; driver operations resolve the exact active
driver principal and assignment/membership instead.

| Route | Scope | Current boundary |
| --- | --- | --- |
| `POST /v1/integration/events` | `events.ingest` | strict BMS/synthetic order-context inbox only |
| `GET /v1/integration/reconciliation/issues` | `reconciliation.read` | bounded safe action-required metadata |
| `PUT /v1/merchant/configuration` | `merchant.settings.write` | immutable synthetic merchant/config versions |
| `POST /v1/customer/grants` | `customer.grants.write` | register hash-only, one-hour synthetic customer authority for one exact order |
| `POST /v1/customer/quotes` | `QUOTE` | customer grant resolves exact tenant/branch/order; body contains service requirement only |
| `POST /v1/customer/deliveries` | `CREATE_DELIVERY` | customer grant resolves exact order; body contains accepted quote id only |
| `GET /v1/customer/deliveries/current` | `TRACK` | exact-order status and coarse match stage; no caller scope, driver identity, contact or location |
| `POST /v1/quotes` | `quotes.create` | exact-satang synthetic route quote |
| `POST /v1/deliveries` | `deliveries.create` | quote-bound Delivery plus shadow allocation journal |
| `POST /v1/deliveries/:id/actions/:action` | `deliveries.transition` | named merchant handoff, completion, cancellation and return-control transitions |
| `POST /v1/deliveries/:id/disputes` | `disputes.manage` | open one synthetic, category-only dispute without free-form PII |
| `POST /v1/disputes/:id/resolve` | `disputes.manage` | resolve/reject a synthetic dispute with an audited reason code |
| `PUT /v1/dispatch/policy` | `dispatch.manage` | immutable synthetic policy |
| `PUT /v1/dispatch/drivers` | `dispatch.manage` | synthetic driver/vehicle/membership only |
| `POST /v1/deliveries/:id/actions/start_dispatch` | `dispatch.manage` | sequential synthetic dispatch |
| `POST /v1/driver/availability` | `driver.availability.write` | exact driver principal |
| `POST /v1/driver/locations` | `driver.location.write` | synthetic accepted/rejected evidence |
| `GET /v1/driver/offers` | `driver.offers.read` | privacy-minimal pending offers |
| `POST /v1/dispatch/offers/:id/:decision` | `driver.offers.decide` | atomic accept/reject |
| `GET /v1/driver/assignments/current` | `driver.assignments.read` | restart-safe current assignment |
| `GET /v1/driver/snapshot` | `driver.snapshot.read` | coherent availability/assignment/offer view |
| `POST /v1/driver/deliveries/:id/actions/:action` | `driver.journey.write` | ordered pickup/delivery/failure/return actions; POD is hash-bound synthetic metadata only |
| `GET /v1/finance/capabilities` | `finance.capabilities.read` | fixed fail-closed `SHADOW_ONLY` manifest |
| `GET /v1/operations/overview` | `operations.read` | privacy/money-minimal tenant/branch counts |
| `GET /v1/operations/deliveries` | `operations.read` | bounded keyset-paginated state read model |

`GET /livez` is process liveness. `GET /readyz` checks PostgreSQL/Redis and reports 503 while draining.
Neither endpoint conveys business capability or production authorization.

## Versioned durable events

Inbound accepted catalog:

- `bms.order-context-changed.v1` — exactly next aggregate version only;
- `bms.order-context-snapshot.v1` — authenticated full snapshot used to reconcile a version gap.

Current synthetic outbox catalog:

- `fleet-delivery.quote-issued.v1`;
- `fleet-delivery.delivery-created.v1`;
- `fleet-delivery.delivery-state-changed.v1`;
- `fleet-delivery.dispatch-started.v1`;
- `fleet-delivery.delivery-assigned.v1`;
- `fleet-delivery.dispute-opened.v1`;
- `fleet-delivery.dispute-resolved.v1`.

The only enabled destination is `synthetic://ack`. These events do not authorize a BMS mutation,
payment, stock handoff, customer notification, provider call, COD, earning, payout or tax document.
