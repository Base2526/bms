import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";

/** Run before parsing bodies or reading orders; never put bearer links in Redis keys/logs. */
export async function requireCheckoutRateLimit(
  req: NextRequest,
  scope: "read" | "delivery" | "payment",
  token?: string
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = token === undefined ? ip : token;
  const digest = createHash("sha256").update(identity).digest("hex");
  const limits = { read: 120, delivery: 30, payment: 10 } as const;
  const limited = await rateLimit(
    `checkout:${scope}:${token === undefined ? "ip" : "token"}:${digest}`,
    limits[scope],
    60_000
  );
  if (limited.ok) return null;
  return NextResponse.json(
    { error: "มีคำขอเข้ามาเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่" },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(limited.retryAfter) },
    }
  );
}
