import crypto from "crypto";
import { GraphQLError } from "graphql/error";

import { rateLimit } from "@/lib/bms/rateLimit";

function requestIp(ctx: any): string {
  const headers = ctx?.req?.headers;
  const getHeader = (name: string) =>
    typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
  return String(
    getHeader("cf-connecting-ip") ||
    getHeader("x-real-ip") ||
    String(getHeader("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  ).slice(0, 80);
}

export async function enforceAuthRateLimit(
  ctx: any,
  action: string,
  identity: string,
  identityLimit: number,
  ipLimit: number,
  windowMs: number,
): Promise<void> {
  const ip = requestIp(ctx);
  const identityHash = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
  const [byIp, byIdentity] = await Promise.all([
    rateLimit(`auth:${action}:ip:${ip}`, ipLimit, windowMs),
    rateLimit(`auth:${action}:identity:${identityHash}`, identityLimit, windowMs),
  ]);
  if (!byIp.ok || !byIdentity.ok) {
    throw new GraphQLError("Too many attempts. Please try again later.", {
      extensions: { code: "RATE_LIMITED", http: { status: 429 } },
    });
  }
}
