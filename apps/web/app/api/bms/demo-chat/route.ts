import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logConversation } from "@/lib/bms/inbox";
import { runPipeline } from "@/lib/bms/pipeline";
import { getDemoShopDefinition, getDemoTenantContext } from "@/lib/bms/demoShops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 180);
  return normalized || null;
}

export async function POST(req: NextRequest) {
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
