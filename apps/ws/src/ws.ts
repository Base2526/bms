import { createServer, type IncomingMessage } from "node:http";

import { makeExecutableSchema } from "@graphql-tools/schema";
import type { ExecutionArgs } from "graphql";
import { GraphQLError } from "graphql/error";
import { useServer } from "graphql-ws/lib/use/ws";
import WebSocket, { WebSocketServer } from "ws";

import {
  acquireRealtimeConnectionLease,
  closeRealtimeRedis,
  readRealtimeRedisValue,
  realtimeRedisPing,
  refreshRealtimeConnectionLease,
  releaseRealtimeConnectionLease,
} from "../../../packages/realtime/src/pubsub.js";
import { verifyRealtimeTicket, type RealtimeTicketClaims } from "../../../packages/realtime/src/wsTicket.js";
import { typeDefs, resolvers } from "./shared.js";
import {
  inspectSubscriptionOperation,
  isAllowedOrigin,
  parseAllowedOrigins,
  positiveInteger,
  realtimeConnectionLeaseLimits,
} from "./security.js";

const production = process.env.NODE_ENV === "production";
const PORT = positiveInteger(process.env.WS_PORT, 8080, 1, 65_535, "WS_PORT");
const PATH = process.env.WS_PATH || "/graphql";
const CONNECTION_INIT_TIMEOUT_MS = positiveInteger(process.env.WS_CONNECTION_INIT_TIMEOUT_MS, 10_000, 1_000, 60_000, "WS_CONNECTION_INIT_TIMEOUT_MS");
const IDLE_TIMEOUT_MS = positiveInteger(process.env.WS_IDLE_TIMEOUT_MS, 90_000, 15_000, 600_000, "WS_IDLE_TIMEOUT_MS");
const PING_INTERVAL_MS = positiveInteger(process.env.WS_PING_INTERVAL_MS, 25_000, 5_000, 120_000, "WS_PING_INTERVAL_MS");
const AUTH_RECHECK_MS = positiveInteger(process.env.WS_AUTH_RECHECK_MS, 15_000, 5_000, 60_000, "WS_AUTH_RECHECK_MS");
const MAX_MESSAGE_BYTES = positiveInteger(process.env.WS_MAX_MESSAGE_BYTES, 65_536, 1_024, 1_048_576, "WS_MAX_MESSAGE_BYTES");
const MAX_QUERY_BYTES = positiveInteger(process.env.WS_MAX_QUERY_BYTES, 16_384, 1_024, 262_144, "WS_MAX_QUERY_BYTES");
const MAX_VARIABLES_BYTES = positiveInteger(process.env.WS_MAX_VARIABLES_BYTES, 16_384, 1_024, 262_144, "WS_MAX_VARIABLES_BYTES");
const MAX_BUFFERED_BYTES = positiveInteger(process.env.WS_MAX_BUFFERED_BYTES, 1_048_576, 65_536, 16_777_216, "WS_MAX_BUFFERED_BYTES");
const MAX_SUBSCRIPTIONS = positiveInteger(process.env.WS_MAX_SUBSCRIPTIONS_PER_CONNECTION, 20, 1, 200, "WS_MAX_SUBSCRIPTIONS_PER_CONNECTION");
const MAX_PER_IP = positiveInteger(process.env.WS_MAX_CONNECTIONS_PER_IP, 100, 1, 10_000, "WS_MAX_CONNECTIONS_PER_IP");
const MAX_PER_USER = positiveInteger(process.env.WS_MAX_CONNECTIONS_PER_USER, 10, 1, 1_000, "WS_MAX_CONNECTIONS_PER_USER");
const MAX_PER_TENANT = positiveInteger(process.env.WS_MAX_CONNECTIONS_PER_TENANT, 1_000, 1, 100_000, "WS_MAX_CONNECTIONS_PER_TENANT");
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.WS_ALLOWED_ORIGINS, production);
const schema = makeExecutableSchema({ typeDefs, resolvers });

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (production) throw new Error("JWT_SECRET is required for realtime tickets");
    return "changeme_secret";
  }
  return secret;
}

type SocketState = {
  claims: RealtimeTicketClaims;
  leaseKeys: string[];
  subscriptions: number;
  alive: boolean;
  lastActivityAt: number;
  expiryTimer: ReturnType<typeof setTimeout>;
  lastAuthCheckAt: number;
};

const states = new WeakMap<WebSocket, SocketState>();
const metrics = {
  connectionAttempts: 0,
  acceptedConnections: 0,
  rejectedConnections: 0,
  originRejections: 0,
  activeConnections: 0,
  activeSubscriptions: 0,
  authFailures: 0,
  slowConsumerCloses: 0,
  eventsDelivered: 0,
  deliveryErrors: 0,
  eventToClientLatencyMsTotal: 0,
  eventToClientLatencyMsMax: 0,
  eventToClientLatencySamples: 0,
};
let draining = false;

