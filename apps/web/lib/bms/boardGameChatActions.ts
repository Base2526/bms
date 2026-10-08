import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireBoardGameCafeTenant } from "./boardGameCafe";
import { boardGameIdempotency, replayBoardGameResult, storeBoardGameResult } from "./boardGameIdempotency";
import { boardGameReservationTableFitsInTx, prepareChatReservationInTx, ChatBoardGameReservationRejection } from "./boardGameWaitlist";
import { notifyInboxConversationChanged } from "./inbox";
import { BOARD_GAME_CHAT_ACTIONS, boardGameChatActionFingerprint, boardGameChatActionSummary,
  type BoardGameChatActionDraft, type BoardGameChatActionPreview,
  type BoardGameChatActionQuote, type BoardGameChatActionResult } from "./boardGameChatActionPolicy";

type Authority = { tenantId: string; customerId: string; channel: string; customerRef: string };
function reject(code: string, message: string): never { throw new ChatBoardGameReservationRejection(code, message); }

export function validateBoardGameChatAction(draft: BoardGameChatActionDraft) {
  if (!BOARD_GAME_CHAT_ACTIONS.includes(draft.action)) reject("INVALID_ACTION", "Unknown action");
  if (draft.reference !== undefined && !/^[a-f0-9]{8}$/i.test(draft.reference)) reject("INVALID_REFERENCE", "Use a booking reference from your status list");
  if (["CANCEL", "RESCHEDULE"].includes(draft.action) && !draft.reference) reject("REFERENCE_REQUIRED", "Choose your booking reference first");
  if (draft.note !== undefined && (typeof draft.note !== "string" || draft.note.length > 300
    || /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){8,}/i.test(draft.note))) reject("INVALID_NOTE", "Do not include personal contact or payment details");
  if (draft.action === "RESCHEDULE") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.reservedLocal ?? "")
      || !Number.isInteger(draft.durationMinutes) || draft.durationMinutes! < 30 || draft.durationMinutes! > 720
      || !Number.isInteger(draft.partySize) || draft.partySize! < 1 || draft.partySize! > 500) {
      reject("RESCHEDULE_DETAILS_REQUIRED", "Specify branch-local date/time, duration and party size");
    }
  } else if (draft.reservedLocal !== undefined || draft.durationMinutes !== undefined || draft.partySize !== undefined) {
    reject("INVALID_ARGUMENTS", "Booking time fields are only valid for RESCHEDULE");
  }
  if (!["CANCEL", "RESCHEDULE"].includes(draft.action) && !draft.note?.trim()) reject("NOTE_REQUIRED", "Describe the request for staff");
}

async function prepareInTx(client: PoolClient, auth: Authority, draft: BoardGameChatActionDraft) {
  validateBoardGameChatAction(draft);
  await requireBoardGameCafeTenant(client, auth.tenantId);
  // Recheck channel ownership in the transaction, including after CRM merges or deletion.
  const owner = await client.query(
    `SELECT c.id FROM bms_customers c JOIN bms_customer_identities i
       ON i.tenant_id = c.tenant_id AND i.customer_id = c.id
      WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL
        AND i.channel = $3 AND i.external_ref = $4 FOR SHARE OF c, i`,
    [auth.tenantId, auth.customerId, auth.channel, auth.customerRef],
  );
  if (!owner.rowCount) reject("CUSTOMER_IDENTITY_REQUIRED", "Customer identity could not be verified");
  let row: any = null;
  if (draft.reference) {
    const found = await client.query(
      `SELECT w.id, w.location_id, w.status, w.reserved_for, w.reserved_duration_minutes,
              w.party_size, w.reserved_table_id, w.updated_at::text AS version,
              w.deposit_status, w.deposit_amount, w.deposit_policy_snapshot,
              COALESCE(p.display_name, l.name) AS branch,
              COALESCE(NULLIF(s.timezone, ''), 'Asia/Bangkok') AS timezone
         FROM bms_board_game_waitlist w
         JOIN bms_locations l ON l.tenant_id = w.tenant_id AND l.id = w.location_id
         JOIN bms_store_profile s ON s.tenant_id = w.tenant_id
         LEFT JOIN bms_board_game_public_locations p ON p.tenant_id = w.tenant_id AND p.location_id = w.location_id
        WHERE w.tenant_id = $1 AND w.customer_id = $2 AND w.source = 'CHAT'
          AND w.kind = 'RESERVATION' AND left(w.id::text, 8) = $3
        ORDER BY w.id LIMIT 2 FOR UPDATE OF w`,
      [auth.tenantId, auth.customerId, draft.reference.toLowerCase()],
    );
    if (found.rows.length !== 1) reject("BOOKING_NOT_FOUND", "Booking not found or reference is ambiguous");
    row = found.rows[0];
  }
  const changesBooking = ["CANCEL", "RESCHEDULE"].includes(draft.action);
  if (changesBooking && (!row || !["REQUESTED", "CONFIRMED"].includes(row.status))) reject("BOOKING_STATE_CHANGED", "Only bookings before check-in can be changed");
  if (changesBooking && (row.deposit_status !== "NOT_REQUIRED" || Number(row.deposit_amount) !== 0 || row.deposit_policy_snapshot !== "NONE")) reject("DEPOSIT_REQUIRES_STAFF", "A deposit requires staff review");
  if (draft.action === "RESCHEDULE" && row.status !== "CONFIRMED") reject("BOOKING_STATE_CHANGED", "Only confirmed bookings can be rescheduled; cancel a pending request and submit a new one");
  const next = draft.action === "RESCHEDULE" ? await prepareChatReservationInTx(client, {
    tenantId: auth.tenantId, locationId: row.location_id, reservedLocal: draft.reservedLocal!,
    durationMinutes: draft.durationMinutes!, partySize: draft.partySize!,
  }) : null;
  const preview: BoardGameChatActionPreview = {
    action: draft.action, reference: row ? row.id.slice(0, 8) : null, branch: row?.branch ?? null,
    reservedFor: next?.reservedFor ?? (row?.reserved_for ? new Date(row.reserved_for).toISOString() : null),
    timezone: next?.timezone ?? row?.timezone ?? "Asia/Bangkok",
    durationMinutes: next?.durationMinutes ?? (row ? Number(row.reserved_duration_minutes) : null),
    partySize: next?.partySize ?? (row ? Number(row.party_size) : null), note: draft.note?.trim() || null,
    version: row?.version ?? "staff-request",
  };
  return { preview, row };
}

