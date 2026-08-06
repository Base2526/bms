import * as jwt from "jsonwebtoken";

export interface JWTPayload {
  id: number;
  email: string;
  role: string;
  tenant_id?: string;
  themePreference?: "system" | "light" | "dark";
  // Redis session id (lib/redisSession.ts) — lets logout/revocation work despite
  // the JWT itself being stateless. Optional: tokens minted before this shipped
  // (or the non-admin `login`/`registerUser` flows below) don't have one.
  jti?: string;
  exp?: number;
  iat?: number;
}

export const USER_COOKIE = "USER_COOKIE";
export const ADMIN_COOKIE = "ADMIN_COOKIE";
export const ACT_TENANT_COOKIE = "BMS_ACT_TENANT"; // platform admin impersonating a shop
export const JWT_SECRET = process.env.JWT_SECRET || "changeme_secret";

export function verifyTokenString(token?: string|null): JWTPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

// ===== acting-tenant (drill-down) token =====
// signed + ผูกกับ admin.id เพื่อกันนำ token ไปใช้ข้ามคน · มินต์โดย bmsEnterTenant
// (ตรวจ platform admin แล้ว) → context จึงเชื่อค่านี้ได้เพราะเซ็นด้วย JWT_SECRET
export interface ActTenantPayload { actTenantId: string; by: string | number; exp?: number; iat?: number; }

export function signActTenant(actTenantId: string, by: string | number): string {
  return jwt.sign({ actTenantId, by }, JWT_SECRET, { expiresIn: "12h" });
}

export function verifyActTenant(token?: string | null): ActTenantPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as ActTenantPayload;
  } catch {
    return null;
  }
}
