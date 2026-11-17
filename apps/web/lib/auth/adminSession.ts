import { randomUUID } from "crypto";
import * as jwt from "jsonwebtoken";
import { cookies } from "next/headers";

import { createAdminSession } from "@/lib/redisSession";
import { recordSecurityEvent } from "@/lib/bms/securityEvents";
import { ADMIN_COOKIE, jwtSecret } from "@/lib/auth/token";

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookie = process.env.COOKIE_SECURE === "true";

export type AdminSessionUser = {
  id: string | number;
  email: string;
  role: string;
  tenant_id?: string | null;
  is_platform_admin?: boolean | null;
  admin_session_version?: number | string | null;
};

export async function issueAdminSession(
  user: AdminSessionUser,
  source: "ADMIN_PASSWORD" | "ADMIN_SOCIAL" | "SHOP_SIGNUP" = "ADMIN_PASSWORD"
): Promise<string> {
  const sessionMaxAgeSec = user.role === "Administrator" ? 60 * 60 * 24 : 60 * 60 * 24 * 7;
  const jti = randomUUID();

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      is_platform_admin: user.is_platform_admin === true,
      session_version: Number(user.admin_session_version ?? 0),
      jti,
    },
    jwtSecret(),
    { expiresIn: sessionMaxAgeSec }
  );

  // Login is not successful until its durable security event exists.
  await recordSecurityEvent({
    tenantId: user.tenant_id ?? null,
    actorUserId: String(user.id),
    event: "auth.login",
    outcome: "SUCCESS",
    source,
    sessionId: jti,
  });
  await createAdminSession(jti, user.id, sessionMaxAgeSec);
  cookies().set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookie && !isDev,
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSec,
  });

  return token;
}