function securityLog(event: string, data: Record<string, string | number | boolean | undefined> = {}) {
  console.log(JSON.stringify({ level: "info", component: "ws", event, ...data }));
}

function requestIp(request: { socket?: { remoteAddress?: string }; headers?: Record<string, unknown> }): string {
  if (process.env.WS_TRUST_PROXY === "1") {
    const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return String(request.socket?.remoteAddress || "unknown");
}

function ticketFromParams(params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("TICKET_REQUIRED");
  const keys = Object.keys(params);
  if (keys.length !== 1 || keys[0] !== "ticket") throw new Error("INVALID_CONNECTION_PARAMS");
  const ticket = (params as { ticket?: unknown }).ticket;
  if (typeof ticket !== "string") throw new Error("TICKET_REQUIRED");
  return ticket;
}

async function sessionIsActive(claims: RealtimeTicketClaims): Promise<boolean> {
  if (claims.scope !== "admin") return true;
  return Boolean(claims.sessionId) &&
    (await readRealtimeRedisValue(`session:admin:${claims.sessionId}`)) === claims.subjectId;
}

function graphQLError(code: string) {
  return [new GraphQLError(code, { extensions: { code } })];
}

const httpServer = createServer(async (request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(draining ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: !draining }));
    return;
  }
  if (request.url === "/readyz") {
    let redis = false;
    try { redis = !draining && await realtimeRedisPing(); } catch { redis = false; }
    response.writeHead(redis ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: redis, redis, draining }));
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(metrics));
    return;
  }
  response.writeHead(404).end();
});

const wss = new WebSocketServer({
  server: httpServer,
  path: PATH,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => {
    metrics.connectionAttempts += 1;
    const accepted = !draining && (
      isAllowedOrigin(origin, ALLOWED_ORIGINS)
      || (!origin && req.headers["x-bms-client-class"] === "native")
    );
    if (!accepted) {
      metrics.rejectedConnections += 1;
      if (!draining) metrics.originRejections += 1;
    }
    return accepted;
  },
});

const disposer = useServer(
  {
    schema,
    connectionInitWaitTimeout: CONNECTION_INIT_TIMEOUT_MS,
    onConnect: async (ctx) => {
      const socket = ctx.extra.socket as WebSocket;
      try {
        if (draining) throw new Error("SERVER_DRAINING");
        const claims = await verifyRealtimeTicket(ticketFromParams(ctx.connectionParams), jwtSecret());
        if (!(await sessionIsActive(claims))) throw new Error("SESSION_REVOKED");
        const limits = realtimeConnectionLeaseLimits({
          ip: requestIp(ctx.extra.request as any),
          subjectId: claims.subjectId,
          tenantId: claims.tenantId,
          maximumPerIp: MAX_PER_IP,
          maximumPerUser: MAX_PER_USER,
          maximumPerTenant: MAX_PER_TENANT,
        });
        if (!(await acquireRealtimeConnectionLease(limits, IDLE_TIMEOUT_MS * 2))) throw new Error("CONNECTION_LIMIT_EXCEEDED");
        const expiryTimer = setTimeout(
          () => socket.close(4403, "ticket expired"),
          Math.max(1, claims.expiresAt * 1000 - Date.now()),
        );
        states.set(socket, {
          claims,
          leaseKeys: limits.map((item) => item.key),
          subscriptions: 0,
          alive: true,
          lastActivityAt: Date.now(),
          expiryTimer,
          lastAuthCheckAt: Date.now(),
        });
        metrics.acceptedConnections += 1;
        metrics.activeConnections += 1;
        securityLog("connection.accepted", { scope: claims.scope, tenantScoped: Boolean(claims.tenantId) });
        return true;
      } catch (error) {
        metrics.rejectedConnections += 1;
        metrics.authFailures += 1;
        securityLog("connection.rejected", { reason: error instanceof Error ? error.message : "AUTH_FAILED" });
        return false;
      }
    },
    onSubscribe: async (ctx, msg) => {
      const socket = ctx.extra.socket as WebSocket;
      const state = states.get(socket);
      if (!state || state.claims.expiresAt * 1000 <= Date.now()) return graphQLError("UNAUTHENTICATED");
      if (state.subscriptions >= MAX_SUBSCRIPTIONS) return graphQLError("SUBSCRIPTION_LIMIT_EXCEEDED");
      try {
        if (!(await sessionIsActive(state.claims))) return graphQLError("UNAUTHENTICATED");
        const inspected = inspectSubscriptionOperation({
          query: msg.payload.query,
          operationName: msg.payload.operationName,
          variables: msg.payload.variables,
          maximumQueryBytes: MAX_QUERY_BYTES,
          maximumVariablesBytes: MAX_VARIABLES_BYTES,
          production,
        });
        state.subscriptions += 1;
        metrics.activeSubscriptions += 1;
        const identity = { id: state.claims.subjectId, tenant_id: state.claims.tenantId };
        const execArgs: ExecutionArgs = {
          schema,
          document: inspected.document,
          variableValues: msg.payload.variables,
          operationName: inspected.operationName,
          contextValue: {
            scope: state.claims.scope,
            realtime: state.claims,
            user: identity,
            admin: state.claims.scope === "admin" ? identity : null,
          },
        };
        return execArgs;
      } catch (error) {
        return graphQLError(error instanceof Error ? error.message : "SUBSCRIPTION_REJECTED");
      }
    },
    onComplete: (ctx) => {
      const state = states.get(ctx.extra.socket as WebSocket);
      if (state?.subscriptions) {
        state.subscriptions -= 1;
        metrics.activeSubscriptions = Math.max(0, metrics.activeSubscriptions - 1);
      }
    },
    // The generic stream and all 18 named domain subscriptions deliver the same envelope,
    // each under its own field name. Reading `data.realtimeEvent` only made every named
    // subscription invisible here, so the counter that answers "is realtime delivering at
    // all" would read zero for the native clients those subscriptions exist for. The
    // operation is validated to carry exactly one root field, so there is exactly one value
    // to look at; a payload without an eventId is a legacy chat subscription, not an event.
    onNext: (_ctx, _message, _args, result) => {
      const data = (result as { data?: Record<string, unknown> }).data;
      const payload = data ? Object.values(data)[0] : undefined;
      if (!payload || typeof payload !== "object") return;
      const event = payload as { eventId?: unknown; occurredAt?: unknown };
      if (typeof event.eventId !== "string") return;
      metrics.eventsDelivered += 1;
      if (typeof event.occurredAt === "string") {
        const latency = Math.max(0, Date.now() - Date.parse(event.occurredAt));
        if (Number.isFinite(latency)) {
          metrics.eventToClientLatencyMsTotal += latency;
          metrics.eventToClientLatencyMsMax = Math.max(metrics.eventToClientLatencyMsMax, latency);
          metrics.eventToClientLatencySamples += 1;
        }
      }
    },
    onError: () => {
      metrics.deliveryErrors += 1;
    },
    onDisconnect: async (ctx) => {
      const socket = ctx.extra.socket as WebSocket;
      const state = states.get(socket);
      if (!state) return;
      clearTimeout(state.expiryTimer);
      metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
      metrics.activeSubscriptions = Math.max(0, metrics.activeSubscriptions - state.subscriptions);
      states.delete(socket);
      await releaseRealtimeConnectionLease(state.leaseKeys).catch(() => undefined);
    },
  },
  wss,
);

