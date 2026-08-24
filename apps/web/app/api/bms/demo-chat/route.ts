import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logConversation } from "@/lib/bms/inbox";
import { runPipeline } from "@/lib/bms/pipeline";
import { getDemoShopDefinition, getDemoTenantContext } from "@/lib/bms/demoShops";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 180);
  return normalized || null;
}

async function handlePOST(req: NextRequest) {
  // เดโมเปิดให้ทุกคนใช้โดยตั้งใจ (หน้าขายของ) แต่ทุกข้อความเรียกโมเดลจริง =
  // ค่า token เป็นของเจ้าของระบบ ไม่ใช่ของผู้ยิง · เพดานต่อ IP ต่อนาทีคือส่วนที่หายไป
  // (webhook เว็บวิดเจ็ตซึ่งเปิดสาธารณะเหมือนกันมีเพดานนี้อยู่แล้ว)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`demo-chat:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded", reply: "ขอโทษค่ะ ตอนนี้มีคำถามเข้ามาเร็วเกินไป รอสักครู่แล้วลองอีกครั้งนะคะ" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    demoShopKey?: unknown;
    message?: unknown;
    sessionId?: unknown;
    customerRef?: unknown;
  };
  const demoShop = getDemoShopDefinition(typeof body.demoShopKey === "string" ? body.demoShopKey : null);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > 800) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const tenant = await getDemoTenantContext(demoShop.key);
  if (!tenant || tenant.productCount < 1) {
    return NextResponse.json({
      error: "demo shop not ready",
      reply:
        `ตอนนี้เดโมร้าน ${demoShop.fallbackShopName} ยังไม่มีข้อมูลสินค้าจริงให้อ่านค่ะ ` +
        `ต้องเตรียม tenant slug "${demoShop.tenantSlug}" และเพิ่มสินค้าอย่างน้อย 1 รายการก่อน`,
      shop: {
        key: demoShop.key,
        label: demoShop.label,
        tenantSlug: demoShop.tenantSlug,
        name: demoShop.fallbackShopName,
        ready: false,
        productCount: 0,
      },
    });
  }

  const sessionId =
    normalizeSessionId(body.sessionId) ??
    normalizeSessionId(body.customerRef) ??
    `demo-web-${demoShop.key}-${randomUUID()}`;

  const result = await runPipeline(message, "web", tenant.tenantId, sessionId);
  await logConversation(tenant.tenantId, "web", sessionId, message, result.reply, result.quality);

  return NextResponse.json({
    reply: result.reply,
    trace: result.trace ?? [],
    sessionId,
    shop: {
      key: demoShop.key,
      label: demoShop.label,
      tenantSlug: tenant.slug,
      name: tenant.name,
      ready: true,
      productCount: tenant.productCount,
    },
  });
}

export const POST = withRouteErrorLog("POST /api/bms/demo-chat", handlePOST);
