// apps/web/app/api/dev/fake/support-tickets/route.ts
// สร้าง support tickets ระดับแพลตฟอร์ม เพื่อทดสอบ /admin/support-tickets
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPICS = [
  "channel_setup",
  "ai_inbox",
  "orders_inventory",
  "payments_checkout",
  "reports_billing",
  "bug",
  "feature",
];

const CASES: Record<string, Array<{ subject: string; message: string }>> = {
  channel_setup: [
    {
      subject: "LINE webhook verify ผ่าน แต่ข้อความไม่เข้า Inbox",
      message: "ร้านตั้งค่า LINE OA แล้ว Webhook verify สำเร็จ แต่ข้อความลูกค้าไม่ถูกสร้างใน Inbox รบกวนช่วยดู channel health และ route webhook ให้หน่อย",
    },
    {
      subject: "Facebook Messenger token หมดอายุ",
      message: "หน้า Dashboard ขึ้นว่า Token หมดอายุ อยากรู้ว่าต้องต่อ token ตรงไหน และจะกระทบข้อความเก่าหรือไม่",
    },
  ],
  ai_inbox: [
    {
      subject: "AI ตอบลูกค้าช้าใน Inbox",
      message: "หลังลูกค้าถามสินค้า AI ใช้เวลานานกว่าปกติ อยากให้ช่วยเช็ก provider health และ log ที่เกี่ยวข้อง",
    },
    {
      subject: "AI แนะนำคำตอบไม่อ้างอิงสินค้าคงเหลือ",
      message: "AI แนะนำสินค้าที่ไม่มี stock ในบาง conversation รบกวนช่วยดู tool result และ prompt guardrail ให้หน่อย",
    },
  ],
  orders_inventory: [
    {
      subject: "Reserved stock ไม่คืนหลัง order หมดอายุ",
      message: "ออเดอร์สถานะ RESERVED ค้างเกิน 30 นาทีแล้ว stock ยังไม่ถูก release น่าจะเกี่ยวกับ batch release expired orders",
    },
    {
      subject: "Restock subscription ไม่เปลี่ยนเป็น ordered",
      message: "ลูกค้ากดสั่งหลังได้รับแจ้ง restock แต่หน้า Restock ยังไม่ขึ้น ordered attribution",
    },
  ],
  payments_checkout: [
    {
      subject: "ลูกค้าเปิด checkout link แล้วอัปโหลดสลิปไม่ได้",
      message: "ลูกค้าเข้าหน้า checkout จาก LINE แล้วเลือกไฟล์สลิปไม่ได้บนมือถือ Android รบกวนช่วยดู browser compatibility",
    },
    {
      subject: "Payment ยืนยันแล้ว order ไม่เปลี่ยนเป็น PAID",
      message: "แอดมินกด confirm payment แล้ว payment สำเร็จ แต่ order ยังแสดงสถานะเดิมใน dashboard",
    },
  ],
  reports_billing: [
    {
      subject: "Daily sales digest ไม่ส่ง LINE",
      message: "ตั้ง report subscription ช่องทาง LINE แล้ว แต่ไม่เห็น delivery ของวันนี้ในหน้า report schedule",
    },
    {
      subject: "AI quota ใกล้หมด อยากเปลี่ยนเป็น BYOK",
      message: "ร้านใช้ shared AI quota ใกล้เต็ม อยากทราบขั้นตอนใส่ provider key ของร้านเอง",
    },
  ],
  bug: [
    {
      subject: "หน้า settings focus ผิด card หลังคลิกจาก dashboard",
      message: "กด TikTok Chat จาก Dashboard แล้ว Settings scroll ไปไม่ตรง card ในบางขนาดหน้าจอ",
    },
  ],
  feature: [
    {
      subject: "อยากให้ Support Tickets เปลี่ยนสถานะได้",
      message: "หน้า list ดู ticket ได้แล้ว อยากเพิ่ม action เปลี่ยน open/pending/closed และ note ภายใน",
    },
  ],
};

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) {
    return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  }

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 12, 1), 200);
    const created: any[] = [];

    for (let i = 0; i < count; i += 1) {
      const topic = pick(TOPICS, i);
      const sample = pick(CASES[topic], i);
      const ticketId = `SUP-FAKE-${Date.now()}-${String(i + 1).padStart(3, "0")}`;
      const status = i % 5 === 0 ? "pending" : i % 7 === 0 ? "closed" : "open";
      const createdAt = new Date(Date.now() - i * 1000 * 60 * 47);

      const res = await query(
        `INSERT INTO support_tickets
           (ticket_id, name, email, phone, topic, subject, message, ref, page_url, user_agent, ip, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, ticket_id, subject, topic, status, created_at`,
        [
          ticketId,
          `FAKE Support User ${i + 1}`,
          `support.fake.${i + 1}@example.com`,
          `080000${String(i + 1).padStart(4, "0")}`,
          topic,
          sample.subject,
          sample.message,
          `FAKE-SUPPORT-${String(i + 1).padStart(3, "0")}`,
          `https://jachoei.com/admin/${topic === "channel_setup" ? "settings" : "dashboard"}`,
          "FakeSeed/1.0",
          "127.0.0.1",
          status,
          createdAt,
        ]
      );
      if (status !== "open" || i % 3 === 0) {
        await query(
          `INSERT INTO support_ticket_comments
             (ticket_id, author_email, from_status, to_status, body, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            res.rows[0].id,
            "platform.fake.admin@example.com",
            "open",
            status,
            status === "closed"
              ? "FAKE: ตรวจสอบแล้วและปิดเคสสำหรับทดสอบ timeline"
              : "FAKE: รับเรื่องแล้ว รอตรวจ log เพิ่ม",
            new Date(createdAt.getTime() + 1000 * 60 * 8),
          ]
        );
      }
      created.push(res.rows[0]);
    }

    return NextResponse.json({ ok: true, created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/support-tickets", handlePOST);
