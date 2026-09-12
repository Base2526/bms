# React Native GraphQL + realtime client

> Server contract: [mobile-graphql-ws-realtime.md](mobile-graphql-ws-realtime.md) · API details:
> [api.md](api.md)

The native POS uses HTTPS GraphQL for reads and commands and GraphQL WS for scoped invalidation
events. It does **not** send sales, payments, stock changes, or PINs over WebSocket. This preserves
normal HTTP retry/idempotency semantics while Redis + WS removes polling latency.

## Endpoints and authentication

| Purpose | Endpoint | Headers / connection parameters |
| --- | --- | --- |
| Query and mutation | `POST https://<host>/api/graphql` | `x-scope: pos`, `Authorization: Bearer <device-token>` |
| Mint WS ticket | `POST https://<host>/api/bms/realtime/ticket?scope=pos` | `Authorization: Bearer <device-token>` |
| Subscription | `wss://<ws-host>/graphql` | `connectionParams: { ticket }` using the returned short-lived ticket |

Store the device token in the platform keychain/keystore, never AsyncStorage. A cashier PIN exists
only for the current operation body and must not be cached or added to WS connection parameters.

## Apollo setup

The repository implementation is
`apps/mobile/src/graphql/BmsGraphqlProvider.tsx`, generated from `schema.graphql` by
`apps/mobile/codegen.ts`. The condensed factory below shows the same boundary. `getDeviceToken()`
must read from secure storage. `httpUrl` and `wsUrl` must be explicit environment values in release
builds. React Native sockets send `x-bms-client-class: native`; this is required for iOS, where a
native socket may not send an `Origin` header.

```ts
import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, split } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

class NativeWebSocket extends WebSocket {
  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols, { headers: { "x-bms-client-class": "native" } });
  }
}

type NativeBmsClientOptions = {
  httpUrl: string;
  wsUrl: string;
  getDeviceToken(): Promise<string>;
};

export function createNativeBmsClient(options: NativeBmsClientOptions) {
  const auth = setContext(async (_, { headers }) => {
    const token = await options.getDeviceToken();
    return {
      headers: {
        ...headers,
        "x-scope": "pos",
        authorization: `Bearer ${token}`,
      },
    };
  });

  const http = auth.concat(new HttpLink({ uri: options.httpUrl }));
  const ws = new GraphQLWsLink(createClient({
    url: options.wsUrl,
    webSocketImpl: NativeWebSocket,
    lazy: true,
    retryAttempts: Infinity,
    retryWait: async (attempt) => {
      const cap = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
      await new Promise((resolve) => setTimeout(resolve, cap + Math.random() * cap / 3));
    },
    connectionParams: async () => {
      const token = await options.getDeviceToken();
      const response = await fetch(`${options.httpUrl.replace(/\/api\/graphql$/, "")}/api/bms/realtime/ticket?scope=pos`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`REALTIME_TICKET_${response.status}`);
      const body = await response.json();
      if (typeof body.ticket !== "string") throw new Error("REALTIME_TICKET_INVALID");
      return { ticket: body.ticket };
    },
  }));

  return new ApolloClient({
    cache: new InMemoryCache(),
    link: split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return definition.kind === "OperationDefinition" && definition.operation === "subscription";
      },
      ws,
      http,
    ),
  });
}
```

## Invalidation subscription

Subscribe after device pairing. Use the named, argument-free views for the active surface and treat
every event as a hint, not data authority. The current client opens seven base POS views and seven
additional restaurant views, leaving capacity below the gateway's per-socket limit.

```graphql
subscription MobileShiftChanged {
  bmsShiftChanged {
    eventId
    eventType
    schemaVersion
    tenantId
    locationId
    deviceId
    entityType
    entityId
    aggregateVersion
    updatedAt
    occurredAt
    payload
  }
}
```