export async function previewBoardGameChatAction(auth: Authority, draft: BoardGameChatActionDraft) {
  const client = await getClient();
  try {
    await beginTenantTx(client, auth.tenantId);
    const { preview } = await prepareInTx(client, auth, draft);
    await client.query("COMMIT");
    return preview;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function commitBoardGameChatAction(auth: Authority, quote: BoardGameChatActionQuote) {
  if (quote.expiresAt <= Date.now()) reject("CONFIRMATION_EXPIRED", "Please confirm a fresh summary");
  const idempotency = boardGameIdempotency("chat.action", quote.requestKey,
    { customerId: auth.customerId, channel: auth.channel, customerRef: auth.customerRef, fingerprint: quote.fingerprint });
  const client = await getClient();
  let conversationId: string | null = null;
  try {
    await beginTenantTx(client, auth.tenantId);
    const replay = await replayBoardGameResult<BoardGameChatActionResult>(client, auth.tenantId, idempotency);
    if (replay) { await client.query("COMMIT"); return replay; }
    const { preview, row } = await prepareInTx(client, auth, quote.draft);
    if (boardGameChatActionFingerprint(preview, auth.customerId) !== quote.fingerprint) reject("CONFIRMATION_REQUIRED", "Booking details changed; review a fresh summary");
    let result: BoardGameChatActionResult;
    if (preview.action === "CANCEL") {
      await client.query(
        `UPDATE bms_board_game_waitlist SET status = 'CANCELLED', closed_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2 AND id = $3 AND source = 'CHAT'`,
        [auth.tenantId, auth.customerId, row.id],
      );
      result = { action: preview.action, reference: preview.reference!, status: "CANCELLED" };
    } else if (preview.action === "RESCHEDULE") {
      const fits = await boardGameReservationTableFitsInTx(client, {
        tenantId: auth.tenantId, locationId: row.location_id, entryId: row.id,
        tableId: row.reserved_table_id, reservedFor: preview.reservedFor!,
        durationMinutes: preview.durationMinutes!, partySize: preview.partySize!,
      });
      if (!fits) reject("NO_TABLE_AVAILABLE", "The reserved table is unavailable for the new time or party size; the original booking remains unchanged");
      await client.query(
        `UPDATE bms_board_game_waitlist SET reserved_for = $4, reserved_duration_minutes = $5,
            party_size = $6, service_date = (($4::timestamptz AT TIME ZONE $7) - INTERVAL '4 hours')::date,
            updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2 AND id = $3 AND source = 'CHAT'`,
        [auth.tenantId, auth.customerId, row.id, preview.reservedFor, preview.durationMinutes, preview.partySize, preview.timezone],
      );
      result = { action: preview.action, reference: preview.reference!, status: "CONFIRMED" };
    } else {
      const conversation = (await client.query<{ id: string; assigned_to_user_id: string | null }>(
        `SELECT id, assigned_to_user_id FROM bms_conversations
          WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3 FOR UPDATE`,
        [auth.tenantId, auth.channel, auth.customerRef],
      )).rows[0];
      if (!conversation) reject("CONVERSATION_REQUIRED", "Please retry in your shop conversation");
      const staff = (await client.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.tenant_id = $1 AND r.name IN ('Sales','Manager','Administrator')
          ORDER BY (u.id = $2::uuid) DESC NULLS LAST, u.is_available DESC, u.created_at, u.id LIMIT 1`,
        [auth.tenantId, conversation.assigned_to_user_id],
      )).rows[0];
      if (!staff) reject("STAFF_UNAVAILABLE", "No staff recipient is configured; please use the shop contact details");
      conversationId = conversation.id;
      const note = (await client.query<{ id: string }>(
        `INSERT INTO bms_conversation_notes (tenant_id, conversation_id, author, body)
          VALUES ($1,$2,'AI',$3) RETURNING id`,
        [auth.tenantId, conversationId,
          `Customer-confirmed request. Staff must verify ownership, eligibility and amounts before using the existing POS/payment commands.\n${boardGameChatActionSummary(quote, false)}`],
      )).rows[0];
      await client.query(
        `INSERT INTO bms_conversation_note_mentions (tenant_id, note_id, conversation_id, mentioned_user_id)
          VALUES ($1,$2,$3,$4)`, [auth.tenantId, note.id, conversationId, staff.id],
      );
      await client.query(
        `UPDATE bms_conversations SET status = 'PENDING', updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, conversationId],
      );
      result = { action: preview.action, reference: String(note.id), status: "STAFF_REVIEW" };
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
        VALUES ($1,'ai:customer','board_game.chat_action',$2,$3::jsonb)`,
      [auth.tenantId, row?.id ?? conversationId, JSON.stringify({ action: preview.action, status: result.status })],
    );
    await storeBoardGameResult(client, auth.tenantId, idempotency, result);
    await client.query("COMMIT");
    if (conversationId) notifyInboxConversationChanged(auth.tenantId, conversationId);
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
