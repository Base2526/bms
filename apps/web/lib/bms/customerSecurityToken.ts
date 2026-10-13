import { createHmac, timingSafeEqual } from "crypto";

// Resolve at call time so builds never need runtime credentials. Purposes are
// signed too: a web-chat credential can never authorize a staff merge.
function secret(): string {
  const value = process.env.BMS_CHECKOUT_SECRET ||
    process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("Customer token secret is not configured");
  return "dev-only-bms-customer-token-secret";
}

function signature(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function signCustomerToken(purpose: "web-chat-v1" | "customer-merge-v1", payload: Record<string, unknown>): string {
  const value = `${purpose}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${value}.${signature(value)}`;
}

export function readCustomerToken(purpose: "web-chat-v1" | "customer-merge-v1", token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [kind, body, mac, extra] = token.split(".");
  if (kind !== purpose || !body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(signature(`${kind}.${body}`));
  const received = Buffer.from(mac);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!value || !Number.isSafeInteger(value.exp) || value.exp <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch { return null; }
}