The client must keep a bounded set of recent `eventId` values, ignore duplicate or older aggregate
versions, batch events for roughly 150 ms, then refetch only affected active queries. On reconnect,
app foreground, and manual refresh, refetch all active authoritative snapshots. If WS is unavailable,
queries and mutations continue working; show degraded state and keep a low-frequency reconciliation
poll until production recovery/load tests are complete.

## Command rules

- Generate one stable `idempotencyKey` before a money/stock/document mutation and reuse it for every
  retry of that logical action. A new key means a new action.
- Include `cashierUserId` + `pin` in the mutation input. Include the distinct approver fields only
  when the workflow requires them. Never persist either PIN.
- Do not send tenant, location, or device IDs. They are rejected as authority and derived from the
  device token.
- Use the named `bmsPos*` operations in `apps/web/graphql/bmsPosDevice.ts`. Back-office mobile flows
  use the named operations in `apps/web/graphql/bmsMobileOperations.ts` with staff Bearer auth.
- Continue to use REST only for pharmacy-evidence bytes, shift-report export, and support
  diagnostics.

## Typed operation coverage

Generate client types from the committed root [`schema.graphql`](../../schema.graphql), not from
production introspection. The artifact is generated from the executable schema with
`cd apps/web && npm run schema:export`; CI rejects drift.

| Output contract | Operations |
| --- | --- |
| Typed (100) | Every mobile/POS query and mutation exported by bmsPosDevice and bmsMobileOperations; the executable-schema contract checks the exact set and recursively rejects nested `JSON`. |
| JSON compatibility (0) | None. |

All 100 operations have typed arguments and typed output trees. Generate result types from the
committed schema instead of hand-maintaining response interfaces. The examples below cover the ten
core screen flows and are checked against the executable schema; the remaining operations are
discoverable from the same artifact and no longer require a client-side JSON boundary validator.

### Named command migration

New clients must use the named mutations instead of sending an `action` discriminator. The six POS
restaurant multiplexers and the two staff inventory multiplexers remain only as deprecated
compatibility fields until existing callers migrate:

- Check: `bmsPosRestaurantAddCheckItem`, `bmsPosRestaurantRemoveCheckItem`,
  `bmsPosRestaurantSetCheckGuestCount`, `bmsPosRestaurantSendCheckToKitchen`,
  `bmsPosRestaurantMoveCheck`, `bmsPosRestaurantSplitCheck`, `bmsPosRestaurantMergeChecks`,
  `bmsPosRestaurantCancelCheck`, `bmsPosRestaurantSettleCheck`.
- Online/QR/request: `bmsPosRestaurantAcceptIncomingOrder`,
  `bmsPosRestaurantSetOrderingPaused`, `bmsPosRestaurantCancelOrderLines`,
  `bmsPosRestaurantAcceptQrSubmission`, `bmsPosRestaurantRejectQrSubmission`,
  `bmsPosRestaurantContactRequest`, `bmsPosRestaurantConfirmRequest`,
  `bmsPosRestaurantCancelRequest`.
- Service/waitlist: `bmsPosRestaurantAcknowledgeServiceCall`,
  `bmsPosRestaurantCompleteServiceCall`, `bmsPosRestaurantAddWaitlistEntry`,
  `bmsPosRestaurantCallWaitlistEntry`, `bmsPosRestaurantCancelWaitlistEntry`,
  `bmsPosRestaurantNoShowWaitlistEntry`, `bmsPosRestaurantSeatWaitlistEntry`.
- Inventory: `bmsCreateStockTransfer`, `bmsSendStockTransfer`, `bmsReceiveStockTransfer`,
  `bmsCancelStockTransfer`, `bmsCreateStockCount`, `bmsRecordStockCountItem`,
  `bmsApplyStockCount`, `bmsCancelStockCount`.

Each named field has an action-specific input and delegates to the same compatibility resolver, so
authorization, approval, audit, transaction, and idempotency behavior does not fork during rollout.

### Device bootstrap screen

Fetch once after pairing and refetch after reconnect, foreground, shift change, or a relevant
invalidation. Keep `shift.id` as returned state; never send it back as authority.

