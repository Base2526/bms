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

## Rollout gate

Ship query-only canary first, compare snapshots with the compatibility REST responses, then enable
idempotent mutations workflow by workflow. Keep REST and polling available until production metrics
show no remaining compatibility caller and WS reconnect/focus reconciliation has passed on both iOS
and Android under background/resume and network-switch scenarios.

