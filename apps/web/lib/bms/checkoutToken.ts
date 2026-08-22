import { createHmac, timingSafeEqual } from "crypto";

export type CheckoutTokenPayload = {
  v: 1;
  tenantId: string;
  orderId: string;
  exp: number;
};

function tokenSecret(): string {
  const secret =
    process.env.BMS_CHECKOUT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BMS checkout token secret is not configured");
  }
  return secret || "dev-only-bms-checkout-secret";
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", tokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCheckoutToken(input: {
  tenantId: string;
  orderId: string;
  expiresInSeconds?: number;
}): string {
  const expiresIn = Math.min(
    Math.max(input.expiresInSeconds ?? 60 * 60 * 24 * 7, 60),
    60 * 60 * 24 * 30
  );
  const payload: CheckoutTokenPayload = {
    v: 1,
    tenantId: input.tenantId,
    orderId: input.orderId,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  return `${encoded}.${sign(encoded)}`;
}

export function verifyCheckoutToken(
  rawToken: string
): CheckoutTokenPayload | null {
  const token = String(rawToken || "");
  if (!token || token.length > 2048) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<CheckoutTokenPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.tenantId !== "string" ||
      typeof payload.orderId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.tenantId.length > 100 ||
      payload.orderId.length > 100 ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload as CheckoutTokenPayload;
  } catch {
    return null;
  }
}

