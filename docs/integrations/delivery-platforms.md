# Delivery platform integration

This is the operational and engineering contract for GrabFood, LINE MAN and foodpanda. The durable
foundation is migration `10.12`, with lifecycle hardening in `10.14`; provider code lives under
`apps/web/lib/bms/deliveryPlatforms/`.
The integration is deliberately fail-closed: having tables and screens does not mean a provider is
certified for production.

## Current contract status

| Capability | GrabFood | LINE MAN | foodpanda |
| --- | --- | --- | --- |
| Public official source reviewed | [official Java SDK](https://github.com/grab/grabfood-api-sdk-java) | none for food-order/POS integration | [Partner API v2.0.2](https://developer.foodpanda.com/api-specifications), reviewed 2026-09-24 |
| Authentication | partner confirmation required | not public | OAuth2 client credentials (`POST /v2/oauth/token`) verified |
| Webhook/order normalization | partner confirmation required | not public | verified public schema; Partner Portal auth header still required |
| Fetch order | partner confirmation required | not public | verified |
| Accept/reject | SDK documents it; webhook/onboarding still blocks activation | not public | no distinct public accept; rejection mapping needs partner confirmation |
| Ready / dispatched | SDK documents it; activation blocked | not public | logistics: `READY_FOR_PICKUP`; vendor: `DISPATCHED` at local handoff |
| Store pause / item availability | SDK documents it; activation blocked | not public | [Manage Outlet is public](https://developer.foodpanda.com/en/documentation/outlet-management-api-use-cases-endpoints-explained) but pause remains blocked pending operational/retry approval; catalog availability verified |
| Settlement | not public | not public | not public |

“Verified” means the request/response shape was checked against an official public contract. It does
not mean this deployment has credentials, market access, tax approval or production certification.
GrabFood and LINE MAN use contract-blocked adapters and make no network call. foodpanda uses the
published sandbox (`sandbox.partner.deliveryhero.io`) and production host only; the webhook header
name and optional prefix must be copied from the merchant's Partner Portal into non-secret config.
The published Manage Outlet request is not enough to enable automatic pause: request/response,
market reason mapping, timezone handling and safe retry semantics must all be approved first.

Official sources reviewed on 2026-09-24:

- [foodpanda Partner API specifications v2.0.2](https://developer.foodpanda.com/api-specifications):
  OAuth client credentials, token lifetime, order/webhook schema, `transport_type`, order status update
  matrix, retry count, system timestamps and item pricing.
- [Manage Outlet API — use cases and endpoints](https://developer.foodpanda.com/en/documentation/outlet-management-api-use-cases-endpoints-explained):
  public outlet status/reason/`closed_until` contract.
- [Manage Outlet API — integration guide](https://developer.foodpanda.com/en/documentation/outlet-management-api-how-to-integrate):
  public integration flow. It does not close BMS's market reason, timezone and safe retry policy gaps,
  so automatic pause remains partner-confirmation-required.

## Authority and lifecycle

- The URL contains an opaque integration id. The server resolves the tenant from that integration;
  a webhook body can never choose a tenant or branch.
- Provider store id selects only a previously verified branch mapping. A menu line becomes a real
  order line only from a `VERIFIED` item/variant/modifier mapping.
- Provider payloads are normalized inside adapters. A logical webhook id is order + status + provider
  revision/timestamp; a separately canonicalized payload hash detects a provider reusing that id with
  changed content. Same id/same hash is a duplicate; same id/different hash is a durable
  `WEBHOOK_PAYLOAD_CONFLICT`, never a second order. The inbox stores only the hash and allowlisted
  operational pointers, not the raw body, customer phone, address or credentials.
- Fetch-latest never erases the verified webhook fact. The order timeline records both the initial
  provider event and the latest fetched snapshot. A new local order still requires an initial
  `RECEIVED`; a later fetched state does not manufacture local ready, handoff or completion evidence.
- After the external fetch, the worker re-locks the integration and rechecks active/rollout/health,
  credential expiry and `config_version` before any local write. A kill switch or credential/config
  rotation therefore fails closed even when it happens during the network call.
- The worker creates the BMS order, stock reservation, `PLATFORM_SETTLEMENT` payment, provider
  snapshot, timeline and audit in one tenant transaction. Any price, currency, mapping, hours,
  sold-out or stock failure rolls the entire write back.
- Store currency comes from `bms_store_profile.currency` (legacy missing/blank profile values fall
  back to `THB`). Both provider and configured currency must match it. Every mapped item also needs
  a `provider_price_snapshot` matching the fetched unit price; one mismatch rejects the whole basket.
- `PLATFORM_SETTLEMENT` is server-only. It is absent from checkout, POS tenders and AI tools.
  Customer payment and the later merchant payout are different accounting events.
- A cashier accepts the paid order. Immediate orders create kitchen tickets at that boundary.
  Scheduled orders require both `scheduledPrepLeadMinutes` (1–240) and a provider-confirmed
  preparation target, then are claimed by the scheduled-preparation worker only when due. The
  foodpanda public `accepted_for` field is an estimated delivery timestamp, not an acceptance
  deadline or kitchen-ready target, so it is never reinterpreted as either; scheduled foodpanda
  intake remains action-required until the partner contract supplies the missing semantics.
- `transport_type` is typed authority, not JSON metadata. For foodpanda logistics delivery, local
  ready queues `READY_FOR_PICKUP`. For vendor delivery, local ready sends nothing; only the committed
  local rider handoff queues `DISPATCHED`. Missing/unknown transport is action-required.
- Ready and rider handoff are local facts even if the provider API is unavailable. Handoff records
  the device, user, bag count, complete checklist, limited pickup-code display and a hash, and cuts
  reserved/current stock in the same transaction. Provider acknowledgement remains distinct.
- A provider `DELIVERED` event completes the BMS order only after a recorded local handoff. A first
  event for an unknown order must be `RECEIVED`; later-state first sightings become action-required
  incidents rather than manufacturing missing history.

## Setup and rotation

1. Obtain the provider agreement, sandbox account, credentials, webhook contract, retry policy,
   status list, deadlines, cancellation/refund rules, rate limits, settlement sample, API version
   and data-retention terms.
2. Create a `SANDBOX` integration in `OFF` mode. For foodpanda, configure OAuth client id + client
   secret; a legacy encrypted access token remains compatibility-only. OAuth tokens use the provider's
   `expires_in` with a safety margin and an encrypted fleet Redis cache protected by a short refresh
   lock. A provider 401 invalidates that cache and retries the same durable operation once. Secrets
   and bearer tokens are never written to logs, health text or PostgreSQL. Secrets at rest are
   encrypted with `BMS_SECRET_KEY`; list
   APIs return only presence and a short mask. Arbitrary config keys containing `secret`, `token`,
   `password`, `credential` or `privateKey` are rejected.
3. Map one provider store to one BMS location. Record the provider item/variant/modifier identifiers
   obtained from its portal or verified menu read, then verify each against an active `ONLINE_ORDER`
   product variant. Suggested or stale mappings never create a live order. The current screen does
   not pretend that a successful connection test is an automatic catalog import.
4. Run the connection test. It performs a verified menu read outside a database transaction and
   records health without exposing the response body to the browser.
5. Move to `SHADOW`: webhooks are verified/deduplicated and provider snapshots are recorded, but no
   BMS order, payment or reservation is created. Compare against the provider tablet.
6. `LIVE` rollout against the provider's production environment is rejected until webhook, fetch,
   accept and reject contracts are all `VERIFIED`. Today that gate remains closed for all three
   providers. A sandbox integration may use `LIVE` rollout to exercise local order writes, while a
   production integration may remain in `SHADOW` for comparison. Outbound commands have a separate
   kill switch.
7. Rotate by sending only the new credential fields. Blank fields preserve the encrypted value.
   Each update advances `config_version`; in-flight workers detect the changed snapshot and stop
   before local order creation. Audit records which credential types changed, never their contents.

The admin surface is `/admin/delivery-platforms`. It is permission-gated and separates integration
health, branch/menu mappings, operational incidents/timelines, and finance. Thai and English labels
follow the current admin locale; secrets are write-only and only masked presence returns to the
browser.

## Store controls and degraded mode

`bms_delivery_intake_controls` keeps desired local state, observed provider state and sync result as
three separate facts. A pause writes local authority and its command outbox atomically. Unsupported
provider controls become `MANUAL_PROVIDER_ACTION_REQUIRED`; the UI must tell staff to use the
provider tablet. Timed resume uses a version compare-and-set, rechecks restaurant hours, integration
health and credential expiry, and cannot undo a newer manual pause.

Provider calls always happen after commit through `bms_delivery_commands`. Local lease `attempts`
and actual `provider_call_attempts` are separate counters; OAuth exchange and the bounded 401 retry
never change the durable command idempotency identity. A timeout or transient failure stays
retryable with the same local idempotency key. Contract-blocked commands become manual
action, never success. During an outage POS and kitchen continue from committed local orders, while
the provider state is visibly unconfirmed. There is no offline accept/reject: use the provider tablet
and reconcile after BMS connectivity returns.

Workers are protected by `BMS_CRON_SECRET`, recorded in `bms_job_runs`, and use leased
`FOR UPDATE SKIP LOCKED` claims:

- `/api/bms/delivery/events/process`
- `/api/bms/delivery/commands/process`
- `/api/bms/delivery/intake/auto-resume`
- `/api/bms/delivery/scheduled-preparation`
- `/api/bms/delivery/acceptance-timeout`

The acceptance-timeout worker blocks late POS acceptance and creates an audited
`MANUAL_PROVIDER_ACTION_REQUIRED` incident. It deliberately does not release the paid reservation,
cancel a platform payment or invent a provider rejection while the provider reject/refund contract
is unverified. Staff resolve the provider side from the tablet and use the existing restaurant
cancellation/return flow; supported immutable causes include platform cancellation, rider
unavailable, acceptance timeout, store closed and integration failure in addition to out-of-stock
and customer change.

The 15-minute GitHub schedule is recovery polling. Production order/event latency needs a continuous
worker; do not describe the recovery schedule as realtime.

## Finance and tax gate

Settlement, lines, append-only adjustments, disputes and private evidence have tenant-scoped tables,
but no live settlement adapter is enabled without an official format. Never rewrite the original
payment or sale to make a statement match. Reconciliation outcomes are `MATCHED`, `MISSING_ORDER`,
`MISSING_SETTLEMENT`, `AMOUNT_MISMATCH`, `REFUND_MISMATCH`, `ADJUSTED` or `DISPUTED`.

Finance can import a bounded normalized statement manually from the Finance tab. The server derives
provider from the selected integration, rejects duplicate statement/order references, matches only
orders from that tenant/integration, creates explicit missing lines, and audits the import. Provider
CSV/API parsing remains adapter work because no public settlement format is verified. A platform
refund cannot be confirmed from the POS refund button: only a matching provider settlement/refund
line completes its pending `PLATFORM_SETTLEMENT` allocation and records the provider-refund timeline.

Before production, Finance must sign off who issues the receipt and tax invoice, whether delivery
fees are merchant revenue, how merchant/provider discounts are booked, what document supports
commission, and whether BMS prints a document in the bag. Until that decision exists, do not
automatically issue an additional tax document for a platform order.

## Privacy and retention

- No automatic CRM customer creation or identity merge.
- Kitchen and timeline surfaces receive no customer phone/address or raw provider payload.
- Webhook authentication is constant-time and fail-closed, with a 256 KiB body ceiling and rate
  limit. Unknown authentication headers are not guessed.
- OAuth bearer tokens are short-lived and cached encrypted in shared Redis; they are never stored as
  plaintext in Redis/PostgreSQL or copied into error/health records.
- Dispute files must use `private` visibility and carry a tenant binding.
- Retention/anonymization periods come from the signed provider agreement. Until they are known,
  retain only the sanitized operational records needed for audit and do not add raw-payload storage.

## Pilot, rollback and support

Roll out in this order: local fixtures → provider sandbox → shadow → one tenant/branch/provider and
limited hours → one full settlement cycle → full branch → next branch → next provider. Keep the
provider tablet beside the register through pilot.

Rollback is operational, never destructive: set rollout `OFF`, disable the integration or outbound
commands, pause the branch/provider, stop workers, and return to the provider tablet. Preserve event,
command, order, handoff and finance history, then reconcile before reopening.

For an incident:

1. Disable outbound commands if requests may be wrong; use the branch/provider pause if new intake
   is unsafe.
2. Check Operations Schedule and command/event backlogs. A green GitHub job without `bms_job_runs`
   evidence is not proof the worker ran.
3. Compare local desired state, provider state and last command separately. Do not mark a failed
   provider command successful by hand.
4. Use the provider tablet for live operations. Never create a manual duplicate BMS order for the
   same provider order id.
5. After recovery, replay retryable inbox/outbox rows, fetch authoritative provider state where the
   verified adapter supports it, and record resolution in the safe timeline/audit.

The integration is not production-complete until official credentials/contracts, sandbox lifecycle,
shadow comparison, security/load tests, tax approval and at least one real settlement cycle pass.

## Explicitly open work behind those gates

The foundation intentionally does not claim features for which there is no verified authority or
no completed operational surface. Before production sign-off, the project still needs provider
catalog drift polling, authoritative order reconciliation/fetch-latest actions, provider-confirmed
amendments, capacity recommendations, shift-handover acknowledgement, saved/bulk inbox actions,
role-targeted notification escalation, dispute-evidence upload workflow, provider statement parser,
retention/anonymization jobs, load/security exercises, and native-client workflows if the pilot uses
mobile POS. These are not silently simulated by the current UI. They remain visible pilot blockers
alongside credentials, tax ownership, sandbox certification and a real settlement cycle.
