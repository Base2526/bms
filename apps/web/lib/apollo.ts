"use client";
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  split,
  from
} from "@apollo/client";

import { setContext } from "@apollo/client/link/context";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
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
  // HTTP network error เช่น 401/403 (กรณีคุณเซ็ตสถานะ)
  // @ts-ignore
  const status = networkError?.statusCode || networkError?.response?.status;
  if (status === 401 || status === 403) {

    addLog('error', 'graphql', status, {});
    backendLogout();
  }
});

// ----------------------------
// WebSocket link (สำหรับ Subscription)
// ----------------------------
const wsLink =
  typeof window !== "undefined"
    ? new GraphQLWsLink(
        createClient({
          url: process.env.NEXT_PUBLIC_GRAPHQL_WS as string, // e.g. "ws://localhost:8081/graphql"
          lazy: true,
          retryAttempts: Infinity,
          connectionParams: () => ({ "x-scope": "web" }),
          on: {
            connected: () => addLog("info", "ws", "[ws] connected", {}),
            closed: (ev: any) => addLog("warn", "ws", "[ws] closed", { code: ev?.code, reason: ev?.reason }),
            error: (err: any) => addLog("error", "ws", "[ws] error", { message: err?.message || String(err) }),
          },
        })
      )
    : null;

// ----------------------------
// Split link (แยก path สำหรับ WS / HTTP)
// ----------------------------
const link = wsLink
  ? split(
      ({ query }) => {
        const def = getMainDefinition(query);
        return def.kind === "OperationDefinition" && def.operation === "subscription";
      },
      wsLink,
      from([errorLink, authLink, httpLink]) // ⬅️ ใส่ errorLink หน้า auth/http
    )
  : from([errorLink, authLink, httpLink]);

// ----------------------------
// Apollo Client
// ----------------------------
export const client = new ApolloClient({
  link,
  cache: new InMemoryCache(),
});
