// lib/auth/server.ts
import "server-only";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import {
  verifyTokenString,
  USER_COOKIE,
  ADMIN_COOKIE,
  type JWTPayload,
} from "./token";

// ===== Cookie-based (Web/Admin) =====
export function verifyUserSession(): JWTPayload | null {
  const token = cookies().get(USER_COOKIE)?.value;
  const payload = verifyTokenString(token);
  if (!payload?.role) return null;
  return payload;
}

export function verifyAdminSession(): JWTPayload | null {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  const payload = verifyTokenString(token);
  if (!payload?.role) return null;
  return payload;
}

// ===== Header-based (Android / API Clients) =====
function readBearerToken(req: NextRequest) {
  const raw = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

export function verifyUserFromRequest(req: NextRequest): JWTPayload | null {
  const token = readBearerToken(req);
  const payload = verifyTokenString(token);
  if (!payload?.role) return null;
  return payload;
}

export function verifyAdminFromRequest(req: NextRequest): JWTPayload | null {
  const token = readBearerToken(req);
  const payload = verifyTokenString(token);
  if (!payload?.role) return null;
  return payload;
}