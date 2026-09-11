"use client";
import {
  ApolloClient,
  InMemoryCache,
  ApolloLink,
  Observable,
  HttpLink,
  split,
  from
} from "@apollo/client";

import { setContext } from "@apollo/client/link/context";
import { getMainDefinition } from "@apollo/client/utilities";
import { onError } from "@apollo/client/link/error";
import { createUploadLink } from 'apollo-upload-client';

import { addLog } from './log/log';

function backendLogout(reason?: string) {
  const time = new Date().toISOString();
  const msg = `[${time}] Backend logout: ${reason || "session invalid / token rejected"}`;

  addLog( "warn", "backend-logout", msg, {} );
  window.dispatchEvent(new CustomEvent("backend-logout", { detail: { reason } }));
  document.cookie = "token=; Max-Age=0; path=/";
  window.location.href = "/admin/login";
}

function frontendLogout(reason?: string) {
  const time = new Date().toISOString();
  const msg = `[${time}] Frontend logout: ${reason || "token expired / manual logout"}`;

  addLog( "warn", "frontend-logout", msg, {} );
  window.dispatchEvent(new CustomEvent("frontend-logout", { detail: { reason } }));
  document.cookie = "token=; Max-Age=0; path=/";
  window.location.href = "/admin/login";
}



// ----------------------------
// HTTP link
// ----------------------------
// const httpLink = new HttpLink({
//   uri: process.env.NEXT_PUBLIC_GRAPHQL_HTTP, // e.g. "http://localhost:3000/api/graphql"
//   fetch,
// });

const httpLink = createUploadLink({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_HTTP, // e.g. http://localhost:3000/api/graphql
  credentials: "include", // ให้ส่ง cookie ไปด้วยถ้ามี
  fetch,
});

// ----------------------------
// Auth link (เพิ่ม header ทุก request อัตโนมัติ)
// ----------------------------
const authLink = setContext((_, { headers }) => {
  if (typeof window === "undefined") return { headers }; // SSR ไม่มี localStorage

  // const token = localStorage.getItem("token");
  return {
    headers: {
      ...headers,
      // Authorization: token ? `Bearer ${token}` : "",
    },
  };
});

/**
 * ดึงข้อความจริงจาก body ของ error ที่มากับ HTTP 4xx
 *
 * resolver ฝั่งเรา throw `GraphQLError` พร้อม `http: { status: 400 }` (toGqlError)
 * แต่ Apollo Client ถือว่า status >= 300 คือ ServerError แล้วตั้ง message เป็น
 * "Response not successful: Received status code 400" ทับทุกกรณี — ข้อความที่
 * resolver ตั้งใจบอกผู้ใช้ (เช่น "เกินโควตาแพ็กเกจ...", "บาร์โค้ดซ้ำ") จึงไม่เคย
 * ขึ้นบนจอ ทั้งที่ server ส่งมาให้แล้วใน body
 */
function serverErrorMessage(networkError: any): string | null {
  const errors = networkError?.result?.errors;
  if (!Array.isArray(errors)) return null;
  const msg = errors
    .map((e: any) => (typeof e?.message === "string" ? e.message.trim() : ""))
    .filter(Boolean)
    .join(" · ");
  return msg || null;
}

// -------- Error link (จับหมดอายุ/ไม่มีสิทธิ์)
const errorLink = onError(({ graphQLErrors, networkError }) => {
  // GraphQL error พร้อม code
  if (graphQLErrors?.length) {
    for (const err of graphQLErrors) {
      // @ts-ignore
      addLog('error', 'graphql', err.message, err.extensions || {});

      const code = err?.extensions?.code;
      const reason = err?.extensions?.reason;

      if (code === "UNAUTHENTICATED") {
        if (reason?.startsWith("backend")) {
          backendLogout(); // บังคับออก เช่น token invalid จาก server
        } else {
          frontendLogout(); // เช่น token หมดอายุ local แต่ยังไม่เรียก server
        }
        return;
      }
    }
  }
  // HTTP network error
  // @ts-ignore
  const status = networkError?.statusCode || networkError?.response?.status;

  // เขียน message ทับด้วยของจริงจาก server ก่อนส่งต่อให้หน้าจอ (onError ของ
  // useMutation/useQuery ได้ error ตัวเดียวกันนี้) — ไม่มี body ก็ปล่อยข้อความเดิมไว้
  const serverMsg = serverErrorMessage(networkError);
  if (serverMsg) {
    addLog("error", "graphql", serverMsg, { status: status ?? null });
    try {
      (networkError as any).message = serverMsg;
    } catch {
      // message เป็น read-only ในบาง environment → ปล่อยข้อความเดิม
    }
  }

  // 401 = ไม่ได้ล็อกอิน/token เสีย → บังคับออก
  // 403 = ล็อกอินอยู่แต่ไม่มีสิทธิ์ (เช่น requirePermission) → อย่า logout แค่แสดง error
  if (status === 401) {
    addLog('error', 'graphql', status, {});
    backendLogout();
  } else if (status === 403) {
    addLog('warn', 'graphql', '403 forbidden (no permission) — not logging out', {});
  }
});

