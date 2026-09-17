import { createHash, randomBytes } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export const BOARD_GAME_SERVICE_CALL_CODES = [
  "GAME_HELP",
  "GAME_ISSUE",
  "FOOD_DRINK",
  "BILL",
  "EXTEND_TIME",
  "CLEANUP",
  "OTHER",
] as const;
export type BoardGameServiceCallCode =
  (typeof BOARD_GAME_SERVICE_CALL_CODES)[number];

export class BoardGameGuestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardGameGuestError";
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function token() {
  return randomBytes(32).toString("base64url");
}
function iso(value: Date | string | null) {
  return value == null
    ? null
    : value instanceof Date
    ? value.toISOString()
    : String(value);
}
function publicToken(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized))
    throw new BoardGameGuestError("ลิงก์เรียกพนักงานไม่ถูกต้องหรือหมดอายุแล้ว");
  return normalized;
}
function request(inputCode: unknown, inputNote: unknown) {
  const code = String(inputCode ?? "")
    .trim()
    .toUpperCase() as BoardGameServiceCallCode;
  if (!BOARD_GAME_SERVICE_CALL_CODES.includes(code))
    throw new BoardGameGuestError("ประเภทคำขอไม่ถูกต้อง");
  const note = String(inputNote ?? "").trim();
  if (
    note.length > 200 ||
    (note.length > 0 && note.length < 3) ||
    (code === "OTHER" && note.length < 3)
  ) {
    throw new BoardGameGuestError(
      "กรุณาระบุสิ่งที่ต้องการอย่างน้อย 3 ตัวอักษร และไม่เกิน 200 ตัวอักษร"
    );
  }
  return { code, note: note || null };
}

