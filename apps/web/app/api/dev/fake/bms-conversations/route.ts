// apps/web/app/api/dev/fake/bms-conversations/route.ts
// สร้าง Inbox conversations + messages เพื่อทดสอบหน้า Inbox โดยไม่ต้องต่อช่องทางจริง
// marker: customer_ref ขึ้นต้น 'FAKE-' + tag 'fake' → cleanup ลบได้ (messages/notes cascade)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal, fakeSeedDisabled } from "@/lib/dev-guards";
import { getClient, query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { listAutoAssignPool } from "@/lib/bms/inbox";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const R = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[R(a.length)];
const short = () => Math.random().toString(36).slice(2, 10);

const CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"];
const STATUS_POOL = ["OPEN", "OPEN", "PENDING", "CLOSED"];

// บทสนทนาสำเร็จรูป (IN = ลูกค้า, OUT = AI)
const SCRIPTS: { dir: "IN" | "OUT"; body: string }[][] = [
  [
    { dir: "IN", body: "สวัสดีครับ" },
    { dir: "OUT", body: "สวัสดีค่ะ 😊 สนใจสินค้ารุ่นไหนดีคะ" },
    { dir: "IN", body: "Nike XL มีไหม" },
    { dir: "OUT", body: "มีค่ะ ✅ Nike Air ไซซ์ XL พร้อมส่ง 5 ชิ้น ราคา 3,200 บาท สนใจสั่งเลยไหมคะ?" },
    { dir: "IN", body: "สั่ง 1 ชิ้นครับ" },
    { dir: "OUT", body: "รับออเดอร์แล้วค่ะ ✅ รวม 3,200 บาท 🙏" },
  ],
  [
    { dir: "IN", body: "ของยังมีอยู่ไหมคะ" },
    { dir: "OUT", body: "รบกวนแจ้งชื่อรุ่น + ไซซ์ได้เลยค่ะ" },
    { dir: "IN", body: "Adidas M" },
    { dir: "OUT", body: "Adidas Runner ไซซ์ M พร้อมส่ง 8 ชิ้นค่ะ 😊" },
  ],
  [
    { dir: "IN", body: "โอนเงินแล้วนะครับ ส่งสลิปให้" },
    { dir: "OUT", body: "ได้รับสลิปแล้วค่ะ กำลังตรวจสอบ เดี๋ยวแจ้งกลับนะคะ 🙏" },
  ],
];

async function bulkInsert(client: any, table: string, cols: string[], rows: any[][]) {
  if (!rows.length) return 0;
  const ph: string[] = [];
  const params: any[] = [];
  rows.forEach((r, ri) => {
    ph.push("(" + cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(",") + ")");
    params.push(...r);
  });
  await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph.join(",")}`, params);
  return rows.length;
}

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 20, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  const customers = (await query(
    `SELECT id FROM bms_customers WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY ('fake' = ANY(tags)) DESC, random() LIMIT 500`,
    [tenantId]
  )).rows;

  // ทุก conversation ต้องมี staff หลักเสมอ (เหมือน logConversation ของจริง) — ที่นี่ insert
  // เป็น bulk ตรงๆ ไม่ผ่าน logConversation() เลยต้องมอบหมายเองแบบ round-robin ในพูล
  // เดียวกับ auto-assign จริง (Sales ว่างก่อน → Manager → Administrator)
  const staffPool = await listAutoAssignPool(tenantId);

  const convs: any[][] = [];
  const msgs: any[][] = [];

  for (let i = 0; i < count; i++) {
    const id = uuid();
    const channel = pick(CHANNELS);
    const status = pick(STATUS_POOL);
    const customerId = customers.length ? pick(customers).id : null;
    const script = pick(SCRIPTS);
    const base = Date.now() - R(7) * 864e5 - R(86400) * 1000;
    const last = script[script.length - 1].body;
    const lastAt = new Date(base).toISOString();
    const unread = status === "CLOSED" ? 0 : R(4);
    const assignedToUserId = staffPool.length ? staffPool[i % staffPool.length] : null;

    convs.push([tenantId, id, channel, "FAKE-" + short(), customerId, status, ["fake"], unread, last.slice(0, 500), lastAt, assignedToUserId]);
    script.forEach((m, mi) => {
      const at = new Date(base - (script.length - mi) * 60000).toISOString();
      msgs.push([tenantId, id, m.dir, m.body, m.dir === "IN" ? "customer" : "ai", at]);
    });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await bulkInsert(client, "bms_conversations",
      ["tenant_id", "id", "channel", "customer_ref", "customer_id", "status", "tags", "unread", "last_message", "last_message_at", "assigned_to_user_id"], convs);
    await bulkInsert(client, "bms_messages",
      ["tenant_id", "conversation_id", "direction", "body", "sender", "created_at"], msgs);
    await client.query("COMMIT");
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    created: convs.map((c) => ({ id: c[1], name: `${c[2]} · ${c[3]}`, status: c[5] })),
    summary: { conversations: convs.length, messages: msgs.length },
  });
}
