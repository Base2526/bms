import * as jwt from "jsonwebtoken";

export interface JWTPayload {
  id: string | number;
  email: string;
  role: string;
  tenant_id?: string;
  is_platform_admin?: boolean;
  /** Invalidates tokens issued before a role/password change. */
  session_version?: number;
  themePreference?: "system" | "light" | "dark";
  // Redis session id (lib/redisSession.ts) — lets logout/revocation work despite
  // the JWT itself being stateless. Optional: tokens minted before this shipped
  // (or the non-admin `login`/`registerUser` flows below) don't have one.
  jti?: string;
  // Not signed into the JWT — re-read fresh from Postgres on every /api/auth/me call (see
  // withUserPreferences there) so a language change on one device/session shows up on others
  // without waiting for token expiry, same reasoning as themePreference above.
  language?: "th" | "en";
  exp?: number;
  iat?: number;
}

export const USER_COOKIE = "USER_COOKIE";
export const ADMIN_COOKIE = "ADMIN_COOKIE";
export const ACT_TENANT_COOKIE = "BMS_ACT_TENANT"; // platform admin impersonating a shop
/**
 * ความลับที่ใช้เซ็น/ตรวจ session ทั้งระบบ
 *
 * เดิมเป็น `process.env.JWT_SECRET || "changeme_secret"` — instance ที่ลืมตั้ง env
 * จึงเซ็น session ด้วยค่าคงที่ที่อยู่ในซอร์สโค้ดสาธารณะ ใครก็ปั้น token แอดมินของ
 * ร้านไหนก็ได้เอง (ยืนยันแล้วว่า container dev รันแบบนี้อยู่จริง 2026-08-26)
 *
 * เป็นฟังก์ชัน ไม่ใช่ const ที่ throw ตอน import โดยตั้งใจ: โมดูลนี้ถูก import
 * ตอน `next build` ด้วย ถ้า throw ที่ระดับโมดูลจะ build ไม่ผ่านในเครื่องที่ยังไม่มี
 * runtime env — ต้องล้มตอน "มีคนใช้จริง" ไม่ใช่ตอนคอมไพล์
 *
 * pattern เดียวกับ tokenSecret() ใน lib/bms/checkoutToken.ts
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET is not configured — refusing to sign or verify sessions with the built-in dev key"
      );
    }
    return "changeme_secret";
  }
  return secret;
}

export function verifyTokenString(token?: string|null): JWTPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret()) as JWTPayload;
  } catch {
    return null;
  }
}

// ===== acting-tenant (drill-down) token =====
// signed + ผูกกับ admin.id เพื่อกันนำ token ไปใช้ข้ามคน · มินต์โดย bmsEnterTenant
// (ตรวจ platform admin แล้ว) → context จึงเชื่อค่านี้ได้เพราะเซ็นด้วย JWT_SECRET
export interface ActTenantPayload { actTenantId: string; by: string | number; exp?: number; iat?: number; }

export function signActTenant(actTenantId: string, by: string | number): string {
  return jwt.sign({ actTenantId, by }, jwtSecret(), { expiresIn: "12h" });
}

export function verifyActTenant(token?: string | null): ActTenantPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret()) as ActTenantPayload;
  } catch {
    return null;
  }
}
