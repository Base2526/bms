// apps/web/app/api/graphql/route.ts
export const runtime = "nodejs";

import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { NextRequest, NextResponse } from "next/server";

import { buildBmsGraphqlSchema } from "@/graphql/schema";

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
import { authenticatePosDevice } from "@/lib/bms/pos";
import { query } from "@/lib/db";

// 👇 จาก graphql-upload-nextjs
import { uploadProcess } from "graphql-upload-nextjs";
import { metricsPlugin } from "@/graphql/metricsPlugin";
import { ensureBmsGraphqlErrorCode } from "@/graphql/mobileErrorContract";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { graphqlRequestLimitsRule } from "@/graphql/requestLimits";

const schema = buildBmsGraphqlSchema();

const server = new ApolloServer({
  schema,
  introspection: process.env.NODE_ENV !== "production",
  csrfPrevention: true,
  validationRules: [graphqlRequestLimitsRule],
  formatError: ensureBmsGraphqlErrorCode,
  // latency/error rate ต่อ operation → /admin/system-health (fail-open, ไม่ throw)
  plugins: [metricsPlugin()],
});

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
  let posDevice: Awaited<ReturnType<typeof authenticatePosDevice>> = null;

  if (scope === "pos") {
    // A register is a device principal, never a user principal. Native POS clients use
    // Authorization: Bearer while the existing browser can keep x-pos-device-token during
    // migration. Neither header is allowed to choose tenant/location; authenticatePosDevice()
    // derives both from the active hashed device row.
    const authorization = request.headers.get("authorization") ?? "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const token = bearer || request.headers.get("x-pos-device-token")?.trim() || "";
    posDevice = token ? await authenticatePosDevice(token) : null;
  } else if (scope === "android") {
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
    // ลายเซ็นพิสูจน์ว่า cookie ไม่ถูกปลอม แต่ tenant อาจถูกลบหลัง cookie ถูกมินต์
    // (เช่นหน้า fake-data ลบร้าน scenario ที่กำลัง drill-down อยู่) และสิทธิ์ platform
    // admin อาจถูกถอดภายหลัง จึงต้องยืนยันทั้งสองอย่างสดก่อนใช้เป็น authority.
    if (admin) {
      const cookieStore = cookies();
      const actingCookie = cookieStore.get(ACT_TENANT_COOKIE)?.value;
      const act = verifyActTenant(actingCookie);
      const boundToCurrentPlatformAdmin =
        admin.is_platform_admin === true &&
        !!act?.actTenantId &&
        String(act.by) === String(admin.id);

      if (boundToCurrentPlatformAdmin) {
        const tenant = await query<{ id: string }>(
          `SELECT id FROM bms_tenants WHERE id = $1 LIMIT 1`,
          [act!.actTenantId]
        );
        if (tenant.rows[0]) {
          admin = { ...admin, tenant_id: act!.actTenantId, __actingTenantId: act!.actTenantId } as any;
        } else {
          cookieStore.delete(ACT_TENANT_COOKIE);
        }
      } else if (actingCookie) {
        cookieStore.delete(ACT_TENANT_COOKIE);
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

  return { scope, admin, user, posDevice, req: request };
}

const handler = startServerAndCreateNextHandler<NextRequest>(server, {
  context: createContext,
});

const MAX_GRAPHQL_JSON_BYTES = 1024 * 1024;
const MAX_GRAPHQL_MULTIPART_BYTES = 64 * 1024 * 1024;
const MAX_GRAPHQL_FILE_BYTES = 25 * 1024 * 1024;

const SAFE_GRAPHQL_UPLOAD_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "image/bmp", "image/tiff", "image/heic", "image/heif",
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/wav", "audio/mp4", "audio/aac",
  // MediaRecorder commonly labels audio containers as video before the
  // resolver normalizes them to their audio MIME.
  "video/webm", "video/mp4",
];

function requestLength(request: NextRequest): number | null {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isSameOriginBrowserRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // native/server clients do not send Origin
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const requestHost = (forwardedHost || request.headers.get("host") || request.nextUrl.host)
      .toLowerCase();
    return originHost === requestHost;
  } catch {
    return false;
  }
}

const requestHandler = async (request: NextRequest) => {
  const contentType = request.headers.get("content-type") || "";
  const length = requestLength(request);

  if (request.method === "POST" && !isSameOriginBrowserRequest(request)) {
    return NextResponse.json({ errors: [{ message: "Cross-origin request denied" }] }, { status: 403 });
  }

  if (contentType.includes("multipart/form-data")) {
    if (length !== null && length > MAX_GRAPHQL_MULTIPART_BYTES) {
      return NextResponse.json({ errors: [{ message: "Upload request is too large" }] }, { status: 413 });
    }
    const context = await createContext(request);
    return uploadProcess(request, context, server as any, {
      allowedTypes: SAFE_GRAPHQL_UPLOAD_TYPES,
      maxFileSize: MAX_GRAPHQL_FILE_BYTES,
    });
  }

  if (length !== null && length > MAX_GRAPHQL_JSON_BYTES) {
    return NextResponse.json({ errors: [{ message: "GraphQL request is too large" }] }, { status: 413 });
  }

  return handler(request);
};

// error ที่เกิด "ใน" resolver ถูก metricsPlugin log ให้แล้ว — ตัวครอบนี้รับของที่
// พังก่อนถึง Apollo (createContext: Redis/JWT/DB ล่ม) กับ multipart upload ซึ่ง
// เดิมหลุดออกไปเป็น 500 body ว่างโดยไม่มี log
const loggedHandler = withRouteErrorLog("/api/graphql", requestHandler);

export { loggedHandler as POST, loggedHandler as GET, loggedHandler as OPTIONS };
