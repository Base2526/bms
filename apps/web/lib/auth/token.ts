import * as jwt from "jsonwebtoken";

export interface JWTPayload {
  id: number;
  email: string;
  role: string;
  tenant_id?: string;
  exp?: number;
  iat?: number;
}

export const USER_COOKIE = "USER_COOKIE";
export const ADMIN_COOKIE = "ADMIN_COOKIE";
export const JWT_SECRET = process.env.JWT_SECRET || "changeme_secret";

export function verifyTokenString(token?: string|null): JWTPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}