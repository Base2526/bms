// apps/ws/src/ws.ts
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { GraphQLError } from "graphql/error";
import { parse, type ExecutionArgs } from "graphql";
import { parse as parseCookie } from "cookie";
import jwt from "jsonwebtoken";

import { typeDefs, resolvers } from "./shared.js";

const schema = makeExecutableSchema({ typeDefs, resolvers });

const PORT = Number(process.env.WS_PORT || 8080);
const PATH = process.env.WS_PATH || "/graphql";

// ✅ cookie name ที่เว็บใช้
const USER_COOKIE = process.env.USER_COOKIE || "USER_COOKIE";
// ถ้ามี admin cookie ก็เพิ่มได้
const ADMIN_COOKIE = process.env.ADMIN_COOKIE || "ADMIN_COOKIE";
const ACT_TENANT_COOKIE = process.env.ACT_TENANT_COOKIE || "BMS_ACT_TENANT";

// ws ตรวจ token ใบเดียวกับ web — ถ้า fallback ไปคีย์ในซอร์ส ใครก็ subscribe
// สตรีมของร้านไหนก็ได้ · ล้มตอนบูตที่นี่ได้ เพราะเป็น service ไม่ใช่ build step
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET is not configured — refusing to verify sockets with the built-in dev key"
      );
    }
    return "changeme_secret";
  }
  return secret;
}

function toLowerKeys(obj: any) {
  const out: Record<string, any> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) out[k.toLowerCase()] = (obj as any)[k];
  return out;
}

function readBearer(raw: any) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || s).trim();
}

function getScope(ctx: any): "web" | "admin" | "android" {
  const cp = toLowerKeys(ctx?.connectionParams);
  const fromCP = String(cp["x-scope"] || cp["scope"] || "").trim().toLowerCase();

  if (fromCP === "android" || fromCP === "web" || fromCP === "admin") return fromCP as any;

  // fallback จาก referer / user-agent
  const req = ctx?.extra?.request;
  const ref = String(req?.headers?.referer || "");
  if (ref.includes("/admin")) return "admin";

  const ua = String(req?.headers?.["user-agent"] || "").toLowerCase();
  if (ua.includes("android") || ua.includes("okhttp")) return "android";

  return "web";
}

function getTokenFromAndroid(ctx: any) {
  const cp = toLowerKeys(ctx?.connectionParams);
  // ✅ RN จะส่ง connectionParams.Authorization
  return (
    readBearer(cp["authorization"]) ||
    readBearer(cp["auth"]) ||
    readBearer(cp["token"]) ||
    ""
  );
}

function getTokenFromCookies(ctx: any, cookieName: string) {
  const req = ctx?.extra?.request;
  const cookieHeader = req?.headers?.cookie || "";
  const cookies = parseCookie(String(cookieHeader || ""));
  return String(cookies?.[cookieName] || "").trim();
}

function applyActingTenant(ctx: any, user: any) {
  if (!user || getScope(ctx) !== "admin") return user;
  const token = getTokenFromCookies(ctx, ACT_TENANT_COOKIE);
  if (!token) return user;
  try {
    const act = jwt.verify(token, jwtSecret()) as { actTenantId?: string; by?: string | number };
    if (act?.actTenantId && String(act.by) === String(user.id ?? user.sub)) {
      return { ...user, tenant_id: act.actTenantId, __actingTenantId: act.actTenantId };
    }
  } catch {
    // Ignore an invalid/expired acting-tenant cookie, matching HTTP behavior.
  }
  return user;
}

function unauthError(reason: string) {
  return [
    new GraphQLError("UNAUTHENTICATED", {
      extensions: {
        code: "UNAUTHENTICATED",
        message: "Token expired or missing.",
        reason,
      },
    }),
  ];
}

const wss = new WebSocketServer({
  // host: "0.0.0.0",
  port: PORT,
  path: PATH,
});

useServer(
  {
    schema,

    connectionInitWaitTimeout: 10000,

    onSubscribe: async (ctx, msg) => {
      // ===== logging เบื้องต้น =====
      const scope = getScope(ctx);
      const req = ctx.extra.request; // IncomingMessage
      const cookieHeader = req?.headers?.cookie || "";
      const cp = ctx.connectionParams || {};

      console.log("[WS] onSubscribe scope=", scope);
      // อย่า log token เต็มๆ ใน production (อันนี้ไว้ debug)
      // console.log("[WS] connectionParams =", cp);

      // ===== 1) ดึง token ตาม scope =====
      let token = "";

      if (scope === "android") {
        // ✅ RN ใช้ connectionParams.Authorization
        token = getTokenFromAndroid(ctx);

        // fallback: เผื่อบาง client ส่งเป็น header authorization (น้อยมาก)
        if (!token) {
          token = readBearer(req?.headers?.authorization);
        }
      } else if (scope === "admin") {
        // admin จะใช้ cookie หรือ bearer ก็ได้
        token = readBearer((toLowerKeys(cp)["authorization"] ?? "") as any) || getTokenFromCookies(ctx, ADMIN_COOKIE);
      } else {
        // web
        // ให้ bearer มาก่อน แล้วค่อย cookie
        token = readBearer((toLowerKeys(cp)["authorization"] ?? "") as any) || getTokenFromCookies(ctx, USER_COOKIE);
      }

      if (!token) {
        console.log("[WS] no token (scope=", scope, ")");
        return unauthError(scope === "android" ? "android_missing_bearer" : "missing_cookie_or_bearer");
      }

      // ===== 2) verify jwt =====
      let user: any = null;
      try {
        user = jwt.verify(token, jwtSecret());
        user = applyActingTenant(ctx, user);
      } catch (err) {
        console.error("[WS] invalid token", err);
        return unauthError("invalid_or_expired_token");
      }

      if (!user) {
        return unauthError("no_user_after_verify");
      }

      // ===== 3) คืน ExecutionArgs =====
      const execArgs: ExecutionArgs = {
        schema,
        document: parse(String((msg as any).payload.query)),
        variableValues: ((msg as any).payload as any).variables,
        operationName: ((msg as any).payload as any).operationName,
        // ✅ contextValue จะถูกส่งไป resolver/subscription
        contextValue: {
          scope,
          user,
          // คุณจะส่งค่าอื่นเพิ่มได้ เช่น req, connectionParams ฯลฯ
        },
      };

      return execArgs;
    },
  },
  wss
);

console.log(`[WS] graphql-ws running at ws://0.0.0.0:${PORT}${PATH}`);
