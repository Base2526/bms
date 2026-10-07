import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { composeEmergencyReply, pharmacyEmergencyKind } from "./pharmacy/emergency";

export type EmergencyFacility = {
  id: string; locationId: string | null; name: string; emergencyPhone: string;
  address: string | null; mapUrl: string | null; has24hEmergency: boolean;
  distanceKm: number | null; sortOrder: number; active: boolean;
};
export type EmergencyFacilityInput = Omit<EmergencyFacility, "id" | "active"> & { id?: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class EmergencyFacilityError extends Error {}

function mapRow(r: any): EmergencyFacility {
  return { id: r.id, locationId: r.location_id, name: r.name, emergencyPhone: r.emergency_phone,
    address: r.address, mapUrl: r.map_url, has24hEmergency: r.has_24h_emergency,
    distanceKm: r.distance_km == null ? null : Number(r.distance_km), sortOrder: r.sort_order, active: r.active };
}
function validate(input: EmergencyFacilityInput): EmergencyFacilityInput {
  const v = { ...input, name: String(input.name ?? "").trim(), emergencyPhone: String(input.emergencyPhone ?? "").trim(),
    locationId: input.locationId || null, address: input.address?.trim() || null, mapUrl: input.mapUrl?.trim() || null,
    distanceKm: input.distanceKm ?? null, sortOrder: input.sortOrder ?? 0, has24hEmergency: input.has24hEmergency ?? false };
  if (v.id && !UUID.test(v.id) || v.locationId && !UUID.test(v.locationId)) throw new EmergencyFacilityError("Invalid id");
  if (!v.name || v.name.length > 120 || /[\u0000-\u001f\u007f]/.test(v.name)) throw new EmergencyFacilityError("Invalid name");
  if (!/^[+\d-]{1,30}$/.test(v.emergencyPhone) || !/\d/.test(v.emergencyPhone)) throw new EmergencyFacilityError("Invalid emergency phone");
  if (v.address && v.address.length > 500) throw new EmergencyFacilityError("Address too long");
  if (v.mapUrl) {
    try { if (new URL(v.mapUrl).protocol !== "https:" || /\s/.test(v.mapUrl) || v.mapUrl.length > 2048) throw new Error(); }
    catch { throw new EmergencyFacilityError("Map URL must use HTTPS"); }
  }
  if (typeof v.has24hEmergency !== "boolean" || !Number.isInteger(v.sortOrder) || Math.abs(v.sortOrder) > 2147483647 ||
    v.distanceKm !== null && (!Number.isFinite(v.distanceKm) || v.distanceKm < 0 || v.distanceKm >= 10000)) throw new EmergencyFacilityError("Invalid distance or sort order");
  return v;
}

/** Check both the old and new branch when moving a row. Scoped staff cannot edit all-branch rows. */
async function assertScope(client: PoolClient, tenantId: string, actorId: string, locationId: string | null) {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2)
       OR EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3))
       AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$3)) AS allowed`,
    [tenantId, actorId, locationId]);
  if (!result.rows[0]?.allowed) throw new EmergencyFacilityError("Branch access denied");
}

async function readFacilities(tenantId: string, locationId?: string | null, replyOnly = false, actorId?: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    // Also cancel the SQL on the server: a response race alone would leave slow queries occupying the pool.
    if (replyOnly) await client.query("SET LOCAL statement_timeout = '400ms'");
    const res = await client.query(
      `SELECT f.* FROM bms_emergency_facilities f
        WHERE f.tenant_id=$1 AND f.active
          AND ($2::uuid IS NULL OR f.location_id IS NULL OR f.location_id=$2)
          AND (NOT $3::boolean OR f.has_24h_emergency)
          AND ($4::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$4)
            OR f.location_id IN (SELECT location_id FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$4))
          ${replyOnly && !locationId ? "AND f.location_id IS NULL" : ""}
        ORDER BY f.sort_order, f.distance_km NULLS LAST, f.name, f.id LIMIT $5`,
      [tenantId, locationId ?? null, replyOnly, actorId ?? null, replyOnly ? 3 : 100]);
    await client.query("COMMIT");
    return res.rows.map(mapRow);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function listEmergencyFacilities(tenantId: string, locationId?: string | null, actorId?: string): Promise<EmergencyFacility[]> {
  return readFacilities(tenantId, locationId, false, actorId);
}

/** Includes pool acquisition, transaction and result mapping; late errors are always handled. */
export async function listEmergencyFacilitiesForReply(tenantId: string, locationId?: string | null): Promise<EmergencyFacility[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const safeRead = readFacilities(tenantId, locationId, true).catch((error: unknown) => {
      console.error("[BMS] emergency facilities unavailable", (error as { code?: string })?.code ?? "UNKNOWN");
      return [];
    });
    return await Promise.race([safeRead, new Promise<EmergencyFacility[]>((resolve) => {
      timer = setTimeout(() => resolve([]), 500);
    })]);
  } catch (error) {
    console.error("[BMS] emergency facilities unavailable", (error as { code?: string })?.code ?? "UNKNOWN");
    return [];
  } finally { if (timer) clearTimeout(timer); }
}

export async function emergencyCustomerReply(tenantId: string, message: string): Promise<string> {
  return composeEmergencyReply({ kind: pharmacyEmergencyKind(message) ?? "MEDICAL",
    english: Boolean(message) && !/[ก-๙]/.test(message), facilities: await listEmergencyFacilitiesForReply(tenantId) });
}

export async function upsertEmergencyFacility(tenantId: string, actorId: string, input: EmergencyFacilityInput): Promise<EmergencyFacility> {
  const v = validate(input);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    if (v.id) {
      const old = await client.query("SELECT location_id FROM bms_emergency_facilities WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, v.id]);
      if (!old.rows[0]) throw new EmergencyFacilityError("Facility not found");
      await assertScope(client, tenantId, actorId, old.rows[0].location_id);
    }
    await assertScope(client, tenantId, actorId, v.locationId);
    const args = [tenantId, v.locationId, v.name, v.emergencyPhone, v.address, v.mapUrl, v.has24hEmergency, v.distanceKm, v.sortOrder, actorId];
    const res = v.id ? await client.query(
      `UPDATE bms_emergency_facilities SET location_id=$2, name=$3, emergency_phone=$4, address=$5, map_url=$6,
       has_24h_emergency=$7, distance_km=$8, sort_order=$9, updated_by=$10, updated_at=now()
       WHERE tenant_id=$1 AND id=$11 RETURNING *`, [...args, v.id]) : await client.query(
      `INSERT INTO bms_emergency_facilities (tenant_id,location_id,name,emergency_phone,address,map_url,
       has_24h_emergency,distance_km,sort_order,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`, args);
    const saved = mapRow(res.rows[0]);
    await client.query("INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta) VALUES ($1,$2,'emergency_facility.saved',$3,$4)",
      [tenantId, actorId, saved.id, JSON.stringify({ locationId: saved.locationId, has24hEmergency: saved.has24hEmergency })]);
    await client.query("COMMIT");
    return saved;
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

export async function deactivateEmergencyFacility(tenantId: string, actorId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) throw new EmergencyFacilityError("Invalid id");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const old = await client.query("SELECT location_id FROM bms_emergency_facilities WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
    if (!old.rows[0]) throw new EmergencyFacilityError("Facility not found");
    await assertScope(client, tenantId, actorId, old.rows[0].location_id);
    await client.query("UPDATE bms_emergency_facilities SET active=false,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, id, actorId]);
    await client.query("INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta) VALUES ($1,$2,'emergency_facility.deactivated',$3,'{}')", [tenantId, actorId, id]);
    await client.query("COMMIT");
    return true;
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}
