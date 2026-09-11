import "server-only";

import { query } from "@/lib/db";
import { refreshAdminIdentity } from "@/lib/auth/adminIdentity";
import { jwtSecret, type ActTenantPayload, type JWTPayload } from "@/lib/auth/token";
import { isAdminSessionActiveForRealtime } from "@/lib/redisSession";
import { loadPermissions } from "./permissions";
import { authenticatePosDevice } from "./pos";
import {
  REALTIME_TICKET_AUDIENCE,
  REALTIME_TICKET_VERSION,
  signRealtimeTicket,
  type RealtimeTicketClaims,
  type RealtimeTicketScope,
} from "../../../../packages/realtime/src/wsTicket";

const DEFAULT_TICKET_TTL_SECONDS = 60;

function ticketTtlSeconds(): number {
  const raw = process.env.WS_TICKET_TTL_SECONDS;
  if (!raw) return DEFAULT_TICKET_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 15 || parsed > 300) {
    throw new Error("WS_TICKET_TTL_SECONDS must be an integer between 15 and 300");
  }
  return parsed;
}

async function adminLocationScope(tenantId: string, adminId: string): Promise<{
  allLocations: boolean;
  locationIds: string[];
}> {
  const { rows } = await query<{ location_id: string }>(
    `SELECT location_id
       FROM bms_user_allowed_locations
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY location_id`,
    [tenantId, adminId],
  );
  if (rows.length > 0) return { allLocations: false, locationIds: rows.map((row) => row.location_id) };
  const all = await query<{ id: string }>(
    "SELECT id FROM bms_locations WHERE tenant_id = $1 ORDER BY id",
    [tenantId],
  );
  return { allLocations: true, locationIds: all.rows.map((row) => row.id) };
}

function baseClaims(input: {
  scope: RealtimeTicketScope;
  subjectId: string;
  tenantId?: string;
  actingTenantId?: string;
  permissions?: string[];
  allLocations?: boolean;
  locationIds?: string[];
  sessionId?: string;
  sessionVersion?: number;
}): RealtimeTicketClaims {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    version: REALTIME_TICKET_VERSION,
    audience: REALTIME_TICKET_AUDIENCE,
    ticketId: globalThis.crypto.randomUUID(),
    scope: input.scope,
    subjectId: input.subjectId,
    tenantId: input.tenantId,
    actingTenantId: input.actingTenantId,
    permissions: input.permissions ?? [],
    allLocations: input.allLocations ?? false,
    locationIds: input.locationIds ?? [],
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    issuedAt,
    expiresAt: issuedAt + ticketTtlSeconds(),
  };
}

export async function mintAdminRealtimeTicket(
  session: JWTPayload | null,
  acting: ActTenantPayload | null,
): Promise<{ ticket: string; expiresAt: number } | null> {
  if (!session?.id || !session.jti) return null;
  if (!(await isAdminSessionActiveForRealtime(session.jti, session.id))) return null;

  const fresh = await refreshAdminIdentity(session);
  if (!fresh?.id) return null;
  const actingTenantId = acting?.actTenantId && String(acting.by) === String(fresh.id)
    ? acting.actTenantId
    : undefined;
  const tenantId = actingTenantId ?? fresh.tenant_id;

  // Platform-only pages may connect for user notifications. Tenant RBAC is deliberately empty
  // until the user enters a real tenant context.
  let permissions: string[] = [];
  let locationScope = { allLocations: false, locationIds: [] as string[] };
  if (tenantId) {
    const active = await query<{ active: boolean }>(
      "SELECT active FROM bms_tenants WHERE id = $1 LIMIT 1",
      [tenantId],
    );
    if (active.rows[0]?.active !== true) return null;
    const ctx = { scope: "admin", admin: { ...fresh, tenant_id: tenantId } };
    permissions = [...await loadPermissions(ctx)];
    locationScope = await adminLocationScope(tenantId, String(fresh.id));
  }

  const claims = baseClaims({
    scope: "admin",
    subjectId: String(fresh.id),
    tenantId,
    actingTenantId,
    permissions,
    ...locationScope,
    sessionId: fresh.jti,
    sessionVersion: Number(fresh.session_version ?? 0),
  });
  return { ticket: await signRealtimeTicket(claims, jwtSecret()), expiresAt: claims.expiresAt };
}

export async function mintUserRealtimeTicket(
  scope: "web" | "android",
  session: JWTPayload | null,
): Promise<{ ticket: string; expiresAt: number } | null> {
  if (!session?.id) return null;
  const claims = baseClaims({
    scope,
    subjectId: String(session.id),
    tenantId: session.tenant_id,
  });
  if (session.exp) claims.expiresAt = Math.min(claims.expiresAt, session.exp);
  if (claims.expiresAt <= claims.issuedAt) return null;
  return { ticket: await signRealtimeTicket(claims, jwtSecret()), expiresAt: claims.expiresAt };
}

export async function mintPosRealtimeTicket(
  deviceToken: string,
): Promise<{ ticket: string; expiresAt: number } | null> {
  const device = await authenticatePosDevice(deviceToken);
  if (!device?.active) return null;
  const claims = baseClaims({
    scope: "pos",
    subjectId: device.id,
    tenantId: device.tenantId,
    permissions: [
      "order.view",
      "payment.view",
      "product.view",
      "purchase.view",
      "shipping.view",
      "inventory.transfer",
      "inventory.count",
      "restaurant.floor.manage",
      "pos.shift.report",
    ],
    allLocations: false,
    locationIds: [device.locationId],
  });
  return { ticket: await signRealtimeTicket(claims, jwtSecret()), expiresAt: claims.expiresAt };
}
