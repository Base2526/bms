import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireRestaurantQrSession } from "./restaurantQrOrdering";
import { RestaurantCheckError } from "./restaurantPosErrors";

export const RESTAURANT_SERVICE_CALL_CODES = [
  "WATER", "CUTLERY", "BILL", "MENU_HELP", "OTHER",
] as const;
export type RestaurantServiceCallCode = typeof RESTAURANT_SERVICE_CALL_CODES[number];

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeRequest(codeInput: string, noteInput?: string | null) {
  const code = codeInput.trim().toUpperCase() as RestaurantServiceCallCode;
  if (!RESTAURANT_SERVICE_CALL_CODES.includes(code)) {
    throw new RestaurantCheckError("ประเภทคำขอไม่ถูกต้อง");
  }
  const note = String(noteInput ?? "").trim();
  if (note.length > 200 || (code === "OTHER" && note.length < 3)) {
    throw new RestaurantCheckError("กรุณาระบุสิ่งที่ต้องการอย่างน้อย 3 ตัวอักษร และไม่เกิน 200 ตัวอักษร");
  }
  return { code, note: code === "OTHER" ? note : null };
}

export async function createRestaurantServiceCall(input: {
  sessionToken?: string | null;
  publicToken: string;
  idempotencyKey: string;
  requestCode: string;
  requestNote?: string | null;
}) {
  const session = await requireRestaurantQrSession(input.sessionToken, input.publicToken);
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    throw new RestaurantCheckError("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  const request = normalizeRequest(input.requestCode, input.requestNote);
  const client = await getClient();
  try {
    await beginTenantTx(client, session.tenantId);
    const valid = await client.query(
      `SELECT 1
         FROM bms_restaurant_qr_sessions qr_session
         JOIN bms_restaurant_checks check_row
           ON check_row.tenant_id = qr_session.tenant_id AND check_row.id = qr_session.check_id
          AND check_row.location_id = qr_session.location_id AND check_row.table_id = qr_session.table_id
        WHERE qr_session.tenant_id = $1 AND qr_session.id = $2 AND qr_session.check_id = $3
          AND qr_session.revoked_at IS NULL AND qr_session.expires_at > now()
          AND check_row.status = 'OPEN'
        FOR UPDATE OF qr_session, check_row`,
      [session.tenantId, session.sessionId, session.checkId]
    );
    if (!valid.rowCount) throw new RestaurantCheckError("บิลโต๊ะปิดแล้ว กรุณาสแกน QR ใหม่");

    const replay = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM bms_restaurant_service_calls
        WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3`,
      [session.tenantId, session.sessionId, idempotencyKey]
    );
    if (replay.rowCount) {
      await client.query("COMMIT");
      return { callId: replay.rows[0].id, status: replay.rows[0].status, replayed: true };
    }

    const pending = await client.query(
      `SELECT 1 FROM bms_restaurant_service_calls
        WHERE tenant_id = $1 AND check_id = $2 AND status = 'PENDING' FOR UPDATE`,
      [session.tenantId, session.checkId]
    );
    if (pending.rowCount) {
      throw new RestaurantCheckError("โต๊ะนี้เรียกพนักงานแล้ว กรุณารอพนักงานรับทราบ");
    }

    const created = await client.query<{ id: string }>(
      `INSERT INTO bms_restaurant_service_calls
         (tenant_id, location_id, table_id, check_id, session_id,
          request_code, request_note, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, session_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [session.tenantId, session.locationId, session.tableId, session.checkId, session.sessionId,
        request.code, request.note, idempotencyKey]
    );
    if (!created.rowCount) {
      const concurrent = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM bms_restaurant_service_calls
          WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3`,
        [session.tenantId, session.sessionId, idempotencyKey]
      );
      if (!concurrent.rowCount) throw new RestaurantCheckError("ส่งคำขอไม่สำเร็จ กรุณาลองใหม่");
      await client.query("COMMIT");
      return { callId: concurrent.rows[0].id, status: concurrent.rows[0].status, replayed: true };
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.service_call.create',$3,$4::jsonb)`,
      [session.tenantId, `qr-session:${session.sessionId}`, created.rows[0].id,
        JSON.stringify({ locationId: session.locationId, requestCode: request.code })]
    );
    await client.query("COMMIT");
    return { callId: created.rows[0].id, status: "PENDING" as const, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new RestaurantCheckError("โต๊ะนี้เรียกพนักงานแล้ว กรุณารอพนักงานรับทราบ");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getRestaurantServiceCallsForGuest(
  sessionToken: string | null | undefined,
  publicToken: string
) {
  const session = await requireRestaurantQrSession(sessionToken, publicToken);
  const result = await query<any>(
    `SELECT id, request_code, request_note, status, created_at, acknowledged_at, completed_at
       FROM bms_restaurant_service_calls
      WHERE tenant_id = $1 AND check_id = $2
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 20`,
    [session.tenantId, session.checkId]
  );
  return { calls: result.rows.map((row: any) => ({
    id: row.id,
    requestCode: row.request_code,
    requestNote: row.request_note,
    status: row.status,
    createdAt: iso(row.created_at),
    acknowledgedAt: row.acknowledged_at ? iso(row.acknowledged_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  })) };
}

export async function listRestaurantServiceCalls(tenantId: string, locationId: string) {
  const result = await query<any>(
    `SELECT service_call.id, service_call.request_code, service_call.request_note,
            service_call.status, service_call.created_at, service_call.acknowledged_at,
            service_call.completed_at, table_row.id AS table_id,
            table_row.code AS table_code, table_row.name AS table_name
       FROM bms_restaurant_service_calls service_call
       JOIN bms_restaurant_checks check_row
         ON check_row.tenant_id = service_call.tenant_id AND check_row.id = service_call.check_id
        AND check_row.location_id = service_call.location_id
       JOIN bms_restaurant_tables table_row
         ON table_row.tenant_id = check_row.tenant_id AND table_row.id = check_row.table_id
        AND table_row.location_id = check_row.location_id
      WHERE service_call.tenant_id = $1 AND service_call.location_id = $2
        AND service_call.status IN ('PENDING', 'ACKNOWLEDGED')
      ORDER BY (service_call.status = 'PENDING') DESC, service_call.created_at ASC
      LIMIT 100`,
    [tenantId, locationId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    requestCode: row.request_code,
    requestNote: row.request_note,
    status: row.status,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableName: row.table_name,
    createdAt: iso(row.created_at),
    acknowledgedAt: row.acknowledged_at ? iso(row.acknowledged_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  }));
}

export async function updateRestaurantServiceCall(input: {
  tenantId: string;
  locationId: string;
  callId: string;
  actorUserId: string;
  action: "acknowledge" | "complete";
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const nextStatus = input.action === "acknowledge" ? "ACKNOWLEDGED" : "COMPLETED";
    const currentStatus = input.action === "acknowledge" ? "PENDING" : "ACKNOWLEDGED";
    const updated = await client.query(
      `UPDATE bms_restaurant_service_calls
          SET status = $5,
              acknowledged_by = CASE WHEN $5 = 'ACKNOWLEDGED' THEN $4 ELSE acknowledged_by END,
              acknowledged_at = CASE WHEN $5 = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
              completed_by = CASE WHEN $5 = 'COMPLETED' THEN $4 ELSE completed_by END,
              completed_at = CASE WHEN $5 = 'COMPLETED' THEN now() ELSE completed_at END,
              updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND status = $6
        RETURNING id`,
      [input.tenantId, input.locationId, input.callId, input.actorUserId, nextStatus, currentStatus]
    );
    if (!updated.rowCount) throw new RestaurantCheckError("คำขอนี้ถูกรับหรือปิดงานไปแล้ว กรุณาโหลดใหม่");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, `restaurant.service_call.${input.action}`,
        input.callId, JSON.stringify({ locationId: input.locationId })]
    );
    await client.query("COMMIT");
    return { id: input.callId, status: nextStatus };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