wss.on("connection", (socket: WebSocket) => {
  const eventSocket = socket as WebSocket & { on(event: "message" | "pong", listener: () => void): void };
  eventSocket.on("message", () => {
    const state = states.get(socket);
    if (state) state.lastActivityAt = Date.now();
  });
  eventSocket.on("pong", () => {
    const state = states.get(socket);
    if (state) {
      state.alive = true;
      state.lastActivityAt = Date.now();
    }
  });
});

const maintenanceTimer = setInterval(() => {
  for (const socket of wss.clients) {
    const state = states.get(socket);
    if (!state) continue;
    if (!state.alive || Date.now() - state.lastActivityAt > IDLE_TIMEOUT_MS) {
      socket.terminate();
      continue;
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      metrics.slowConsumerCloses += 1;
      socket.close(4408, "slow consumer");
      continue;
    }
    state.alive = false;
    socket.ping();
    void refreshRealtimeConnectionLease(state.leaseKeys, IDLE_TIMEOUT_MS * 2)
      .then((renewed) => { if (!renewed) socket.close(1013, "realtime lease lost"); })
      .catch(() => socket.close(1013, "realtime dependency unavailable"));
    if (Date.now() - state.lastAuthCheckAt >= AUTH_RECHECK_MS) {
      state.lastAuthCheckAt = Date.now();
      void sessionIsActive(state.claims)
        .then((active) => { if (!active) socket.close(4403, "session revoked"); })
        .catch(() => socket.close(1013, "realtime dependency unavailable"));
    }
  }
}, PING_INTERVAL_MS);
maintenanceTimer.unref();

async function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  securityLog("server.draining", { signal });
  clearInterval(maintenanceTimer);
  httpServer.close();
  for (const socket of wss.clients) socket.close(1012, "service restart");
  const forceTimer = setTimeout(() => {
    for (const socket of wss.clients) socket.terminate();
  }, 10_000);
  forceTimer.unref();
  await disposer.dispose();
  await closeRealtimeRedis();
  clearTimeout(forceTimer);
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

httpServer.listen(PORT, "0.0.0.0", () => {
  securityLog("server.listening", { port: PORT, path: PATH });
});
