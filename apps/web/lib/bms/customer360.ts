// =============================================================
// BMS Customer 360 — โปรไฟล์ลูกค้าแบบรวม (Inbox right panel)
// -------------------------------------------------------------
// อ่านอย่างเดียว (read-only) — ไม่มี path เขียนในไฟล์นี้ ทุก query filter
// ด้วย tenant_id = $1 ตาม convention เดิม (customers.ts/orders.ts)
//
// getCustomer360()      — รวม summary/contact/stats/recentOrders/products/
//                          draftOrder/notes ในก้อนเดียว (เบา, โหลดทันทีตอน
//                          เลือกแชท — ดู dashboard.ts/getDashboard สำหรับ
//                          สไตล์ Promise.all แบบเดียวกัน)
// getCustomerTimeline() — รวม timeline ข้ามทุกแชท/ออเดอร์ของลูกค้า (หนัก
//                          กว่า — โหลดแบบ lazy ตอนกาง section เท่านั้น,
//                          ขยายจาก getTimeline()/getOrderJourney() ใน
//                          inbox.ts/orders.ts จากขอบเขต 1 แชท/1 ออเดอร์ → ทั้งลูกค้า)
// getCustomerInsights() — สรุปด้วย AI จาก "ข้อเท็จจริง" ที่ backend คำนวณ
//                          ไว้แล้วเท่านั้น (ห้าม AI เดา/แต่งตัวเลข ตาม
//                          BUSINESS_RULES) แคชผลไว้ใน bms_customer_ai_summary
//                          (facts_hash เทียบว่าข้อมูลเปลี่ยนไปหรือยังก่อน
//                          เรียก Claude ซ้ำ) — ตามแพทเทิร์นเดียวกับ
//                          verifyPaymentSlip()/claudeReadSlip() ใน payments.ts
// =============================================================

import { query } from "@/lib/db";
import crypto from "crypto";
import { listCustomerCouponWallet } from "./coupons";
import { resolveActiveCustomerId } from "./customers";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
const jIso = (d: any): string | null => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

// ---------------------------------------------------------------
// Section 1+2 — profile / contact / connected accounts
// ---------------------------------------------------------------
export async function getCustomerProfile(tenantId: string, customerId: string) {
  const [cust, identities, addresses] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.phone, c.email, c.note, c.tags, c.created_at,
              c.preferred_language, c.timezone,
              COALESCE(agg.order_count, 0) AS order_count,
              COALESCE(agg.total_spent, 0) AS total_spent
         FROM bms_customers c
         LEFT JOIN (
           SELECT customer_id,
                  COUNT(*) FILTER (WHERE status = ANY($3)) AS order_count,
                  SUM(total_amount) FILTER (WHERE status = ANY($3)) AS total_spent
             FROM bms_orders WHERE tenant_id = $1 GROUP BY customer_id
         ) agg ON agg.customer_id = c.id
        WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [tenantId, customerId, PAID_STATUSES]
    ),
    query(
      `SELECT channel, external_ref FROM bms_customer_identities
        WHERE tenant_id = $1 AND customer_id = $2 ORDER BY id`,
      [tenantId, customerId]
    ),
    query(
      `SELECT id, label, address, is_default, address_type FROM bms_customer_addresses
        WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_default DESC, id`,
      [tenantId, customerId]
    ),
  ]);

  const row = cust.rows[0];
  if (!row) return { customer: null, identities: [], addresses: [] };

  return {
    customer: {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      note: row.note,
      tags: row.tags ?? [],
      createdAt: jIso(row.created_at),
      preferredLanguage: row.preferred_language,
      timezone: row.timezone,
      orderCount: Number(row.order_count),
      totalSpent: Number(row.total_spent),
      // "ลูกค้าใหม่/ลูกค้าประจำ" คำนวณสด ไม่เก็บเป็น tag (ดู migration 6.2)
      isNewCustomer: Number(row.order_count) <= 1,
      isReturningCustomer: Number(row.order_count) > 1,
    },
    identities: identities.rows.map((r: any) => ({ channel: r.channel, externalRef: r.external_ref })),
    addresses: addresses.rows.map((r: any) => ({
      id: String(r.id), label: r.label, address: r.address, isDefault: r.is_default, addressType: r.address_type,
    })),
  };
}

