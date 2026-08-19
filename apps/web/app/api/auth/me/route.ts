// apps/web/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { verifyUserSession, verifyAdminSession } from "@/lib/auth/server";
import { query } from "@/lib/db";
import type { JWTPayload } from "@/lib/auth/token";
import type { ThemeMode } from "@/lib/theme";
import type { Lang } from "@/i18n";
import { refreshAdminIdentity } from "@/lib/auth/adminIdentity";
import { isAdminSessionActive } from "@/lib/redisSession";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function cleanThemePreference(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function cleanLanguage(value: unknown): Lang {
  return value === "en" ? "en" : "th";
}

async function withUserPreferences<T extends JWTPayload | null>(session: T): Promise<T> {
  if (!session?.id) return session;
  const { rows } = await query<{ theme_preference: string | null; language: string | null }>(
    `SELECT theme_preference, language FROM users WHERE id = $1 LIMIT 1`,
    [session.id]
  );
  return {
    ...session,
    themePreference: cleanThemePreference(rows[0]?.theme_preference),
    language: cleanLanguage(rows[0]?.language),
  } as T;
}

async function handleGET() {
  const user  = verifyUserSession();
  const adminToken = verifyAdminSession();
  const admin = adminToken && await isAdminSessionActive(adminToken.jti)
    ? await refreshAdminIdentity(adminToken)
    : null;
  const [userWithPreferences, adminWithPreferences] = await Promise.all([
    withUserPreferences(user),
    withUserPreferences(admin),
  ]);

  return NextResponse.json({
    isAuthenticated: Boolean(userWithPreferences || adminWithPreferences),
    user: userWithPreferences,
    admin: adminWithPreferences
  }, { headers: { 'Cache-Control': 'no-store' }});
}

export const GET = withRouteErrorLog("GET /api/auth/me", handleGET);
