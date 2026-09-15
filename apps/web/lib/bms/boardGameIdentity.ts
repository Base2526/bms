// =============================================================
// บัตรที่ร้านถือไว้ระหว่างที่กล่องเกมอยู่กับลูกค้า (`9.93`)
// -------------------------------------------------------------
// ร้านบอร์ดเกมยื่นกล่องละสองพันให้คนที่เพิ่งเดินเข้ามา แล้วขอบัตรไว้จนกว่าเกมจะกลับมา ·
// ก่อนไฟล์นี้ บัตรใบนั้นเป็นกระดาษในลิ้นชัก: ตอบไม่ได้ว่าเป็นของใคร ตอบไม่ได้ว่าคืนไปหรือยัง
// และเลขบัตรถูกจดไว้เปล่า ๆ
//
// สามกฎที่ทั้งไฟล์นี้มีอยู่เพื่อรักษา:
//
// 1. **คืนบัตร = ล้างข้อมูลส่วนบุคคลทันทีในทรานแซกชันเดียวกัน** เลขบัตรมีไว้ตอบคำถามเดียวคือ
//    "ใครถือของร้านออกไป" · บัตรกลับถึงมือเจ้าของแล้วคำถามนั้นหมดไป การเก็บเลขต่อจึงเป็น
//    ความรับผิดล้วน ๆ ไม่มีประโยชน์เหลือ · ใบที่ยัง `HELD` **ตั้งใจเก็บเลขไว้** เพราะนั่นคือ
//    เหตุการณ์ที่ยังไม่จบ ซึ่งเป็นเหตุผลที่จดเลขไว้ตั้งแต่แรก
// 2. **การอ่านเลขกลับออกมาเป็นการกระทำคนละอย่างกับการรับบัตร** — `board_game.identity.reveal`
//    (seed ให้ Manager เท่านั้น) และลง audit ทุกครั้งที่อ่าน · คนหน้าเคาน์เตอร์รับบัตรได้ด้วย
//    สิทธิ์จัดการโต๊ะที่เขามีอยู่แล้ว แต่การเปิดดูเลขไม่ใช่งานประจำของเขา
// 3. **เลขไม่เคยออกไปฝั่ง client นอกจากทาง reveal** · สี่ตัวท้าย (`documentNumberTail`) ออกไปได้
//    เพราะไม่งั้นการหาบัตรใบที่ถูกในลิ้นชักจะต้องถอดรหัสทุกครั้ง แล้ว reveal ที่เกิดวันละสี่สิบครั้ง
//    ก็เลิกเป็นการกระทำที่พิเศษ (บทเรียนเดียวกับ `9.25`: `file_id` ห้ามหลุดออกไป)
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { requireBoardGameCafeTenant } from "./boardGameCafe";
import { decryptSecret, encryptSecret } from "./crypto";
import { IDEMPOTENCY_CONFLICT_MESSAGE, IdempotencyConflictError } from "./idempotencyErrors";
import { beginTenantTx } from "./tenant";
import { createHash } from "crypto";

export const BOARD_GAME_IDENTITY_KINDS = [
  "NATIONAL_ID",
  "PASSPORT",
  "STUDENT_ID",
  "DRIVER_LICENSE",
  "OTHER",
] as const;
export type BoardGameIdentityKind = (typeof BOARD_GAME_IDENTITY_KINDS)[number];

/** รูปที่ client เห็น — **ไม่มีเลขเต็มโดยตั้งใจ** มีแต่สี่ตัวท้ายไว้จับคู่กับบัตรในลิ้นชัก */
export type BoardGameIdentityHold = {
  id: string;
  sessionId: string;
  loanId: string | null;
  customerId: string | null;
  documentKind: BoardGameIdentityKind;
  holderName: string | null;
  documentNumberTail: string | null;
  /** true = บันทึกเลขไว้ตอนรับบัตร (ยังไม่ถูกล้าง) — จอใช้บอกว่ามีอะไรให้ reveal ไหม */
  hasDocumentNumber: boolean;
  status: "HELD" | "RETURNED";
  note: string | null;
  takenAt: string;
  takenByName: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  purgedAt: string | null;
};

const MAX_NUMBER_LENGTH = 40;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uuid(value: unknown, label: string): string {
  const normalized = text(value).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return normalized;
}

function optionalUuid(value: unknown, label: string): string | null {
  return text(value) ? uuid(value, label) : null;
}

function identityKind(value: unknown): BoardGameIdentityKind {
  const normalized = text(value).toUpperCase() as BoardGameIdentityKind;
  if (!BOARD_GAME_IDENTITY_KINDS.includes(normalized)) throw new Error("ชนิดเอกสารไม่ถูกต้อง");
  return normalized;
}

