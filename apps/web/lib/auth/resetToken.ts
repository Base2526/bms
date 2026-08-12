import crypto from "crypto";

export const RESET_TOKEN_TTL_MIN = 15;

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildPasswordResetUrl(
  token: string,
  configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim(),
  nodeEnv = process.env.NODE_ENV
): string {
  if (!configuredBaseUrl && nodeEnv === "production") {
    throw new Error("NEXT_PUBLIC_BASE_URL is required for password reset emails");
  }
  let url: URL;
  try {
    url = new URL("/reset", configuredBaseUrl || "http://localhost:3000");
  } catch {
    throw new Error("NEXT_PUBLIC_BASE_URL must be a valid HTTP(S) URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("NEXT_PUBLIC_BASE_URL must use HTTP(S)");
  url.searchParams.set("token", token);
  return url.toString();
}
