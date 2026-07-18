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
  window.location.href = "/login";
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
type WsScope = "web" | "admin";
const wsLinks: Partial<Record<WsScope, ApolloLink>> = {};
const wsLinkLoading: Partial<Record<WsScope, Promise<ApolloLink>>> = {};

async function loadWsLink(scope: WsScope): Promise<ApolloLink> {
  if (wsLinks[scope]) return wsLinks[scope]!;
  if (wsLinkLoading[scope]) return wsLinkLoading[scope]!;

  wsLinkLoading[scope] = (async () => {
    const [{ GraphQLWsLink }, { createClient }] = await Promise.all([
      import("@apollo/client/link/subscriptions"),
      import("graphql-ws"),
    ]);

    const link = new GraphQLWsLink(
      createClient({
        url: process.env.NEXT_PUBLIC_GRAPHQL_WS as string,
        lazy: true,
        retryAttempts: Infinity,
        connectionParams: () => ({ "x-scope": scope }),
        on: {
          connected: () => addLog("info", "ws", "[ws] connected", { scope }),
          closed: (ev: any) => addLog("warn", "ws", "[ws] closed", { scope, code: ev?.code, reason: ev?.reason }),
          error: (err: any) => addLog("error", "ws", "[ws] error", { scope, message: err?.message || String(err) }),
        },
      })
    );

    wsLinks[scope] = link;
    return link;
  })();

  return wsLinkLoading[scope]!;
}

const lazyWsLink = new ApolloLink((operation) => {
  if (typeof window === "undefined") return null;

  return new Observable((observer) => {
    let sub: any;
    const scope: WsScope = window.location.pathname.startsWith("/admin") ? "admin" : "web";
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