/**
 * เลขบัตรที่คนหน้าเคาน์เตอร์พิมพ์มีขีดและเว้นวรรคปนเสมอ · ตัดทิ้งก่อนเก็บ ไม่งั้นบัตรใบเดียวกัน
 * ที่พิมพ์คนละครั้งจะได้สี่ตัวท้ายคนละชุด แล้วคนหาบัตรในลิ้นชักไม่เจอ
 */
export function normalizeIdentityNumber(value: unknown): string | null {
  const raw = text(value).replace(/[\s-]+/g, "").toUpperCase();
  if (!raw) return null;
  if (raw.length > MAX_NUMBER_LENGTH) throw new Error("เลขเอกสารยาวเกินไป");
  if (!/^[A-Z0-9]+$/.test(raw)) throw new Error("เลขเอกสารไม่ถูกต้อง");
  return raw;
}

export function identityNumberTail(normalized: string | null): string | null {
  return normalized ? normalized.slice(-4) : null;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requestKey(value: unknown): string {
  const key = text(value);
  if (key.length < 8 || key.length > 200) throw new Error("idempotencyKey ไม่ถูกต้อง");
  return key;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoRequired(value: Date | string | null | undefined, label: string): string {
  const formatted = iso(value);
  if (!formatted) throw new Error(`ไม่พบค่าของ ${label}`);
  return formatted;
}

const SELECT_COLUMNS = `h.id, h.session_id, h.loan_id, h.customer_id, h.document_kind,
        h.holder_name, h.document_number_tail,
        (h.document_number_encrypted IS NOT NULL) AS has_number,
        h.status, h.note, h.taken_at, h.returned_at, h.purged_at,
        taker.name AS taken_by_name, returner.name AS returned_by_name`;

const SELECT_FROM = `FROM bms_board_game_identity_holds h
       LEFT JOIN users taker ON taker.id = h.taken_by AND taker.tenant_id = h.tenant_id
       LEFT JOIN users returner ON returner.id = h.returned_by AND returner.tenant_id = h.tenant_id`;

function mapRow(row: any): BoardGameIdentityHold {
  return {
    id: row.id,
    sessionId: row.session_id,
    loanId: row.loan_id ?? null,
    customerId: row.customer_id ?? null,
    documentKind: row.document_kind,
    holderName: row.holder_name ?? null,
    documentNumberTail: row.document_number_tail ?? null,
    hasDocumentNumber: Boolean(row.has_number),
    status: row.status,
    note: row.note ?? null,
    // pg คืน TIMESTAMPTZ เป็น Date — GraphQL/JSON ต้องได้ ISO ไม่ใช่ epoch (กับดักข้อ 1 ของรีโป)
    takenAt: isoRequired(row.taken_at, "เวลารับบัตร"),
    takenByName: row.taken_by_name ?? null,
    returnedAt: iso(row.returned_at),
    returnedByName: row.returned_by_name ?? null,
    purgedAt: iso(row.purged_at),
  };
}

export async function listBoardGameIdentityHolds(
  tenantId: string,
  filter: { sessionId?: string | null; locationId?: string | null; openOnly?: boolean } = {}
): Promise<BoardGameIdentityHold[]> {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const sessionId = optionalUuid(filter.sessionId, "sessionId");
  const locationId = optionalUuid(filter.locationId, "locationId");
  const result = await query(
    `SELECT ${SELECT_COLUMNS}
       ${SELECT_FROM}
      WHERE h.tenant_id = $1
        AND ($2::uuid IS NULL OR h.session_id = $2::uuid)
        AND ($3::uuid IS NULL OR h.location_id = $3::uuid)
        AND ($4::boolean IS NOT TRUE OR h.status = 'HELD')
      ORDER BY h.taken_at DESC, h.id`,
    [tenantId, sessionId, locationId, filter.openOnly === true]
  );
  return result.rows.map(mapRow);
}

/** ด่านสาขาของ route — id ที่ผู้เรียกส่งมาต้องเป็นของสาขาที่เขาดูแลจริง */
export async function locationOfBoardGameIdentityHold(
  tenantId: string,
  holdId: string
): Promise<string | null> {
  const result = await query<{ location_id: string }>(
    `SELECT location_id FROM bms_board_game_identity_holds WHERE tenant_id = $1 AND id = $2`,
    [tenantId, uuid(holdId, "holdId")]
  );
  return result.rows[0]?.location_id ?? null;
}

async function auditInTx(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null | undefined,
  action: string,
  target: string | null,
  meta: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, actorUserId ? `user:${actorUserId}` : "system", action, target, JSON.stringify(meta)]
  );
}

