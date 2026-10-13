import { randomUUID } from "crypto";
import { readCustomerToken, signCustomerToken } from "./customerSecurityToken";

const TTL_SECONDS = 30 * 24 * 60 * 60;
const REF_PATTERN = /^web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class InvalidWebChatSession extends Error {
  constructor() { super("Invalid or expired chat session. Start a new session without sessionId."); }
}

/** The returned sessionId is an opaque bearer credential, never a CRM identity. */
export function resolveWebChatSession(tenantId: string, input: unknown) {
  if (input != null && (typeof input !== "string" || input.length > 4096)) throw new InvalidWebChatSession();
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.startsWith("web-chat-v1.")) {
    const payload = readCustomerToken("web-chat-v1", raw);
    if (!payload || payload.tenantId !== tenantId || typeof payload.customerRef !== "string" ||
        !REF_PATTERN.test(payload.customerRef)) throw new InvalidWebChatSession();
    return { customerRef: payload.customerRef, sessionId: raw, sessionReset: false };
  }
  // Unsigned legacy IDs have no ownership proof. Never adopt one or issue a
  // credential for its history. Old clients can persist this response as usual.
  const customerRef = `web-${randomUUID()}`;
  const sessionId = signCustomerToken("web-chat-v1", {
    tenantId, customerRef, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  });
  return { customerRef, sessionId, sessionReset: Boolean(raw) };
}
