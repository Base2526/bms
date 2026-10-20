# Authentication, tenancy, and authorization model

Each row's Evidence label applies to the entire row.

## Current BMS model

| Principal | Current credential/context | Authority and limitation | Evidence | Source |
| --- | --- | --- | --- | --- |
| BMS Admin | Signed admin session, refreshed DB identity, permission catalog, tenant/location scope | Suitable for human BMS Admin actions only; not a service credential | `VERIFIED` | `apps/web/app/api/graphql/route.ts`; `apps/web/lib/bms/adminRouteAuth.ts` |
| Web customer/user | Web session or signed checkout bearer | Checkout token binds tenant/order but lacks Delivery purpose/action/revocation | `VERIFIED` | `apps/web/lib/auth.ts`; `apps/web/lib/bms/checkoutToken.ts` |
| Android user | Bearer user token under `android` scope | Existing user app principal, not a driver identity | `VERIFIED` | `apps/web/app/api/graphql/route.ts` |
| POS device + cashier | Hashed device token plus cashier PIN/permission for mutations | Explicitly not a person/service/driver credential | `VERIFIED` | `apps/web/lib/bms/pos.ts`; `apps/web/graphql/bmsPosDevice.ts` |
| Platform provider | Provider webhook signature/integration mapping | Limited to existing delivery-platform adapters | `VERIFIED` | `apps/web/lib/bms/deliveryPlatforms/` |
| Delivery service / driver | None | New principals are required | `VERIFIED` | `apps/web/app/api/graphql/route.ts`; `apps/web/lib/auth.ts` |

## Proposed principals

### BMS-to-Delivery and Delivery-to-BMS service principal

- `PROPOSED`: use separate asymmetric key pairs per environment and caller, short-lived JWT access
  tokens with `iss`, exact `aud`, `sub`, `kid`, `iat`, `nbf`, `exp`, unique `jti`, and allowlisted
  operation scopes. Verification keys rotate with an overlap window.
- `PROPOSED`: a credential identifies a service, never a tenant. BMS/Delivery resolves tenant,
  branch and order through an enabled server-side mapping and revalidates relationships on every
  sensitive command.
- `PROPOSED`: mutations require a request id, correlation id, idempotency key and body fingerprint.
  A replay cache for `jti` applies to high-risk one-shot commands in addition to operation-level
  idempotency.
- `PROPOSED`: 401 means missing/invalid/expired credential; 403 means authenticated principal lacks
  operation scope; 404 hides an inaccessible tenant object; valid transition rejection returns a
  stable business code and `retryable` flag.
- `PROPOSED`: emergency disablement revokes a key/principal and independently disables intake,
  mutation dispatch or event consumption without deleting queued history.
- `UNRESOLVED`: Security must approve issuer, audience names, token lifetime, clock skew, network
  boundary/mTLS requirement, rotation owner and rate limits before implementation.

### Driver principal

- `PROPOSED`: driver has a Delivery-native account, verification state, registered device, revocable
  refresh session and short-lived access token. It is never mapped implicitly from a BMS user/POS id.
- `PROPOSED`: one active device session is the safe pilot default; device replacement revokes the
  old session. Every mutation rechecks active driver, approved documents, device/session, assignment
  ownership, state/version and idempotency.
- `PROPOSED`: suspension blocks availability, offers, pickup and payout-affecting actions immediately
  while preserving read access needed for appeal/history according to policy.
- `PROPOSED`: push notification and deep-link identifiers grant no authority; the app refetches the
  current offer/assignment from the API.
- `UNRESOLVED`: login/recovery/MFA, KYC vendor, concurrent-session policy, appeal, document review and
  offboarding are owned by Security + Operations + Legal.

### Customer tracking principal

- `PROPOSED`: create a separate opaque or signed token with `aud=fleet-delivery-customer`, purpose,
  opaque grant id, tenant/order/delivery binding, allowed actions, issued/expiry times, key id and
  revocation/version handle. The URL must not contain raw tenant/customer identifiers.
- `PROPOSED`: default permission is read-only tracking. Cancellation is a distinct action/grant and
  remains a BMS request, not a Delivery state assertion.
- `PROPOSED`: responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, noindex,
  rate limits and a privacy-safe location projection. Logs store a token fingerprint, never token.
- `PROPOSED`: leaked-link recovery revokes/rotates the grant from an authenticated BMS customer or
  approved support flow; rotation invalidates old tokens.
- `UNRESOLVED`: Product/Security/Privacy must approve expiry, revocation UX, cancellation authority,
  displayed location precision and POD visibility.

## Scope model

| Operation class | Required scope | Object checks | Separation requirement | Evidence |
| --- | --- | --- | --- | --- |
| Merchant view/ready/handoff | Tenant + branch + order/delivery | Mapping, branch active/allowed, state/version | Handoff requires explicit merchant confirmation | `PROPOSED` |
| Dispatch | Approved fleet scope + active service zone | Driver eligibility, vehicle/capacity, job version | Manual override needs reason/audit | `PROPOSED` |
| Driver self-service | Driver-self and owned active assignment | Driver/session/device/version | No cross-driver reads | `PROPOSED` |
| Private evidence | Explicit evidence-read permission + object scope | Tenant/job/evidence purpose | Support view distinct from finance/dispatch | `PROPOSED` |
| Finance capability read | `finance.capabilities.read` | Active service-principal tenant/branch mapping | Read-only; reports fail-closed feature availability only | `IMPLEMENTED` |
| Tenant operations read | `operations.read` | Active service-principal tenant/branch mapping | Read-only; no private evidence, location or finance fields | `IMPLEMENTED` |
| Finance prepare | Tenant/platform finance scope | Ledger/batch version and period | Cannot approve/confirm same batch | `PROPOSED` |
| Finance approve | Independent approver scope | Batch unchanged/balanced | Cannot prepare or external-confirm same batch | `PROPOSED` |
| External transfer confirm | Independent confirmer | External evidence and exact version | No self-confirmation | `PROPOSED` |
| Platform configuration | Platform-config permission | Effective date/version | Does not imply private evidence or finance access | `PROPOSED` |

## Tenant and branch invariants

- `PROPOSED`: one delivery has exactly one BMS tenant, branch and order; all are resolved from the
  enabled integration mapping, never copied from an untrusted claim/body.
- `PROPOSED`: Delivery tables use explicit tenant and branch external references plus internal keys.
  Every query is object-scoped; whether Delivery additionally uses PostgreSQL RLS is unresolved and
  must be proved with negative DB tests before Phase 1 closes.
- `PROPOSED`: branch deactivation blocks new work but does not destroy accepted assignments. A drain
  plan/reassignment decision is required.
- `UNRESOLVED`: driver-pool tenancy determines whether a driver row is tenant-owned, platform-owned
  with scoped memberships, or hybrid. Safe pilot default is tenant/branch-authorized membership.

## Audit and rate limiting

- `PROPOSED`: sensitive local mutations audit actor/principal, effective scope, target, reason,
  before/after safe projection, request/correlation/idempotency ids and outcome in the same database
  transaction.
- `PROPOSED`: rate-limit service principal + operation and customer grant + IP; driver limits key on
  driver/device/operation. Rate limiting is fail-closed for abuse-sensitive mutation surfaces.
- `PROPOSED`: secrets, bearer tokens, raw KYC, full addresses, exact GPS and payment data are excluded
  from structured logs.

**STOP — Awaiting approval.**
