// =============================================================
// BMS Payment — payment records, confirm/reject/refund, slip verify
// -------------------------------------------------------------
// submitPayment      : บันทึกการชำระ (status PENDING) — ยังไม่ขยับ order
// confirmPayment     : PENDING → CONFIRMED + order PENDING → PAID (atomic)
// rejectPayment      : PENDING → REJECTED
// refundPayment      : CONFIRMED → REFUNDED (สิทธิ์ manager)
// verifyPaymentSlip  : OCR/AI อ่านสลิป → "แนะนำ" เท่านั้น (ไม่ยืนยันเอง)
//
// กฎ (BUSINESS_RULES): AI ห้ามยืนยันการชำระเอง — verify แค่ช่วยตรวจ
// การยืนยัน/คืนเงินต้องผ่านสิทธิ์ (payment.confirm / payment.refund)
// =============================================================

import path from "path";
import { readFile } from "fs/promises";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { STORAGE_DIR } from "@/lib/storage";
import { notifyOrderStatusEmail } from "./orderNotify";

export const PAYMENT_METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type SubmitPaymentInput = {
  tenantId: string;
  orderId: string;
  method: PaymentMethod;
  amount?: number | null; // ไม่ระบุ → ใช้ยอดรวมของ order
  slipUrl?: string | null;
  slipRef?: string | null;
  note?: string | null;
  actor?: string | null;
};

export type SubmitResult =
  | { status: "SUBMITTED"; paymentId: string; amount: number }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "BAD_METHOD" };

export type ConfirmResult =
  | { status: "CONFIRMED"; paymentId: string; orderPaid: boolean }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE"; current: string };

// ---- submit --------------------------------------------------
export async function submitPayment(input: SubmitPaymentInput): Promise<SubmitResult> {
  const { tenantId } = input;
  if (!PAYMENT_METHODS.includes(input.method)) return { status: "BAD_METHOD" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query<{ total_amount: string }>(
      `SELECT total_amount FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, input.orderId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }

    const amount =
      input.amount != null && Number.isFinite(input.amount) && input.amount >= 0
        ? Number(input.amount)
        : Number(ord.rows[0].total_amount);

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_payments
         (tenant_id, order_id, method, amount, slip_url, slip_ref, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tenantId, input.orderId, input.method, amount, input.slipUrl ?? null, input.slipRef ?? null, input.note ?? null]
    );

    await client.query("COMMIT");
    return { status: "SUBMITTED", paymentId: ins.rows[0].id, amount };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- confirm (atomic: payment CONFIRMED + order PAID) --------
export async function confirmPayment(
  tenantId: string,
  paymentId: string,
  actor: string | null = "admin"
): Promise<ConfirmResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const pay = await client.query<{ status: string; order_id: string }>(
      `SELECT status, order_id FROM bms_payments
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, paymentId]
    );
    if (pay.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    if (pay.rows[0].status !== "PENDING") {
      const current = pay.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current };
    }

    await client.query(
      `UPDATE bms_payments
          SET status = 'CONFIRMED', verified_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paymentId, actor]
    );

    // transition order PENDING → PAID (best-effort; ถ้า order ไม่ใช่ PENDING แล้ว ก็ปล่อย)
    const ord = await client.query(
      `UPDATE bms_orders SET status = 'PAID', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, pay.rows[0].order_id]
    );

    await client.query("COMMIT");
    const orderPaid = (ord.rowCount ?? 0) > 0;
    if (orderPaid) void notifyOrderStatusEmail(tenantId, pay.rows[0].order_id, "paid");
    return { status: "CONFIRMED", paymentId, orderPaid };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- reject / refund (simple guarded transitions) ------------
async function setStatus(
  tenantId: string,
  paymentId: string,
  from: string[],
  to: string,
  note?: string | null,
  actor?: string | null
): Promise<boolean> {
  const res = await query(
    `UPDATE bms_payments
        SET status = $4,
            note = COALESCE($5, note),
            verified_by = COALESCE($6, verified_by),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = ANY($3)`,
    [tenantId, paymentId, from, to, note ?? null, actor ?? null]
  );
  return (res.rowCount ?? 0) > 0;
}

/** ปฏิเสธสลิป: PENDING → REJECTED */
export function rejectPayment(tenantId: string, paymentId: string, note?: string | null, actor?: string | null) {
  return setStatus(tenantId, paymentId, ["PENDING"], "REJECTED", note, actor);
}

/** คืนเงิน: CONFIRMED → REFUNDED (สิทธิ์ manager ที่ resolver) */
export function refundPayment(tenantId: string, paymentId: string, actor?: string | null) {
  return setStatus(tenantId, paymentId, ["CONFIRMED"], "REFUNDED", null, actor);
}

// ---- read ----------------------------------------------------
export async function getPayment(tenantId: string, id: string) {
  const res = await query(
    `SELECT id, order_id, method, amount, status, slip_url, slip_ref, verify_result, note, verified_by, created_at, updated_at
       FROM bms_payments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listPayments(
  tenantId: string,
  opts: { search?: string | null; orderId?: string | null; status?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const search = opts.search?.trim() || null;
  const res = await query(
    `SELECT id, order_id, method, amount, status, slip_url, slip_ref, verify_result, note, verified_by, created_at, updated_at
       FROM bms_payments
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR order_id = $2)
        AND ($3::text IS NULL OR status = $3)
        AND (
          $6::text IS NULL
          OR id::text ILIKE '%' || $6 || '%'
          OR order_id::text ILIKE '%' || $6 || '%'
          OR method ILIKE '%' || $6 || '%'
          OR COALESCE(slip_ref, '') ILIKE '%' || $6 || '%'
          OR COALESCE(verified_by, '') ILIKE '%' || $6 || '%'
          OR COALESCE(note, '') ILIKE '%' || $6 || '%'
        )
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, opts.orderId ?? null, opts.status ?? null, limit, offset, search]
  );
  return res.rows;
}