// ---------------------------------------------------------------
// Section 3 — statistics
// ---------------------------------------------------------------
export async function getCustomerStatistics(tenantId: string, customerId: string) {
  const [agg, lastConv, resp, refunds] = await Promise.all([
    query(
      `SELECT
         COUNT(*)::int AS total_orders,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_orders,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_orders,
         COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($3)), 0) AS lifetime_value,
         COUNT(*) FILTER (WHERE status = ANY($3))::int AS paid_order_count,
         MAX(created_at) AS last_order_date
       FROM bms_orders WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId, PAID_STATUSES]
    ),
    query(
      `SELECT MAX(last_message_at) AS last_conv FROM bms_conversations
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId]
    ),
    query(
      `WITH msgs AS (
         SELECT m.direction, m.created_at,
                LAG(m.direction) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_direction,
                LAG(m.created_at) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_at
           FROM bms_messages m
           JOIN bms_conversations c ON c.id = m.conversation_id
          WHERE c.tenant_id = $1 AND c.customer_id = $2
       )
       SELECT AVG(EXTRACT(EPOCH FROM (created_at - prev_at))) AS avg_response_seconds
         FROM msgs WHERE direction = 'OUT' AND prev_direction = 'IN'`,
      [tenantId, customerId]
    ),
    query(
      `SELECT COUNT(*)::int AS c FROM bms_payments p
         JOIN bms_orders o ON o.id = p.order_id
        WHERE o.tenant_id = $1 AND o.customer_id = $2 AND p.status = 'REFUNDED'`,
      [tenantId, customerId]
    ),
  ]);

  const a = agg.rows[0];
  const totalOrders = Number(a.total_orders);
  const paidOrders = Number(a.paid_order_count);
  const lifetimeValue = Number(a.lifetime_value);

  return {
    lifetimeValue,
    totalOrders,
    avgOrderValue: paidOrders > 0 ? lifetimeValue / paidOrders : 0,
    completedOrders: Number(a.completed_orders),
    cancelledOrders: Number(a.cancelled_orders),
    refundCount: refunds.rows[0].c,
    lastOrderDate: jIso(a.last_order_date),
    lastConversationAt: jIso(lastConv.rows[0].last_conv),
    avgResponseTimeSeconds: resp.rows[0].avg_response_seconds != null ? Math.round(Number(resp.rows[0].avg_response_seconds)) : null,
  };
}

// ---------------------------------------------------------------
// Section 4 — recent orders across every connected channel
// ---------------------------------------------------------------
export async function getRecentOrders(tenantId: string, customerId: string, limit = 10) {
  const orders = await query(
    `SELECT id, channel, customer_ref, status, total_amount, discount_amount, coupon_code, created_at, updated_at
       FROM bms_orders WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC LIMIT $3`,
    [tenantId, customerId, Math.min(Math.max(limit, 1), 50)]
  );
  const ids = orders.rows.map((o: any) => o.id);
  if (ids.length === 0) return [];

  const [items, payments, shipments] = await Promise.all([
    query(
      `SELECT order_id, product_sku, size, qty, unit_price FROM bms_order_items
        WHERE order_id = ANY($1::uuid[]) ORDER BY id`,
      [ids]
    ),
    query(
      `SELECT DISTINCT ON (order_id) order_id, status, method, created_at
         FROM bms_payments WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
        ORDER BY order_id, created_at DESC`,
      [tenantId, ids]
    ),
    query(
      `SELECT DISTINCT ON (order_id) order_id, status, carrier, tracking_no, created_at
         FROM bms_shipments WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
        ORDER BY order_id, created_at DESC`,
      [tenantId, ids]
    ),
  ]);

  const itemsByOrder = new Map<string, any[]>();
  for (const it of items.rows) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push({ sku: it.product_sku, size: it.size, qty: it.qty, unitPrice: Number(it.unit_price) });
    itemsByOrder.set(it.order_id, list);
  }
  const paymentByOrder = new Map(payments.rows.map((p: any) => [p.order_id, p]));
  const shipmentByOrder = new Map(shipments.rows.map((s: any) => [s.order_id, s]));

  return orders.rows.map((o: any) => {
    const pay = paymentByOrder.get(o.id) as any;
    const ship = shipmentByOrder.get(o.id) as any;
    return {
      id: o.id,
      channel: o.channel,
      status: o.status,
      createdAt: jIso(o.created_at),
      totalAmount: Number(o.total_amount),
      discountAmount: Number(o.discount_amount ?? 0),
      couponCode: o.coupon_code ?? null,
      items: itemsByOrder.get(o.id) ?? [],
      paymentStatus: pay?.status ?? null,
      paymentMethod: pay?.method ?? null,
      shipmentStatus: ship?.status ?? null,
      carrier: ship?.carrier ?? null,
      trackingNo: ship?.tracking_no ?? null,
    };
  });
}