```graphql
query PosBootstrap {
  bmsPosSession {
    device {
      id
      code
      name
      registeredPosNo
      scanner { mode prefixKey suffixKey maxGapMs }
    }
    location { id name branchCode vatCode pharmacistName }
    shift {
      id
      locationId
      deviceId
      status
      openedBy
      openedAt
      openingFloat
      pharmacistUserId
    }
    shiftReturnSummary { returnCount returnTotal settledTotal pendingTotal pendingCount }
    cashiers { id name email role isPharmacist hasPin posOnly }
    purchaseReceivers { id name role hasPin }
    approvers { id name role isPharmacist hasPin approvals }
    kitchenOperators { id name role hasPin }
    store { taxId receiptLanguageMode }
    surface
    businessArchetype
    vat { registered priceIncludesVat rate calendarEra cashRounding }
  }
}
```

### Product search and scanner screen

Use catalog search for operator text and scan for an exact barcode/PLU. Request images only on a
screen that renders them; `withImage` otherwise stays false.

```graphql
query PosCatalogSearch($q: String!) {
  bmsPosCatalogSearch(q: $q) {
    items {
      sku
      name
      price
      availableTotal
      availability
      availableSizes { size available price }
      imageUrl
    }
  }
}

query PosScan($code: String!, $size: String, $packCode: String, $surface: String) {
  bmsPosScan(code: $code, size: $size, packCode: $packCode, surface: $surface) {
    sku
    productName
    receiptName
    size
    packCode
    unitName
    baseQty
    packPrice
    basePrice
    priceTiers { minQty scope size unitPrice discountPct }
    promotion { kind buyQty getQty bundlePrice }
    serialTracked
    modifiers {
      code
      name
      priceDelta
      groupCode
      groupName
      selectionType
      minSelect
      maxSelect
      defaultSelected
    }
    scaleBarcode
    available
  }
}
```

### Restaurant floor and menu screens

These two snapshots are independent so an invalidation can refetch only the visible surface.

```graphql
query RestaurantFloor {
  bmsPosRestaurantFloor {
    areas { id name sortOrder tableCount }
    tables {
      id
      areaId
      code
      name
      seats
      shape
      positionX
      positionY
      blocked
      active
      status
      check { id status guestCount amountDue itemCount unsentCount version reservedVersion }
      checks { id status amountDue itemCount splitGroupNo }
    }
  }
}

query RestaurantMenu {
  bmsPosRestaurantMenu {
    items {
      sku
      name
      price
      kitchenStation
      kitchenStationId
      hasModifiers
      availableSizes { size available }
      availableTotal
      sellable
      availability
      unavailableResetsAt
      unavailableReason
      imageUrl
    }
  }
}
```

### Restaurant check screen

The root is nullable because the check can disappear between floor selection and detail fetch.
Treat `version`/`reservedVersion` as state display and reconciliation fields, not client authority.

```graphql
query RestaurantCheck($id: ID!) {
  bmsPosRestaurantCheck(id: $id) {
    id
    tableId
    tableCode
    tableName
    areaName
    status
    guestCount
    note
    amountDue
    splitGroupNo
    splitFromCheckId
    mergedIntoCheckId
    version
    reservedVersion
    hasCurrentOrder
    reservationStatus
    reservationLost
    openedAt
    items {
      id
      sku
      productName
      size
      packQty
      packCode
      unitName
      lineAmount
      modifierCodes
      modifierNames
      kitchenNote
      status
      roundNo
      sentAt
      kitchenStatus
    }
  }
}
```

### Kitchen board

`stationSlas` is a list because station identifiers are dynamic data, not GraphQL field names.
`orderId` and `checkId` are both nullable; select both and branch on `source`.

```graphql
query KitchenBoard($status: String, $limit: Int = 100) {
  bmsPosKitchenTickets(status: $status, limit: $limit) {
    generatedAt
    stations { id name sortOrder }
    stationSlas { stationRef warnMinutes lateMinutes }
    tickets {
      id
      source
      orderId
      checkId
      tableCode
      tableName
      roundNo
      kitchenNote
      orderItemId
      stationId
      station
      status
      modifierCodes
      productSku
      productName
      size
      packQty
      qty
      createdAt
      updatedAt
    }
  }
}
```

