# LINE MAN partner contract intake

This checklist is the handoff between LINE MAN partner onboarding and implementation. It records
only provider-confirmed facts. A blank field is a blocker, not permission to copy another provider's
behaviour. Do not paste credentials or customer data into this document.

## Ownership and environments

| Contract fact | Provider-confirmed value | Evidence/version |
| --- | --- | --- |
| Partner/program name | Pending | Pending |
| Credential owner: BMS platform, tenant, branch, or another scope | Pending | Pending |
| Merchant authorization/consent flow | Pending | Pending |
| Sandbox base URL and access process | Pending | Pending |
| Production base URL and certification gate | Pending | Pending |
| API version and change-notice policy | Pending | Pending |

The credential owner decides the product surface. Platform credentials remain outside the tenant
form. Tenant credentials may be entered only when the signed contract explicitly assigns them to a
shop. An authorization-code or consent flow needs server-held state, expiry, replay protection and
tenant binding before a **Connect LINE MAN** button can be enabled.

## Authentication and webhooks

| Contract fact | Provider-confirmed value | Evidence/version |
| --- | --- | --- |
| API authentication and token lifecycle | Pending | Pending |
| Webhook registration procedure | Pending | Pending |
| Authentication/signature headers | Pending | Pending |
| Exact signed bytes and canonicalization | Pending | Pending |
| Timestamp/replay window | Pending | Pending |
| Event id, revision and ordering guarantees | Pending | Pending |
| Retry schedule and acknowledgement response | Pending | Pending |
| Payload/body-size limits | Pending | Pending |

The BMS webhook URL must keep its opaque integration id. The server derives tenant from that id and
branch from a verified store mapping; neither may come from the payload.

## Store and catalog

Record the authoritative store, item, variant and modifier identifiers; menu read/update endpoints;
price and currency rules; availability semantics; hours/timezone behaviour; pagination; rate limits;
and catalog drift/version signals. Confirm whether identifiers are stable across branches and menu
revisions. Only verified mappings may create a whole BMS order.

## Order lifecycle

Obtain provider-confirmed request/response examples and transitions for:

- new-order webhook and fetch-latest;
- merchant acceptance, rejection and reason codes;
- scheduled-order acceptance deadline, preparation target and customer ETA as separate fields;
- logistics versus merchant delivery;
- ready, rider arrival, pickup/handoff, dispatched and delivered;
- whole-order and line cancellation, amendments, refunds and responsibility;
- idempotency, timeout, retry, rate-limit and duplicate-event behaviour.

Unknown statuses or timing fields remain action-required. They are never inferred from display text
or from another delivery provider.

## Settlement, tax and privacy

Collect a redacted settlement sample plus its schema, payout cadence, commissions, discounts,
refunds, adjustments, chargebacks and dispute references. Finance must approve tax-document
ownership, delivery-fee treatment and provider-funded discounts. Record customer-data minimization,
retention, deletion and incident-notification terms.

## Evidence required to change a capability to `VERIFIED`

For each adapter method, attach the official contract/version, redacted sandbox request and response,
negative authentication case, duplicate/idempotency case, timeout/retry case and the responsible
reviewer. Production remains blocked until sandbox, shadow comparison, security/load checks, tax
approval and one real settlement cycle pass.