// ---------------------------------------------------------------
// Section 5 — products purchased
// ---------------------------------------------------------------
export async function getCustomerProducts(tenantId: string, customerId: string, limit = 5) {
  const res = await query(
    `SELECT oi.product_sku AS sku, p.name, p.category,
            SUM(oi.qty)::int AS qty,
            SUM(oi.qty * oi.unit_price) AS revenue,
            MAX(o.created_at) AS last_purchased_at,
            COUNT(DISTINCT o.id)::int AS order_count
       FROM bms_order_items oi
       JOIN bms_orders o ON o.id = oi.order_id
       JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND o.customer_id = $2 AND o.status = ANY($3)
      GROUP BY oi.product_sku, p.name, p.category`,
    [tenantId, customerId, PAID_STATUSES]
  );

  const rows = res.rows.map((r: any) => ({
    sku: r.sku, name: r.name, category: r.category ?? null,
    qty: r.qty, revenue: Number(r.revenue),
    lastPurchasedAt: jIso(r.last_purchased_at), orderCount: r.order_count,
  }));

  const byQty = [...rows].sort((a, b) => b.qty - a.qty).slice(0, limit);
  const byRecent = [...rows].sort((a, b) => (a.lastPurchasedAt! < b.lastPurchasedAt! ? 1 : -1)).slice(0, limit);
  const byFrequency = [...rows].sort((a, b) => b.orderCount - a.orderCount).slice(0, limit);

  const catQty = new Map<string, number>();
  for (const r of rows) {
    if (!r.category) continue;
    catQty.set(r.category, (catQty.get(r.category) ?? 0) + r.qty);
  }
  const favoriteCategories = [...catQty.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, qty]) => ({ category, qty }));

  return { topPurchased: byQty, recentlyPurchased: byRecent, frequentlyPurchased: byFrequency, favoriteCategories };
}