### Retail checkout screen

Generate `$input.idempotencyKey` before the first send. The result is a nullable superset because
different business outcomes populate different fields; always branch on `status` first.

```graphql
mutation CompletePosSale($input: BmsPosSaleInput!) {
  bmsPosSale(input: $input) {
    status
    orderId
    saleLocationId
    posDeviceId
    shiftId
    total
    cashTendered
    cashChange
    docNo
    receiptNo
    billNo
    replayed
    reason
    code
    sku
    size
    requested
    available
    vat { rate taxableAmount exemptAmount vatAmount netBeforeVat roundingAmount }
    discountLines { source label amount pointsUsed }
    pointsEarned
    pointsBalance
    items {
      sku
      name
      size
      qty
      unitPrice
      receiptUnitPrice
      availableAfter
      packCode
      packUnitName
      packQty
      packUnitPrice
      modifierCodes
      vatCategory
      pricingSnapshot {
        source
        modifierUnitPrice
        priceTiers { minQty scope size unitPrice discountPct }
        promotion { kind buyQty getQty bundlePrice }
      }
    }
    blockers { status sku salePolicy maxQuantity requested }
  }
}
```

### Open-table dialog

The response `check` is nullable for a completed business rejection; inspect GraphQL errors first,
then the returned object.

```graphql
mutation OpenRestaurantCheck($input: BmsPosRestaurantOpenCheckInput!) {
  bmsPosRestaurantOpenCheck(input: $input) {
    check {
      id
      tableId
      tableCode
      tableName
      status
      guestCount
      amountDue
      version
      reservedVersion
      openedAt
    }
  }
}
```

### Shift dialog

The same typed mutation currently carries `action: "open" | "close"`; use the fields returned for
that action and branch on `status`. A close with an unknown transport outcome must be reconciled from
`bmsPosSession` before another attempt.

```graphql
mutation ChangePosShift($input: BmsPosShiftInput!) {
  bmsPosShift(input: $input) {
    status
    reason
    partialReturnCashOut
    cashIn
    cashOut
    count
    amount
    shift {
      id
      locationId
      deviceId
      status
      openedBy
      openedAt
      openingFloat
      pharmacistUserId
      closedAt
      expectedCash
      countedCash
      cashVariance
    }
  }
}
```

## Error contract

GraphQL transport/execution failures are returned in `errors[]`; every entry has a non-empty
`extensions.code`. Read the code, not the localized message. A response can contain both partial
`data` and `errors`, so apply only fields that are present and then follow the action below.

| `extensions.code` | Meaning | Client action |
| --- | --- | --- |
| `GRAPHQL_PARSE_FAILED` | The document is not valid GraphQL syntax. | Developer/configuration fault. Do not retry; report the operation/version. |
| `GRAPHQL_VALIDATION_FAILED` | The document or field selection does not match the deployed schema. | Stop the operation and require a compatible app/schema version. |
| `BAD_USER_INPUT` | Arguments failed boundary validation or variable coercion. | Keep the form open, highlight/correct input, then submit a new attempt. |
| `UNAUTHENTICATED` | User/device credential is missing, expired, revoked, or in the wrong scope. | Stop retries; clear the connection and re-login or re-pair the device. |
| `FORBIDDEN` | Identity is valid but lacks a permission, valid PIN, or required second-person approval. | Do not retry automatically; show the operator the permission/approval problem. |
| `NOT_FOUND` | The referenced tenant-scoped object is absent or no longer visible to this principal. | Drop stale selection, refetch its parent/list, and let the operator choose again. |
| `CONFLICT` | Current authoritative state no longer allows the command (for example, no open shift). | Refetch the affected snapshot. Never blind-retry against stale state. |
| `INTERNAL_SERVER_ERROR` | Unexpected server/provider/infrastructure failure, including an uncategorized service exception. | Treat mutation outcome as unknown. Retry only when the operation is replay-safe, using the exact same idempotency key; otherwise ask the operator to reconcile. |

