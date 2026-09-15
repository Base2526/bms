export const REALTIME_TICKET_AUDIENCE = "bms-ws" as const;
export const REALTIME_TICKET_VERSION = 1 as const;

export type RealtimeTicketScope = "admin" | "web" | "android" | "pos";

export type RealtimeTicketClaims = {
  version: typeof REALTIME_TICKET_VERSION;
  audience: typeof REALTIME_TICKET_AUDIENCE;
  ticketId: string;
  scope: RealtimeTicketScope;
  subjectId: string;
  tenantId?: string;
  actingTenantId?: string;
  permissions: string[];
  allLocations: boolean;
  locationIds: string[];
  sessionId?: string;
  sessionVersion?: number;
  issuedAt: number;
  expiresAt: number;
};

// Match PostgreSQL uuid semantics. Existing tenant/device/location rows may
// predate RFC-versioned generators but are still authoritative UUID values.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PERMISSION = /^[a-z][a-z0-9_.]{1,99}$/;
const CLAIM_KEYS = new Set([
  "version", "audience", "ticketId", "scope", "subjectId", "tenantId", "actingTenantId",
  "permissions", "allLocations", "locationIds", "sessionId", "sessionVersion", "issuedAt",
  "expiresAt",
]);

export class RealtimeTicketError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RealtimeTicketError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: unknown, field: string, uuid = false): asserts value is string {
  if (typeof value !== "string" || !(uuid ? UUID : SAFE_ID).test(value)) {
    throw new RealtimeTicketError(`INVALID_${field.toUpperCase()}`);
  }
}

function requireUniqueStrings(
  value: unknown,
  field: string,
  pattern: RegExp,
  maximum: number,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) =>
    typeof item !== "string" || !pattern.test(item)
  ) || new Set(value).size !== value.length) {
    throw new RealtimeTicketError(`INVALID_${field.toUpperCase()}`);
  }
}

export function validateRealtimeTicketClaims(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): RealtimeTicketClaims {
  if (!isRecord(value)) throw new RealtimeTicketError("INVALID_CLAIMS");
  for (const key of Object.keys(value)) {
    if (!CLAIM_KEYS.has(key)) throw new RealtimeTicketError("UNKNOWN_CLAIM");
  }
  if (value.version !== REALTIME_TICKET_VERSION || value.audience !== REALTIME_TICKET_AUDIENCE) {
    throw new RealtimeTicketError("INVALID_AUDIENCE");
  }
  if (!(["admin", "web", "android", "pos"] as unknown[]).includes(value.scope)) {
    throw new RealtimeTicketError("INVALID_SCOPE");
  }
  requireId(value.ticketId, "ticket_id", true);
  requireId(value.subjectId, "subject_id");
  if (value.tenantId !== undefined) requireId(value.tenantId, "tenant_id", true);
  if (value.actingTenantId !== undefined) requireId(value.actingTenantId, "acting_tenant_id", true);
  if (value.actingTenantId !== undefined && value.actingTenantId !== value.tenantId) {
    throw new RealtimeTicketError("ACTING_TENANT_MISMATCH");
  }
  requireUniqueStrings(value.permissions, "permissions", PERMISSION, 256);
  requireUniqueStrings(value.locationIds, "location_ids", UUID, 256);
  if (typeof value.allLocations !== "boolean") throw new RealtimeTicketError("INVALID_LOCATION_SCOPE");
  if (value.sessionId !== undefined) requireId(value.sessionId, "session_id");
  if (value.scope === "admin" && !value.sessionId) throw new RealtimeTicketError("SESSION_REQUIRED");
  if (value.scope === "pos") {
    requireId(value.subjectId, "subject_id", true);
    if (!value.tenantId || value.allLocations || value.locationIds.length !== 1) {
      throw new RealtimeTicketError("POS_SCOPE_REQUIRED");
    }
  }
  if (value.sessionVersion !== undefined &&
      (!Number.isSafeInteger(value.sessionVersion) || Number(value.sessionVersion) < 0)) {
    throw new RealtimeTicketError("INVALID_SESSION_VERSION");
  }
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) {
    throw new RealtimeTicketError("INVALID_LIFETIME");
  }
  if (Number(value.expiresAt) <= nowSeconds) throw new RealtimeTicketError("TICKET_EXPIRED");
  if (Number(value.issuedAt) > nowSeconds + 30) throw new RealtimeTicketError("TICKET_FROM_FUTURE");
  if (Number(value.expiresAt) - Number(value.issuedAt) > 300) {
    throw new RealtimeTicketError("TICKET_LIFETIME_TOO_LONG");
  }
  if (value.scope === "admin" && !value.tenantId && value.permissions.length > 0) {
    // A platform-only socket may receive its own user notifications, but cannot carry tenant RBAC.
    throw new RealtimeTicketError("TENANT_REQUIRED_FOR_PERMISSIONS");
  }
  return value as unknown as RealtimeTicketClaims;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RealtimeTicketError("MALFORMED_TICKET");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new RealtimeTicketError("MALFORMED_TICKET");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 12) throw new RealtimeTicketError("TICKET_SECRET_TOO_SHORT");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signRealtimeTicket(
  claims: RealtimeTicketClaims,
  secret: string,
): Promise<string> {
  const valid = validateRealtimeTicketClaims(claims);
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(valid)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyRealtimeTicket(
  ticket: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RealtimeTicketClaims> {
  if (typeof ticket !== "string" || ticket.length > 16_384) {
    throw new RealtimeTicketError("MALFORMED_TICKET");
  }
  const parts = ticket.split(".");
  if (parts.length !== 2) throw new RealtimeTicketError("MALFORMED_TICKET");
  const [payload, signature] = parts;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    base64UrlDecode(signature).buffer as ArrayBuffer,
    new TextEncoder().encode(payload),
  );
  if (!ok) throw new RealtimeTicketError("INVALID_TICKET_SIGNATURE");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    throw new RealtimeTicketError("MALFORMED_TICKET");
  }
  return validateRealtimeTicketClaims(decoded, nowSeconds);
}