export async function issueBoardGameGuestAccess(input: {
  tenantId: string;
  locationId: string;
  sessionId: string;
  actorUserId: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, {
      editorId: input.actorUserId,
    });
    const session = await client.query<{
      table_code: string;
      table_name: string;
    }>(
      `SELECT table_row.code AS table_code, table_row.name AS table_name
         FROM bms_board_game_sessions session
         JOIN bms_board_game_seatings seating
           ON seating.tenant_id = session.tenant_id AND seating.id = session.seating_id
         JOIN bms_board_game_tables table_row
           ON table_row.tenant_id = seating.tenant_id AND table_row.id = seating.table_id
        WHERE session.tenant_id = $1 AND session.location_id = $2 AND session.id = $3
          AND session.status = 'OPEN' AND seating.status = 'ACTIVE'
        FOR UPDATE OF session`,
      [input.tenantId, input.locationId, input.sessionId]
    );
    if (!session.rowCount)
      throw new Error("เปิดลิงก์เรียกพนักงานได้เฉพาะโต๊ะที่กำลังเล่นอยู่");
    const existing = await client.query<{ public_token: string }>(
      `SELECT public_token FROM bms_board_game_guest_tokens
        WHERE tenant_id = $1 AND session_id = $2 AND active FOR UPDATE`,
      [input.tenantId, input.sessionId]
    );
    let value = existing.rows[0]?.public_token;
    if (!value) {
      value = token();
      await client.query(
        `INSERT INTO bms_board_game_guest_tokens
           (tenant_id, location_id, session_id, public_token, public_token_hash, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.tenantId,
          input.locationId,
          input.sessionId,
          value,
          sha256(value),
          input.actorUserId,
        ]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'board_game.guest_access.issue',$3,$4::jsonb)`,
        [
          input.tenantId,
          `user:${input.actorUserId}`,
          input.sessionId,
          JSON.stringify({ locationId: input.locationId }),
        ]
      );
    }
    await client.query("COMMIT");
    return {
      token: value,
      tableCode: session.rows[0].table_code,
      tableName: session.rows[0].table_name,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getBoardGameGuestContext(value: string) {
  const result = await query<any>(
    `SELECT guest.id AS guest_token_id, guest.tenant_id, guest.location_id, guest.session_id,
            session.status AS session_status, table_row.id AS table_id,
            table_row.code AS table_code, table_row.name AS table_name,
            tenant.name AS store_name, location.name AS location_name,
            session.billing_mode
       FROM bms_board_game_guest_tokens guest
       JOIN bms_board_game_sessions session
         ON session.tenant_id = guest.tenant_id AND session.id = guest.session_id
       JOIN bms_board_game_seatings seating
         ON seating.tenant_id = session.tenant_id AND seating.id = session.seating_id
       JOIN bms_board_game_tables table_row
         ON table_row.tenant_id = seating.tenant_id AND table_row.id = seating.table_id
       JOIN bms_tenants tenant ON tenant.id = guest.tenant_id
       JOIN bms_locations location
         ON location.tenant_id = guest.tenant_id AND location.id = guest.location_id
      WHERE guest.public_token_hash = $1 AND guest.active
        AND session.status = 'OPEN' AND seating.status = 'ACTIVE'`,
    [sha256(publicToken(value))]
  );
  const row = result.rows[0];
  if (!row)
    throw new BoardGameGuestError(
      "โต๊ะปิดแล้วหรือลิงก์เรียกพนักงานหมดอายุ กรุณาติดต่อพนักงาน"
    );
  return {
    guestTokenId: row.guest_token_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    sessionId: row.session_id,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableName: row.table_name,
    storeName: row.store_name,
    locationName: row.location_name,
    billingMode: row.billing_mode,
  };
}

export async function createBoardGameServiceCall(input: {
  publicToken: string;
  idempotencyKey: string;
  requestCode: string;
  requestNote?: string | null;
}) {
  const context = await getBoardGameGuestContext(input.publicToken);
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 120)
    throw new BoardGameGuestError("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  const normalized = request(input.requestCode, input.requestNote);
  const client = await getClient();
  try {
    await beginTenantTx(client, context.tenantId);
    const stillOpen = await client.query<{ table_id: string }>(
      `SELECT table_row.id AS table_id
         FROM bms_board_game_sessions session
         JOIN bms_board_game_seatings seating
           ON seating.tenant_id = session.tenant_id AND seating.id = session.seating_id
         JOIN bms_board_game_tables table_row
           ON table_row.tenant_id = seating.tenant_id AND table_row.id = seating.table_id
        WHERE session.tenant_id = $1 AND session.location_id = $2 AND session.id = $3
          AND session.status = 'OPEN' AND seating.status = 'ACTIVE'
        FOR UPDATE OF session`,
      [context.tenantId, context.locationId, context.sessionId]
    );
    if (!stillOpen.rowCount) {
      throw new BoardGameGuestError("โต๊ะปิดแล้ว กรุณาติดต่อพนักงาน");
    }
    const replay = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM bms_board_game_service_calls
        WHERE tenant_id = $1 AND guest_token_id = $2 AND idempotency_key = $3`,
      [context.tenantId, context.guestTokenId, key]
    );
    if (replay.rowCount) {
      await client.query("COMMIT");
      return {
        callId: replay.rows[0].id,
        status: replay.rows[0].status,
        replayed: true,
      };
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_service_calls
         (tenant_id, location_id, session_id, guest_token_id, table_id_at_request,
          request_code, request_note, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        context.tenantId,
        context.locationId,
        context.sessionId,
        context.guestTokenId,
        stillOpen.rows[0].table_id,
        normalized.code,
        normalized.note,
        key,
      ]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'board_game.service_call.create',$3,$4::jsonb)`,
      [
        context.tenantId,
        `guest-token:${context.guestTokenId}`,
        created.rows[0].id,
        JSON.stringify({
          locationId: context.locationId,
          requestCode: normalized.code,
        }),
      ]
    );
    await client.query("COMMIT");
    return { callId: created.rows[0].id, status: "PENDING", replayed: false };
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    if (error?.code === "23505")
      throw new BoardGameGuestError(
        "โต๊ะนี้มีคำขอที่พนักงานกำลังดูแลอยู่ กรุณารอให้ดำเนินการเสร็จ"
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function listBoardGameGuestCalls(value: string) {
  const context = await getBoardGameGuestContext(value);
  const result = await query<any>(
    `SELECT id, request_code, request_note, status, created_at, acknowledged_at, completed_at
       FROM bms_board_game_service_calls
      WHERE tenant_id = $1 AND session_id = $2 AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 20`,
    [context.tenantId, context.sessionId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    requestCode: row.request_code,
    requestNote: row.request_note,
    status: row.status,
    createdAt: iso(row.created_at),
    acknowledgedAt: iso(row.acknowledged_at),
    completedAt: iso(row.completed_at),
  }));
}

export async function listBoardGameServiceCalls(
  tenantId: string,
  locationId: string
) {
  const result = await query<any>(
    `SELECT call.id, call.session_id, call.request_code, call.request_note, call.status,
            call.created_at, call.acknowledged_at, call.completed_at,
            current_table.id AS table_id, current_table.code AS table_code, current_table.name AS table_name
       FROM bms_board_game_service_calls call
       JOIN bms_board_game_sessions session
         ON session.tenant_id = call.tenant_id AND session.id = call.session_id
       JOIN bms_board_game_seatings seating
         ON seating.tenant_id = session.tenant_id AND seating.id = session.seating_id
       JOIN bms_board_game_tables current_table
         ON current_table.tenant_id = seating.tenant_id AND current_table.id = seating.table_id
      WHERE call.tenant_id = $1 AND call.location_id = $2
        AND call.status IN ('PENDING', 'ACKNOWLEDGED')
      ORDER BY (call.status = 'PENDING') DESC, call.created_at ASC LIMIT 100`,
    [tenantId, locationId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableName: row.table_name,
    requestCode: row.request_code,
    requestNote: row.request_note,
    status: row.status,
    createdAt: iso(row.created_at),
    acknowledgedAt: iso(row.acknowledged_at),
    completedAt: iso(row.completed_at),
  }));
}

export async function updateBoardGameServiceCall(input: {
  tenantId: string;
  locationId: string;
  callId: string;
  actorUserId: string;
  action: "acknowledge" | "complete";
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, {
      editorId: input.actorUserId,
    });
    const next = input.action === "acknowledge" ? "ACKNOWLEDGED" : "COMPLETED";
    const current = input.action === "acknowledge" ? "PENDING" : "ACKNOWLEDGED";
    const result = await client.query(
      `UPDATE bms_board_game_service_calls
          SET status = $5,
              acknowledged_by = CASE WHEN $5 = 'ACKNOWLEDGED' THEN $4 ELSE acknowledged_by END,
              acknowledged_at = CASE WHEN $5 = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
              completed_by = CASE WHEN $5 = 'COMPLETED' THEN $4 ELSE completed_by END,
              completed_at = CASE WHEN $5 = 'COMPLETED' THEN now() ELSE completed_at END,
              updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND status = $6 RETURNING id`,
      [
        input.tenantId,
        input.locationId,
        input.callId,
        input.actorUserId,
        next,
        current,
      ]
    );
    if (!result.rowCount)
      throw new Error("คำขอนี้ถูกรับหรือปิดงานไปแล้ว กรุณาโหลดใหม่");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        input.tenantId,
        `user:${input.actorUserId}`,
        `board_game.service_call.${input.action}`,
        input.callId,
        JSON.stringify({ locationId: input.locationId }),
      ]
    );
    await client.query("COMMIT");
    return { id: input.callId, status: next };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}