Business rejections are not GraphQL errors. Results such as `PAYMENT_MISMATCH`, `SHIFT_NOT_OPEN`,
`OUT_OF_STOCK`/`INSUFFICIENT`, `SOLD_OUT_TODAY`, `IDEMPOTENCY_CONFLICT`, and pharmacy policy
statuses arrive in `data.<operation>.status`. They are completed decisions: branch on the typed
status/result fields, show the next operator action, and do not put them into a transport retry loop.

## Token and ticket refresh

Two credentials with different lifetimes. Do not conflate them.

| Credential | Lifetime | How it is renewed |
| --- | --- | --- |
| Device token (POS) / user Bearer (staff) | long-lived, stored in the keychain | replaced only by re-pairing or re-login; never auto-rotated by the client |
| WS ticket | short-lived, audience-bound, minted over HTTPS | re-minted on every connect and on every reconnect attempt |

The ticket is never cached across reconnects. `connectionParams` is a function, so
`graphql-ws` calls it again on each attempt and mints a fresh ticket; a ticket that expires
mid-connection makes the server close the socket with **4403 `ticket expired`**, which the retry
loop then treats like any other drop. Never pin a ticket into a variable and reuse it.

Handle these close codes distinctly:

- **4403 `ticket expired`** — normal. Reconnect; the next `connectionParams` call mints a new one.
- **Ticket mint returns 401** — the underlying token is gone or revoked. Stop retrying, clear the
  socket, and send the user to re-login or the device to re-pair. Retrying cannot fix this and a
  tight loop against `/api/bms/realtime/ticket` looks like an attack.
- **`CONNECTION_LIMIT_EXCEEDED`** — too many sockets for this IP, user, or tenant. Back off with
  the normal jitter; do not open a second socket to compensate.

HTTP GraphQL carries the long-lived credential directly, so a 401 there means the same thing: stop
and re-authenticate rather than retry.

## Offline queue

Only queue operations that are safe to replay. The rule is the `idempotencyKey`, not the screen.

**Safe to queue** — a money/stock/document mutation that already carries a stable
`idempotencyKey` generated before the first attempt: `bmsPosSale`, `bmsPosReturn`, `bmsPosVoid`,
`bmsPosCashMovement`, `bmsPosDeposit`, `bmsPosReceivePurchase`. Replaying one of these with the
same key returns the original result instead of acting twice.

**Never queue**:

- Anything carrying a cashier or approver PIN. A PIN is evidence for one operation at one moment;
  holding it on disk to replay later turns it into a stored credential. Drop the queued action and
  make the operator redo it with a fresh PIN.
- Reads. Refetch them when the connection returns; a stale queued read is worse than no read.
- Any action whose approval depends on current state (shift still open, check still open, stock
  still reserved). The server re-checks and will reject it, so queueing only delays the error.

Rules for the queue itself:

- One key per logical action, generated **before** the first send and reused for every retry. A new
  key means a new sale.
- Bound the queue and the age of what it holds. An action queued hours ago usually refers to a
  shift that has closed; surface it to the operator instead of sending it silently.
- Flush serially, not in parallel. Two queued sales sent at once can hit the same shift row and
  deadlock.
- After a flush, refetch the authoritative snapshots rather than trusting local state — the server
  may have replayed an older attempt.
- A queued action that fails with a business status (`SHIFT_NOT_OPEN`, `PAYMENT_MISMATCH`,
  `IDEMPOTENCY_CONFLICT`) is finished, not retryable. Show it; do not re-queue it.

## Rollout gate

Ship query-only canary first, compare snapshots with the compatibility REST responses, then enable
idempotent mutations workflow by workflow. Keep REST and polling available until production metrics
show no remaining compatibility caller and WS reconnect/focus reconciliation has passed on both iOS
and Android under background/resume and network-switch scenarios.
