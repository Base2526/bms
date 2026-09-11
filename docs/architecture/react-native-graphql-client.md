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

The external React Native app can use this factory. `getDeviceToken()` should read from secure
storage. `httpUrl` and `wsUrl` must be explicit environment values in release builds.

```ts
import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, split } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

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

Subscribe once after device pairing. Treat every event as a hint, not data authority.

```graphql
subscription NativeRealtimeEvents {
  realtimeEvent {
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