async function readHoldInTx(
  client: PoolClient,
  tenantId: string,
  holdId: string
): Promise<BoardGameIdentityHold> {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS} ${SELECT_FROM} WHERE h.tenant_id = $1 AND h.id = $2`,
    [tenantId, holdId]
  );
  if (!result.rowCount) throw new Error("ไม่พบบัตรที่รับไว้");
  return mapRow(result.rows[0]);
}

export type TakeIdentityHoldInput = {
  sessionId: string;
  idempotencyKey: string;
  documentKind: unknown;
  holderName: unknown;
  documentNumber?: unknown;
  loanId?: unknown;
  customerId?: unknown;
  note?: unknown;
};

/**
 * รับบัตรไว้ · เลขถูกเข้ารหัสด้วย `encryptSecret()` ก่อนแตะฐานเสมอ
 *
 * เลขเป็นของที่ **ไม่บังคับ**: ร้านที่เก็บบัตรจริงไว้ในลิ้นชักโดยไม่พิมพ์เลขก็ยังได้ประโยชน์จาก
 * แถวนี้ (ตอบได้ว่าถือบัตรของใครอยู่ และด่านปิดบิลยังทำงาน) การบังคับพิมพ์เลขจะทำให้ร้านที่
 * ไม่อยากเก็บเลขเลิกใช้ฟีเจอร์นี้ แล้วกลับไปใช้กระดาษซึ่งแย่กว่าทุกทาง
 */
export async function takeBoardGameIdentityHold(
  tenantId: string,
  input: TakeIdentityHoldInput,
  actorUserId?: string | null
): Promise<BoardGameIdentityHold & { replayed: boolean }> {
  const sessionId = uuid(input.sessionId, "sessionId");
  const key = requestKey(input.idempotencyKey);
  const documentKind = identityKind(input.documentKind);
  const holderName = text(input.holderName);
  if (!holderName || holderName.length > 120) throw new Error("ต้องระบุชื่อบนบัตร");
  const loanId = optionalUuid(input.loanId, "loanId");
  const customerId = optionalUuid(input.customerId, "customerId");
  const note = text(input.note) ? text(input.note).slice(0, 500) : null;
  const documentNumber = normalizeIdentityNumber(input.documentNumber);
  const hash = requestHash({ sessionId, documentKind, holderName, loanId, customerId, note, documentNumber });

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `board-game:${tenantId}:identity.hold:${key}`,
    ]);
    const existing = await client.query<{ id: string; take_request_hash: string | null }>(
      `SELECT id, take_request_hash FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND take_idempotency_key = $2`,
      [tenantId, key]
    );
    if (existing.rowCount) {
      if (existing.rows[0].take_request_hash !== hash) {
        throw new IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE, "identity.hold");
      }
      const replay = await readHoldInTx(client, tenantId, existing.rows[0].id);
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }

    // session ต้องเปิดอยู่จริงในร้านนี้ — รับบัตรไว้กับโต๊ะที่จ่ายเงินไปแล้วคือบัตรที่ไม่มีใคร
    // ถูกบังคับให้คืน (ด่านปิดบิลจะไม่มีวันเห็นมัน)
    const session = await client.query<{ location_id: string }>(
      `SELECT location_id FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status IN ('OPEN','CLOSING')
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบโต๊ะที่ยังเปิดอยู่");
    if (loanId) {
      const loan = await client.query(
        `SELECT 1 FROM bms_board_game_session_games
          WHERE tenant_id = $1 AND id = $2 AND session_id = $3`,
        [tenantId, loanId, sessionId]
      );
      if (!loan.rowCount) throw new Error("รายการยืมเกมไม่ใช่ของโต๊ะนี้");
    }
    if (customerId) {
      const customer = await client.query(
        `SELECT 1 FROM bms_customers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, customerId]
      );
      if (!customer.rowCount) throw new Error("ไม่พบสมาชิกรายนี้");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_identity_holds
         (tenant_id, location_id, session_id, loan_id, customer_id, document_kind, holder_name,
          document_number_encrypted, document_number_tail, note, taken_by,
          take_idempotency_key, take_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        tenantId,
        session.rows[0].location_id,
        sessionId,
        loanId,
        customerId,
        documentKind,
        holderName,
        encryptSecret(documentNumber),
        identityNumberTail(documentNumber),
        note,
        actorUserId ?? null,
        key,
        hash,
      ]
    );
    // audit เก็บ **metadata เท่านั้น** — ชื่อและเลขไม่ลง audit log เพราะ log เป็นที่ที่ไม่มี
    // การ purge ตามมาทีหลัง
    await auditInTx(client, tenantId, actorUserId, "board_game.identity_hold_take", inserted.rows[0].id, {
      sessionId,
      loanId,
      documentKind,
      hasNumber: documentNumber != null,
    });
    const created = await readHoldInTx(client, tenantId, inserted.rows[0].id);
    await client.query("COMMIT");
    return { ...created, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * คืนบัตรให้ลูกค้า · **ล้างข้อมูลส่วนบุคคลในทรานแซกชันเดียวกัน**
 *
 * แถวยังอยู่เป็น tombstone: ชนิดเอกสาร เวลา และคนที่รับ/คืน ยังตอบได้ว่า "คืนไปแล้วหรือยัง
 * และใครเป็นคนยื่นให้" ซึ่งเป็นคำถามที่ต้องตอบได้เมื่อลูกค้ากลับมาบอกว่าไม่ได้รับบัตรคืน ·
 * ลบทั้งแถวทิ้งจะตอบคำถามนั้นไม่ได้เลย (บทเรียนของ `9.28`)
 *
 * คืนซ้ำไม่ทำอะไร — บัตรอยู่ในมือเจ้าของแล้ว ไม่มีอะไรให้ย้อน
 */
export async function releaseBoardGameIdentityHold(
  tenantId: string,
  holdIdInput: string,
  input: { note?: unknown } = {},
  actorUserId?: string | null
): Promise<BoardGameIdentityHold & { replayed: boolean }> {
  const holdId = uuid(holdIdInput, "holdId");
  const note = text(input.note) ? text(input.note).slice(0, 500) : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const locked = await client.query<{ status: string; session_id: string }>(
      `SELECT status, session_id FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, holdId]
    );
    if (!locked.rowCount) throw new Error("ไม่พบบัตรที่รับไว้");
    if (locked.rows[0].status === "RETURNED") {
      const replay = await readHoldInTx(client, tenantId, holdId);
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const returnedAt = new Date();
    await client.query(
      `UPDATE bms_board_game_identity_holds
          SET status = 'RETURNED',
              returned_at = $3,
              returned_by = $4,
              purged_at = $3,
              holder_name = NULL,
              document_number_encrypted = NULL,
              document_number_tail = NULL,
              note = COALESCE($5, note),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, holdId, returnedAt, actorUserId ?? null, note]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.identity_hold_release", holdId, {
      sessionId: locked.rows[0].session_id,
      purged: true,
    });
    const released = await readHoldInTx(client, tenantId, holdId);
    await client.query("COMMIT");
    return { ...released, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * อ่านเลขบัตรกลับออกมา — เหตุการณ์เดียวที่ต้องใช้คือ "ลูกค้าเดินออกไปพร้อมกล่องเกม"
 *
 * ผู้เรียกต้องตรวจ `board_game.identity.reveal` มาก่อนแล้ว (route เป็นคนตรวจ ไม่ใช่ที่นี่ —
 * รูปเดียวกับ `getEvidenceFileForStreaming` ของ `9.25`) · ที่นี่รับผิดชอบสองอย่าง: ถอดรหัส
 * และ **บันทึกว่ามีคนอ่าน** ซึ่งเป็นสิ่งเดียวที่ทำให้กฎข้อ 2 ตรวจสอบได้จริง
 */
export async function revealBoardGameIdentityNumber(
  tenantId: string,
  holdIdInput: string,
  actorUserId: string,
  reason?: unknown
): Promise<{ documentNumber: string | null; hold: BoardGameIdentityHold }> {
  const holdId = uuid(holdIdInput, "holdId");
  const note = text(reason) ? text(reason).slice(0, 300) : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await requireBoardGameCafeTenant(client, tenantId);
    const row = await client.query<{ document_number_encrypted: string | null; status: string }>(
      `SELECT document_number_encrypted, status FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, holdId]
    );
    if (!row.rowCount) throw new Error("ไม่พบบัตรที่รับไว้");
    const stored = row.rows[0].document_number_encrypted;
    // ถอดไม่ออก (คีย์ถูกหมุนไปแล้ว) ต่างจาก "ไม่เคยบันทึกเลขไว้" — คนอ่านต้องแยกสองอย่างนี้ออก
    const documentNumber = stored ? decryptSecret(stored) : null;
    if (stored && documentNumber == null) {
      throw new Error("ถอดรหัสเลขเอกสารไม่สำเร็จ — คีย์ BMS_SECRET_KEY อาจถูกเปลี่ยนหลังรับบัตรใบนี้");
    }
    await auditInTx(client, tenantId, actorUserId, "board_game.identity_hold_reveal", holdId, {
      status: row.rows[0].status,
      hasNumber: stored != null,
      reason: note,
    });
    const hold = await readHoldInTx(client, tenantId, holdId);
    await client.query("COMMIT");
    return { documentNumber, hold };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