// ----------------------------
// Lazy WebSocket link (สำหรับ Subscription)
// - keeps auth/first paint lighter by loading ws deps only when needed
// ----------------------------
type WsScope = "web" | "admin" | "pos";
export type RealtimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "degraded";
const wsLinks: Partial<Record<WsScope, ApolloLink>> = {};
const wsLinkLoading: Partial<Record<WsScope, Promise<ApolloLink>>> = {};
const wsClients: Partial<Record<WsScope, { dispose: () => void }>> = {};

export function resetRealtimeConnections() {
  for (const scope of Object.keys(wsClients) as WsScope[]) {
    try { wsClients[scope]?.dispose(); } catch {}
    delete wsClients[scope];
    delete wsLinks[scope];
    delete wsLinkLoading[scope];
  }
}

function emitRealtimeStatus(status: RealtimeConnectionStatus, scope: WsScope) {
  window.dispatchEvent(new CustomEvent("bms-realtime-status", { detail: { status, scope } }));
}

if (typeof window !== "undefined") {
  window.addEventListener("backend-logout", resetRealtimeConnections);
  window.addEventListener("frontend-logout", resetRealtimeConnections);
  window.addEventListener("bms-pos-device-token-changed", resetRealtimeConnections);
  window.addEventListener("beforeunload", resetRealtimeConnections);
}

async function loadWsLink(scope: WsScope): Promise<ApolloLink> {
  if (wsLinks[scope]) return wsLinks[scope]!;
  if (wsLinkLoading[scope]) return wsLinkLoading[scope]!;

  wsLinkLoading[scope] = (async () => {
    emitRealtimeStatus(navigator.onLine ? "connecting" : "offline", scope);
    const [{ GraphQLWsLink }, { createClient }] = await Promise.all([
      import("@apollo/client/link/subscriptions"),
      import("graphql-ws"),
    ]);

    const wsClient = createClient({
        url: process.env.NEXT_PUBLIC_GRAPHQL_WS as string,
        lazy: true,
        retryAttempts: Infinity,
        retryWait: async (retries) => {
          const capped = Math.min(30_000, 500 * (2 ** Math.min(retries, 6)));
          const jitter = Math.floor(Math.random() * Math.max(1, capped / 3));
          await new Promise((resolve) => window.setTimeout(resolve, capped + jitter));
        },
        connectionParams: async () => {
          const posToken = scope === "pos" ? window.localStorage.getItem("bms.pos.deviceToken") ?? "" : "";
          const response = await fetch(`/api/bms/realtime/ticket?scope=${scope}`, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              ...(scope === "pos" ? { "x-pos-device-token": posToken } : {}),
            },
          });
          if (!response.ok) throw new Error(`REALTIME_TICKET_${response.status}`);
          const body = await response.json() as { ticket?: unknown };
          if (typeof body.ticket !== "string") throw new Error("REALTIME_TICKET_INVALID");
          return { ticket: body.ticket };
        },
        on: {
          connected: () => {
            emitRealtimeStatus("connected", scope);
            addLog("info", "ws", "[ws] connected", { scope });
          },
          closed: (ev: any) => {
            emitRealtimeStatus(navigator.onLine ? "reconnecting" : "offline", scope);
            addLog("warn", "ws", "[ws] closed", { scope, code: ev?.code, reason: ev?.reason });
          },
          error: (err: any) => {
            emitRealtimeStatus(navigator.onLine ? "degraded" : "offline", scope);
            addLog("error", "ws", "[ws] error", { scope, message: err?.message || String(err) });
          },
        },
      });
    const link = new GraphQLWsLink(wsClient);

    wsClients[scope] = wsClient;
    wsLinks[scope] = link;
    return link;
  })();

  return wsLinkLoading[scope]!;
}

const lazyWsLink = new ApolloLink((operation) => {
  if (typeof window === "undefined") return null;

  return new Observable((observer) => {
    let sub: any;
    const scope: WsScope = window.location.pathname.startsWith("/admin")
      ? "admin"
      : window.location.pathname === "/pos" || window.location.pathname.startsWith("/pos/")
        ? "pos"
        : "web";
    loadWsLink(scope)
      .then((link) => {
        const obs = link.request(operation);
        if (!obs) {
          observer.error(new Error("WS link unavailable"));
          return;
        }
        sub = obs.subscribe({
          next: (v) => observer.next(v),
          error: (e) => observer.error(e),
          complete: () => observer.complete(),
        });
      })
      .catch((e) => observer.error(e));

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  });
});

// ----------------------------
// Split link (แยก path สำหรับ WS / HTTP)
// ----------------------------
const link = split(
  ({ query }) => {
    if (typeof window === "undefined") return false;
    const def = getMainDefinition(query);
    return def.kind === "OperationDefinition" && def.operation === "subscription";
  },
  lazyWsLink,
  from([errorLink, authLink, httpLink]) // ⬅️ ใส่ errorLink หน้า auth/http
);

// ----------------------------
// Apollo Client
// ----------------------------
export const client = new ApolloClient({
  link,
  cache: new InMemoryCache(),
});
