// apps/web/app/api/graphql/route.ts
export const runtime = "nodejs";

import { ApolloServer } from "@apollo/server";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { NextRequest } from "next/server";

import {
  mergedTypeDefs as typeDefs,
  mergedResolvers as resolvers,
} from "@/graphql";

import {
  verifyAdminSession,
  verifyUserSession,
  verifyUserFromRequest,
  verifyAdminFromRequest,
} from "@/lib/auth/server";
import { cookies } from "next/headers";
import { verifyActTenant, ACT_TENANT_COOKIE } from "@/lib/auth/token";
import { isAdminSessionActive } from "@/lib/redisSession";
import { refreshAdminIdentity } from "@/lib/auth/adminIdentity";

// 👇 จาก graphql-upload-nextjs
import { uploadProcess } from "graphql-upload-nextjs";
import { metricsPlugin } from "@/graphql/metricsPlugin";

const schema = makeExecutableSchema({ typeDefs, resolvers });

const server = new ApolloServer({
  schema,
  introspection: process.env.NODE_ENV !== "production",
  csrfPrevention: false,
  // latency/error rate ต่อ operation → /admin/system-health (fail-open, ไม่ throw)
  plugins: [metricsPlugin()],
});

function getClientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("true-client-ip") ||
    "unknown"
  );
}

function isAndroidRequest(req: NextRequest) {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  return ua.includes("android") || ua.includes("okhttp");
}

function logIncoming(req: NextRequest, extra?: Record<string, any>) {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") || "";
  const scope = req.headers.get("x-scope") || "";
  const ct = req.headers.get("content-type") || "";
  const ref = req.headers.get("referer") || "";
  const android = isAndroidRequest(req);

  console.log(
    `[GraphQL IN] ${new Date().toISOString()} ${req.method} ${req.nextUrl.pathname}` +
      ` ip=${ip}` +
      ` android=${android}` +
      ` scope=${scope || "-"}` +
      ` ct=${ct || "-"}` +
      ` ref=${ref ? ref.slice(0, 120) : "-"}`
  );

  if (android) console.log("[Android UA]", ua);
  if (extra) console.log("[GraphQL IN extra]", extra);
}

// ✅ createContext: รองรับ web/admin(cookie) + android(bearer)
async function createContext(request: NextRequest) {
  let scope = (request.headers.get("x-scope") || "").trim().toLowerCase();

  // fallback จาก referer
  if (!scope) {
    const ref = request.headers.get("referer") || "";
    if (ref.includes("/admin")) scope = "admin";
  }
  if (!scope) scope = "web";

  let admin: any = null;
  let user: any = null;

  if (scope === "android") {
    // ✅ RN ใช้ Bearer token
    user = verifyUserFromRequest(request);
    admin = null;
  } else if (scope === "admin") {
    // ✅ admin panel ใช้ cookie
    admin = verifyAdminSession();

    // (optional) ถ้าอนาคต admin app ใช้ Bearer ก็เปิดบรรทัดนี้:
    // if (!admin) admin = verifyAdminFromRequest(request);

    // Redis session revocation (lib/redisSession.ts) — the JWT can still be
    // cryptographically valid (not yet `exp`) but the admin logged out, so this
    // is the actual enforcement point for "logout means logged out now".
    // Fail-open: Redis error or a pre-existing token with no `jti` → still trusted.
    if (admin && !(await isAdminSessionActive(admin.jti))) {
      admin = null;
    }

    // Role/tenant/account existence are read fresh. This also rejects a JWT
    // issued before a password/role change via admin_session_version.
    if (admin) {
      admin = await refreshAdminIdentity(admin);
    }

    // drill-down: platform admin กำลัง "เข้าดูมุมร้าน" → override tenant_id
    // เชื่อ token ได้เพราะเซ็นแล้ว + ผูกกับ admin.id (มินต์โดย bmsEnterTenant ที่ตรวจ platform admin แล้ว)
    if (admin) {
      const act = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
      if (act?.actTenantId && String(act.by) === String(admin.id)) {
        admin = { ...admin, tenant_id: act.actTenantId, __actingTenantId: act.actTenantId } as any;
      }
    }

    user = null;
  } else {
    // ✅ web ใช้ cookie
    user = verifyUserSession();
    admin = verifyAdminSession();

    // Some shared/public GraphQL calls intentionally accept an admin cookie
    // under web scope. They must receive the same fresh/revocable identity as
    // explicit admin-scope requests, otherwise x-scope:web bypasses demotion.
    if (admin && !(await isAdminSessionActive(admin.jti))) {
      admin = null;
    }
    if (admin) {
      admin = await refreshAdminIdentity(admin);
    }

    // (optional) ถ้าอยากให้ web รองรับ Bearer ด้วย:
    // if (!user) user = verifyUserFromRequest(request);
  }

  return { scope, admin, user, req: request };
}

const handler = startServerAndCreateNextHandler<NextRequest>(server, {
  context: createContext,
});

const requestHandler = async (request: NextRequest) => {
  const contentType = request.headers.get("content-type") || "";
  logIncoming(request, { multipart: contentType.includes("multipart/form-data") });

  if (contentType.includes("multipart/form-data")) {
    const context = await createContext(request);
    return uploadProcess(request, context, server as any);
  }

  return handler(request);
};

export { requestHandler as POST, requestHandler as GET, requestHandler as OPTIONS };