// ---------------------------------------------------------------
// Section 6 — current shopping cart
// ไม่มีสถานะ DRAFT แยกในสคีมา (ดู CLAUDE.local.md) — ใช้ order PENDING
// ล่าสุดที่ยังไม่มี payment ผูกอยู่แทน "ตะกร้า"
// ---------------------------------------------------------------
export async function getDraftOrder(tenantId: string, customerId: string) {
  const res = await query(
    `SELECT o.id, o.channel, o.total_amount, o.discount_amount, o.coupon_code, o.created_at
       FROM bms_orders o
      WHERE o.tenant_id = $1 AND o.customer_id = $2 AND o.status = 'PENDING'
        AND NOT EXISTS (SELECT 1 FROM bms_payments p WHERE p.order_id = o.id)
      ORDER BY o.created_at DESC LIMIT 1`,
    [tenantId, customerId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const items = await query(
    `SELECT product_sku, size, qty, unit_price FROM bms_order_items WHERE order_id = $1 ORDER BY id`,
    [row.id]
  );
  return {
    id: row.id,
    channel: row.channel,
    createdAt: jIso(row.created_at),
    totalAmount: Number(row.total_amount),
    discountAmount: Number(row.discount_amount ?? 0),
    couponCode: row.coupon_code ?? null,
    items: items.rows.map((it: any) => ({ sku: it.product_sku, size: it.size, qty: it.qty, unitPrice: Number(it.unit_price) })),
  };
}

// ---------------------------------------------------------------
// Section 7 — notes across every conversation this customer has
// (bms_conversation_notes อยู่ระดับแชทเดียว — รวมข้ามแชททั้งหมดของลูกค้า)
// ---------------------------------------------------------------
export async function getCustomerNotes(tenantId: string, customerId: string) {
  const res = await query(
    `SELECT n.id, n.conversation_id, n.author, n.body, n.created_at
       FROM bms_conversation_notes n
       JOIN bms_conversations c ON c.id = n.conversation_id
      WHERE c.tenant_id = $1 AND c.customer_id = $2
      ORDER BY n.created_at DESC`,
    [tenantId, customerId]
  );
  return res.rows.map((r: any) => ({
    id: String(r.id), conversationId: r.conversation_id, author: r.author, body: r.body, createdAt: jIso(r.created_at),
  }));
}

// ---------------------------------------------------------------
// Section 7.5 — customer coupon wallet (assigned / claimed /
// reserved / redeemed / expired / revoked)
// ---------------------------------------------------------------
export async function getCustomerCoupons(tenantId: string, customerId: string) {
  return listCustomerCouponWallet(tenantId, { customerId });
}

// ---------------------------------------------------------------
// getCustomer360 — combined eager read (Sections 1–7)
// ---------------------------------------------------------------
export async function getCustomer360(
  tenantId: string,
  customerId: string,
  opts?: { channel?: string | null; customerRef?: string | null }
) {
  const activeCustomerId = await resolveActiveCustomerId(tenantId, customerId, opts);
  if (!activeCustomerId) {
    return {
      customer: null,
      identities: [],
      addresses: [],
      stats: {
        lifetimeValue: 0,
        totalOrders: 0,
        avgOrderValue: 0,
        completedOrders: 0,
        cancelledOrders: 0,
        refundCount: 0,
        lastOrderDate: null,
        lastConversationAt: null,
        avgResponseTimeSeconds: null,
      },
      recentOrders: [],
      products: { topPurchased: [], recentlyPurchased: [], frequentlyPurchased: [], favoriteCategories: [] },
      draftOrder: null,
      notes: [],
      coupons: [],
    };
  }

  const [profile, stats, recentOrders, products, draftOrder, notes, coupons] = await Promise.all([
    getCustomerProfile(tenantId, activeCustomerId),
    getCustomerStatistics(tenantId, activeCustomerId),
    getRecentOrders(tenantId, activeCustomerId, 10),
    getCustomerProducts(tenantId, activeCustomerId, 5),
    getDraftOrder(tenantId, activeCustomerId),
    getCustomerNotes(tenantId, activeCustomerId),
    getCustomerCoupons(tenantId, activeCustomerId),
  ]);

  return {
    customer: profile.customer,
    identities: profile.identities,
    addresses: profile.addresses,
    stats,
    recentOrders,
    products,
    draftOrder,
    notes,
    coupons,
  };
}

// ---------------------------------------------------------------
// Section 8 — timeline (lazy, expensive — every conversation + every
// order/shipment/refund/note for this customer, merged chronologically)
// ---------------------------------------------------------------
export async function getCustomerTimeline(tenantId: string, customerId: string) {
  const cust = await query(`SELECT created_at FROM bms_customers WHERE tenant_id = $1 AND id = $2`, [tenantId, customerId]);
  if (cust.rowCount === 0) return [];

  const orders = await query(
    `SELECT id, channel, status, total_amount, created_at FROM bms_orders
      WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at`,
    [tenantId, customerId]
  );
  const orderIds = orders.rows.map((o: any) => o.id);

  const [audit, shipments, refunds, notes, aiSummary] = await Promise.all([
    orderIds.length
      ? query(
          `SELECT actor, action, target, created_at FROM bms_audit_log
            WHERE tenant_id = $1 AND target = ANY($2::text[]) AND action LIKE 'order.%'
            ORDER BY created_at`,
          [tenantId, orderIds]
        )
      : Promise.resolve({ rows: [] as any[] }),
    orderIds.length
      ? query(
          `SELECT order_id, carrier, tracking_no, status, created_at FROM bms_shipments
            WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]) ORDER BY created_at`,
          [tenantId, orderIds]
        )
      : Promise.resolve({ rows: [] as any[] }),
    orderIds.length
      ? query(
          `SELECT order_id, amount, created_at FROM bms_payments
            WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]) AND status = 'REFUNDED' ORDER BY created_at`,
          [tenantId, orderIds]
        )
      : Promise.resolve({ rows: [] as any[] }),
    getCustomerNotes(tenantId, customerId),
    query(`SELECT generated_at FROM bms_customer_ai_summary WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, customerId]),
  ]);

  const shortId = (id: string) => id.slice(0, 8);
  const entries: { type: string; at: string; text: string; ref: string | null }[] = [
    { type: "CUSTOMER_REGISTERED", at: jIso(cust.rows[0].created_at)!, text: "ลูกค้าลงทะเบียนในระบบ", ref: null },
  ];

  const firstPaid = orders.rows.filter((o: any) => PAID_STATUSES.includes(o.status)).sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1))[0];
  if (firstPaid) {
    entries.push({ type: "FIRST_PURCHASE", at: jIso(firstPaid.created_at)!, text: `ซื้อครั้งแรก · ออเดอร์ ${shortId(firstPaid.id)}`, ref: shortId(firstPaid.id) });
  }
  for (const o of orders.rows) {
    entries.push({ type: "ORDER", at: jIso(o.created_at)!, text: `สร้างออเดอร์ ${shortId(o.id)} (${o.channel}) → PENDING`, ref: shortId(o.id) });
  }
  for (const r of audit.rows as any[]) {
    entries.push({ type: "ORDER", at: jIso(r.created_at)!, text: `ออเดอร์ ${shortId(r.target)} — ${r.action}`, ref: shortId(r.target) });
  }
  for (const s of shipments.rows as any[]) {
    const track = s.tracking_no ? ` · เลขพัสดุ ${s.tracking_no}` : "";
    entries.push({ type: "SHIPMENT", at: jIso(s.created_at)!, text: `พัสดุ ${s.carrier} — ${s.status}${track}`, ref: shortId(s.order_id) });
  }
  for (const r of refunds.rows as any[]) {
    entries.push({ type: "REFUND", at: jIso(r.created_at)!, text: `คืนเงิน ${Number(r.amount).toLocaleString()} ฿ · ออเดอร์ ${shortId(r.order_id)}`, ref: shortId(r.order_id) });
  }
  for (const n of notes as any[]) {
    entries.push({ type: "NOTE", at: n.createdAt!, text: n.body, ref: n.author });
  }
  if (aiSummary.rows[0]) {
    entries.push({ type: "AI_SUMMARY", at: jIso(aiSummary.rows[0].generated_at)!, text: "สร้างสรุป AI Insights", ref: null });
  }

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return entries;
}

// ---------------------------------------------------------------
// Section 9 — AI Insights (facts-only, cached, advisory — never
// invents numbers; same pattern as verifyPaymentSlip/claudeReadSlip
// in payments.ts: raw fetch, BMS_AI_MODEL, fallback template on error)
// ---------------------------------------------------------------
type CustomerFacts = {
  name: string;
  tags: string[];
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  refundCount: number;
  lifetimeValue: number;
  avgOrderValue: number;
  lastOrderDate: string | null;
  topProduct: { name: string; qty: number } | null;
  purchaseCadenceDays: number | null;
};

function hashFacts(facts: CustomerFacts): string {
  return crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

function templateSummary(facts: CustomerFacts): string {
  const lines = [
    `- ลูกค้ามีออเดอร์ทั้งหมด ${facts.totalOrders} ครั้ง (สำเร็จ ${facts.completedOrders}, ยกเลิก ${facts.cancelledOrders}, คืนเงิน ${facts.refundCount})`,
    `- ยอดใช้จ่ายสะสม ${facts.lifetimeValue.toLocaleString()} บาท เฉลี่ยออเดอร์ละ ${Math.round(facts.avgOrderValue).toLocaleString()} บาท`,
  ];
  if (facts.topProduct) lines.push(`- สินค้าที่ซื้อบ่อยที่สุด: ${facts.topProduct.name} (${facts.topProduct.qty} ชิ้น)`);
  if (facts.purchaseCadenceDays) lines.push(`- ความถี่การซื้อโดยเฉลี่ย ~${facts.purchaseCadenceDays} วัน/ครั้ง`);
  if (facts.lastOrderDate) lines.push(`- ออเดอร์ล่าสุดเมื่อ ${facts.lastOrderDate.slice(0, 10)}`);
  if (facts.tags.length) lines.push(`- แท็ก: ${facts.tags.join(", ")}`);
  return lines.join("\n");
}

async function claudeSummarize(facts: CustomerFacts): Promise<string> {
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
        "คุณช่วยแอดมินร้านค้าสรุปพฤติกรรมลูกค้าเป็นภาษาไทย แบบ bullet สั้นๆ " +
        "ใช้ข้อมูลที่ให้เท่านั้น ห้ามเดา/แต่งตัวเลขหรือข้อเท็จจริงที่ไม่มีในข้อมูล " +
        "ถ้าจะแนะนำการกระทำ ต้องอ้างอิงจากข้อมูลที่ให้เท่านั้น (เช่น สินค้าที่ซื้อบ่อย, ความถี่การซื้อ) " +
        "ห้ามแนะนำสิ่งที่ไม่มีข้อมูลรองรับ",
      messages: [
        {
          role: "user",
          content: `ข้อมูลลูกค้า (JSON): ${JSON.stringify(facts)}\n\nสรุปเป็น bullet ภาษาไทย พร้อมคำแนะนำ 1 ข้อถ้ามีข้อมูลรองรับ`,
        },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const json = (await resp.json()) as { content?: Array<{ text?: string }> };
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error("Claude empty reply");
  return text;
}

async function buildCustomerFacts(tenantId: string, customerId: string): Promise<CustomerFacts | null> {
  const [profile, stats, products] = await Promise.all([
    getCustomerProfile(tenantId, customerId),
    getCustomerStatistics(tenantId, customerId),
    getCustomerProducts(tenantId, customerId, 1),
  ]);
  if (!profile.customer) return null;

  let purchaseCadenceDays: number | null = null;
  if (stats.totalOrders > 1 && profile.customer.createdAt && stats.lastOrderDate) {
    const spanDays = (new Date(stats.lastOrderDate).getTime() - new Date(profile.customer.createdAt).getTime()) / 86_400_000;
    purchaseCadenceDays = spanDays > 0 ? Math.round(spanDays / stats.totalOrders) : null;
  }

  return {
    name: profile.customer.name,
    tags: profile.customer.tags,
    totalOrders: stats.totalOrders,
    completedOrders: stats.completedOrders,
    cancelledOrders: stats.cancelledOrders,
    refundCount: stats.refundCount,
    lifetimeValue: stats.lifetimeValue,
    avgOrderValue: stats.avgOrderValue,
    lastOrderDate: stats.lastOrderDate,
    topProduct: products.topPurchased[0] ? { name: products.topPurchased[0].name, qty: products.topPurchased[0].qty } : null,
    purchaseCadenceDays,
  };
}

export async function getCustomerInsights(tenantId: string, customerId: string) {
  const facts = await buildCustomerFacts(tenantId, customerId);
  if (!facts) return null;
  const factsHash = hashFacts(facts);

  const cached = await query(
    `SELECT summary, facts_hash, generated_at FROM bms_customer_ai_summary
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  );
  if (cached.rowCount && cached.rows[0].facts_hash === factsHash) {
    const row = cached.rows[0];
    return { summary: row.summary.text as string, generatedAt: jIso(row.generated_at), cached: true };
  }

  const summaryText = process.env.ANTHROPIC_API_KEY
    ? await claudeSummarize(facts).catch((err) => {
        console.error("[BMS] customer insight AI failed, fallback to template:", err);
        return templateSummary(facts);
      })
    : templateSummary(facts);

  const generatedAt = new Date().toISOString();
  await query(
    `INSERT INTO bms_customer_ai_summary (tenant_id, customer_id, summary, facts_hash, generated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (customer_id) DO UPDATE SET summary = $3, facts_hash = $4, generated_at = now(), tenant_id = $1`,
    [tenantId, customerId, JSON.stringify({ text: summaryText }), factsHash]
  );

  return { summary: summaryText, generatedAt, cached: false };
}