// =============================================================
// verifyPaymentSlip — OCR/AI (แนะนำเท่านั้น ไม่เปลี่ยนสถานะ)
// -------------------------------------------------------------
//   • ไม่มี ANTHROPIC_API_KEY หรืออ่านสลิปไม่ได้ → heuristic (ต้องตรวจเอง)
//   • มี key + สลิปเป็นรูป → Claude vision สกัด amount/date/ref แล้วเทียบยอด
// =============================================================

export type SlipExtract = {
  amount: number | null;
  date: string | null;
  ref: string | null;
  bank: string | null;
};

export type SlipVerification = {
  method: "ai" | "heuristic";
  extracted: SlipExtract | null;
  expectedAmount: number;
  amountMatch: boolean;
  verified: boolean; // true = AI มั่นใจว่ายอดตรง (ยังต้องให้คนกดยืนยันอยู่ดี)
  reason: string;
  checkedAt: string;
};

/** แปลง /api/files/<id> → { buffer, mediaType } (อ่านจาก STORAGE_DIR) */
async function loadSlipImage(slipUrl: string): Promise<{ base64: string; mediaType: string } | null> {
  const m = slipUrl.match(/\/api\/files\/(\d+)/);
  if (!m) return null;
  const fileId = Number(m[1]);
  const res = await query<{ relpath: string; mimetype: string | null }>(
    `SELECT relpath, mimetype FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [fileId]
  );
  if (res.rowCount === 0) return null;
  const { relpath, mimetype } = res.rows[0];
  const mediaType = mimetype || "image/jpeg";
  if (!mediaType.startsWith("image/")) return null;
  try {
    const buf = await readFile(path.join(STORAGE_DIR, relpath));
    return { base64: buf.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

async function claudeReadSlip(base64: string, mediaType: string): Promise<SlipExtract> {
  const model = process.env.BMS_AI_MODEL || "claude-haiku-4-5-20251001";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system:
        "คุณเป็นระบบ OCR อ่านสลิปโอนเงินไทย ดึงข้อมูลจากรูปสลิปเท่านั้น ห้ามเดา " +
        'ตอบเป็น JSON เท่านั้น รูปแบบ: {"amount": number|null, "date": string|null, "ref": string|null, "bank": string|null} ' +
        "amount = ยอดเงินเป็นตัวเลข (ไม่มีคอมม่า/สกุลเงิน), ถ้าหาไม่เจอให้เป็น null",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "อ่านสลิปนี้แล้วตอบ JSON ตามรูปแบบที่กำหนด" },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const json = (await resp.json()) as { content?: Array<{ text?: string }> };
  const text = json.content?.[0]?.text?.trim() ?? "";
  const jsonStr = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(jsonStr);
  return {
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    date: parsed.date ?? null,
    ref: parsed.ref ?? null,
    bank: parsed.bank ?? null,
  };
}

export async function verifyPaymentSlip(tenantId: string, paymentId: string): Promise<SlipVerification | null> {
  const pay = await query<{ amount: string; slip_url: string | null }>(
    `SELECT amount, slip_url FROM bms_payments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, paymentId]
  );
  if (pay.rowCount === 0) return null;

  const expectedAmount = Number(pay.rows[0].amount);
  const checkedAt = new Date().toISOString();

  let result: SlipVerification;

  const img = process.env.ANTHROPIC_API_KEY && pay.rows[0].slip_url
    ? await loadSlipImage(pay.rows[0].slip_url)
    : null;

  if (img) {
    try {
      const extracted = await claudeReadSlip(img.base64, img.mediaType);
      const amountMatch = extracted.amount != null && Math.abs(extracted.amount - expectedAmount) < 0.01;
      result = {
        method: "ai",
        extracted,
        expectedAmount,
        amountMatch,
        verified: amountMatch,
        reason: amountMatch
          ? `ยอดในสลิป (${extracted.amount}) ตรงกับยอดที่ต้องชำระ — กรุณากดยืนยันเพื่อรับชำระ`
          : `ยอดในสลิป (${extracted.amount ?? "อ่านไม่ได้"}) ไม่ตรงกับยอด ${expectedAmount} — ตรวจสอบก่อนยืนยัน`,
        checkedAt,
      };
    } catch (err) {
      console.error("[BMS] slip AI verify failed:", err);
      result = {
        method: "heuristic", extracted: null, expectedAmount, amountMatch: false,
        verified: false, reason: "อ่านสลิปด้วย AI ไม่สำเร็จ — กรุณาตรวจสอบด้วยตนเอง", checkedAt,
      };
    }
  } else {
    result = {
      method: "heuristic", extracted: null, expectedAmount, amountMatch: false,
      verified: false,
      reason: process.env.ANTHROPIC_API_KEY
        ? "ไม่มีรูปสลิปให้ตรวจ (ไม่มี slip_url ที่เป็นรูป) — ตรวจสอบด้วยตนเอง"
        : "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_API_KEY) — ตรวจสอบสลิปด้วยตนเอง",
      checkedAt,
    };
  }

  await query(
    `UPDATE bms_payments SET verify_result = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, paymentId, JSON.stringify(result)]
  );
  return result;
}
