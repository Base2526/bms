// apps/web/lib/bms/devSeed.ts
// =============================================================
// Dev fake-data seeding — logic เดียวกับที่ apps/web/app/api/dev/fake/*
// เคยเขียนแยกไว้ในแต่ละ route (INSERT ตรงตัวเดียวกัน) ย้ายมารวมที่นี่เพื่อให้
// ทั้ง route เดิม (seed ลงร้านตัวเอง ผ่าน HTTP) และ provisionTestShop()
// (seed ลงร้านทดสอบใหม่ที่เพิ่งสร้าง ผ่านการเรียกฟังก์ชันตรง ๆ ไม่มี HTTP hop)
// ใช้ implementation เดียวกัน ไม่ต้อง duplicate SQL
//
// marker เดิมทั้งหมดคงไว้ (SKU 'FAKE-', customer_ref 'FAKE-', tag 'fake', ฯลฯ)
// เพื่อให้ /api/dev/fake/cleanup ลบออกได้เหมือนเดิมไม่ว่าจะ seed จากทางไหน
// =============================================================

import { getClient, query } from "@/lib/db";
import { listAutoAssignPool } from "./inbox";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const R = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[R(a.length)];
const short = () => Math.random().toString(36).slice(2, 10);
const sample = <T,>(a: T[], k: number): T[] => {
  const c = [...a];
  const out: T[] = [];
  for (let j = 0; j < k && c.length; j++) out.push(c.splice(R(c.length), 1)[0]);
  return out;
};

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

export async function seedFakeProducts(tenantId: string, count: number) {
  const sql = `
    WITH gen AS (
      SELECT
        'FAKE-' || substr(md5(random()::text || g::text || clock_timestamp()::text), 1, 12) AS sku,
        g,
        (100 + floor(random() * 4900))::numeric(12,2) AS price,
        (ARRAY['เสื้อผ้า','รองเท้า','เครื่องประดับ','กระเป๋า','อุปกรณ์กีฬา'])[1 + floor(random() * 5)::int] AS category,
        (ARRAY['Nike','Adidas','Uniqlo','Zara','No Brand'])[1 + floor(random() * 5)::int] AS brand
      FROM generate_series(1, $2) g
    ),
    np AS (
      INSERT INTO bms_products (tenant_id, sku, name, active, price, keywords, image_url, description, cost_price, category, brand)
      SELECT $1, sku, 'Fake Product ' || g, true, price, ARRAY['fake','test'],
             'https://picsum.photos/seed/' || sku || '/400/400',
             'สินค้าทดสอบสำหรับ demo/QA (สร้างโดยระบบอัตโนมัติ) — Fake Product ' || g,
             (price * (0.4 + random() * 0.3))::numeric(12,2),
             category, brand
        FROM gen
      RETURNING sku, name, price
    ),
    inv AS (
      INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock, reorder_point)
      SELECT $1, np.sku, s.size, floor(random() * 50)::int, 0, 5
        FROM np CROSS JOIN (VALUES ('S'),('M'),('L'),('XL')) AS s(size)
      RETURNING 1
    )
    SELECT sku, name, price FROM np ORDER BY sku`;
  const { rows } = await query(sql, [tenantId, count]);
  return rows;
}

export async function seedFakeCustomers(tenantId: string, count: number) {
  const tags = ["VIP", "ลูกค้าใหม่", "ลูกค้าประจำ"];
  const sql = `
    INSERT INTO bms_customers (tenant_id, name, phone, tags)
    SELECT $1,
           'Fake Customer ' || g,
           '08' || lpad(floor(random() * 100000000)::bigint::text, 8, '0'),
           ARRAY['fake', ($3::text[])[1 + floor(random() * array_length($3::text[], 1))::int]]
      FROM generate_series(1, $2) g
    RETURNING id, name, phone, tags`;
  const { rows } = await query(sql, [tenantId, count, tags]);
  return rows;
}

const CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"];
const RESTOCK_CHANNELS = ["line", "facebook", "instagram"] as const;

export async function seedFakeOrders(tenantId: string, count: number) {
  const DAYS = 30;
  const STATUS_POOL = ["COMPLETED", "COMPLETED", "COMPLETED", "PAID", "PAID", "SHIPPED", "SHIPPED", "CANCELLED", "RETURNED"];
  const METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH"];
  const CARRIERS = ["FLASH", "KERRY", "DHL", "AUSPOST", "NZPOST"];
  const PAID_SET = new Set(["PAID", "SHIPPED", "COMPLETED"]);
  const SHIP_SET = new Set(["SHIPPED", "COMPLETED"]);

  const variants = (await query(
    `SELECT i.product_sku AS sku, i.size, p.price
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1 AND p.active
      ORDER BY (p.sku LIKE 'FAKE-%') DESC, random()
      LIMIT 500`,
    [tenantId]
  )).rows;
  if (variants.length === 0) throw new Error("ยังไม่มีสินค้า — สร้าง BMS Products ก่อน");

  const customers = (await query(
    `SELECT id FROM bms_customers WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY ('fake' = ANY(tags)) DESC, random() LIMIT 500`,
    [tenantId]
  )).rows;

  const orders: any[][] = [];
  const items: any[][] = [];
  const payments: any[][] = [];
  const shipments: any[][] = [];

  for (let i = 0; i < count; i++) {
    const id = uuid();
    const status = pick(STATUS_POOL);
    const channel = pick(CHANNELS);
    const created = new Date(Date.now() - R(DAYS) * 864e5 - R(86400) * 1000);
    const iso = created.toISOString();
    const customerId = customers.length ? pick(customers).id : null;

    const chosen = sample(variants, 1 + R(3));
    let total = 0;
    for (const v of chosen) {
      const qty = 1 + R(3);
      total += Number(v.price) * qty;
      items.push([tenantId, id, v.sku, v.size, qty, v.price]);
    }
    orders.push([tenantId, id, channel, "FAKE-" + short(), customerId, status, total.toFixed(2), iso, iso]);

    if (PAID_SET.has(status)) {
      payments.push([tenantId, id, pick(METHODS), total.toFixed(2), "CONFIRMED", "seed@fake", iso]);
    }
    if (SHIP_SET.has(status)) {
      shipments.push([tenantId, id, pick(CARRIERS), "TH" + short().toUpperCase(), status === "COMPLETED" ? "DELIVERED" : "SHIPPED", iso]);
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await bulkInsert(client, "bms_orders",
      ["tenant_id", "id", "channel", "customer_ref", "customer_id", "status", "total_amount", "created_at", "updated_at"], orders);
    await bulkInsert(client, "bms_order_items",
      ["tenant_id", "order_id", "product_sku", "size", "qty", "unit_price"], items);
    await bulkInsert(client, "bms_payments",
      ["tenant_id", "order_id", "method", "amount", "status", "verified_by", "created_at"], payments);
    await bulkInsert(client, "bms_shipments",
      ["tenant_id", "order_id", "carrier", "tracking_no", "status", "created_at"], shipments);
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  return {
    created: orders.map((o) => ({ id: o[1], status: o[5], price: Number(o[6]), name: `order ${o[1].slice(0, 8)}` })),
    summary: { orders: orders.length, items: items.length, payments: payments.length, shipments: shipments.length },
  };
}

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

export async function seedFakeConversations(tenantId: string, count: number) {
  const STATUS_POOL = ["OPEN", "OPEN", "PENDING", "CLOSED"];

  const customers = (await query(
    `SELECT id FROM bms_customers WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY ('fake' = ANY(tags)) DESC, random() LIMIT 500`,
    [tenantId]
  )).rows;

  // ทุก conversation ต้องมี staff หลักเสมอ (เหมือน logConversation ของจริง) — bulk insert ตรงๆ
  // เลยต้องมอบหมายเองแบบ round-robin ในพูลเดียวกับ auto-assign จริง
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
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  return {
    created: convs.map((c) => ({ id: c[1], name: `${c[2]} · ${c[3]}`, status: c[5] })),
    summary: { conversations: convs.length, messages: msgs.length },
  };
}

export async function seedFakePurchase(tenantId: string, count: number) {
  const DAYS = 45;
  const STATUS_POOL = ["OPEN", "OPEN", "PARTIAL", "RECEIVED", "RECEIVED", "CANCELLED"];
  const SUPPLIER_NAMES = Array.from({ length: 8 }, (_, i) => `FAKE Supplier ${String(i + 1).padStart(2, "0")}`);

  const variants = (await query(
    `SELECT i.product_sku AS sku, i.size, p.price
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1 AND p.active
      ORDER BY (p.sku LIKE 'FAKE-%') DESC, random()
      LIMIT 500`,
    [tenantId]
  )).rows;
  if (variants.length === 0) throw new Error("ยังไม่มีสินค้า — สร้าง BMS Products ก่อน");

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const supRows: { id: string }[] = [];
    for (const name of SUPPLIER_NAMES) {
      const r = await client.query(
        `INSERT INTO bms_suppliers (tenant_id, name, phone)
         VALUES ($1, $2, '02-000-0000')
         ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [tenantId, name]
      );
      supRows.push({ id: r.rows[0].id });
    }

    const pos: any[][] = [];
    const items: any[][] = [];

    for (let i = 0; i < count; i++) {
      const id = uuid();
      const status = pick(STATUS_POOL);
      const created = new Date(Date.now() - R(DAYS) * 864e5 - R(86400) * 1000);
      const iso = created.toISOString();
      const supplierId = pick(supRows).id;

      const chosen = sample(variants, 1 + R(4));
      let total = 0;
      for (const v of chosen) {
        const qtyOrdered = 10 + R(91);
        const unitCost = Math.max(1, Math.round(Number(v.price) * (0.5 + Math.random() * 0.2)));
        let qtyReceived = 0;
        if (status === "RECEIVED") qtyReceived = qtyOrdered;
        else if (status === "PARTIAL") qtyReceived = Math.max(1, Math.floor(qtyOrdered * (0.2 + Math.random() * 0.6)));
        total += qtyOrdered * unitCost;
        items.push([tenantId, id, v.sku, v.size, qtyOrdered, qtyReceived, unitCost]);
      }
      pos.push([tenantId, id, supplierId, status, total.toFixed(2), `FAKE lot ${created.toISOString().slice(0, 10)}`, iso, iso]);
    }

    await bulkInsert(client, "bms_purchase_orders",
      ["tenant_id", "id", "supplier_id", "status", "total_amount", "note", "created_at", "updated_at"], pos);
    await bulkInsert(client, "bms_purchase_order_items",
      ["tenant_id", "po_id", "product_sku", "size", "qty_ordered", "qty_received", "unit_cost"], items);

    await client.query("COMMIT");

    return {
      created: pos.map((p) => ({ id: p[1], status: p[3], price: Number(p[4]), name: `PO ${p[1].slice(0, 8)}` })),
      summary: { purchaseOrders: pos.length, items: items.length, suppliers: supRows.length },
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

type RestockVariant = {
  sku: string;
  size: string;
  name: string;
};

const RESTOCK_SCENARIOS = [
  "ACTIVE",
  "ACTIVE",
  "ACTIVE",
  "READY_TO_NOTIFY",
  "READY_TO_NOTIFY",
  "NOTIFIED",
  "FAILED",
  "PURCHASED",
  "CANCELLED",
] as const;

function minutesAgo(mins: number) {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

function restockChannelLabel(channel: string) {
  if (channel === "line") return "LINE";
  if (channel === "facebook") return "Facebook";
  if (channel === "instagram") return "Instagram";
  return channel;
}

export async function seedFakeRestockSubscriptions(tenantId: string, count: number) {
  let variants = (await query<RestockVariant>(
    `SELECT i.product_sku AS sku, i.size, p.name
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1 AND p.active
      ORDER BY (p.sku LIKE 'FAKE-%') DESC, random()
      LIMIT 1000`,
    [tenantId]
  )).rows;
  if (variants.length < 8) {
    await seedFakeProducts(tenantId, Math.max(8, Math.ceil((count + 8) / 4)));
    variants = (await query<RestockVariant>(
      `SELECT i.product_sku AS sku, i.size, p.name
         FROM bms_inventory i
         JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
        WHERE i.tenant_id = $1 AND p.active
        ORDER BY (p.sku LIKE 'FAKE-%') DESC, random()
        LIMIT 1000`,
      [tenantId]
    )).rows;
  }

  let customers = (await query<{ id: string; name: string }>(
    `SELECT id, name
       FROM bms_customers
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY ('fake' = ANY(tags)) DESC, random()
      LIMIT 500`,
    [tenantId]
  )).rows;
  if (customers.length < 10) {
    await seedFakeCustomers(tenantId, Math.max(10, Math.min(30, count)));
    customers = (await query<{ id: string; name: string }>(
      `SELECT id, name
         FROM bms_customers
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY ('fake' = ANY(tags)) DESC, random()
        LIMIT 500`,
      [tenantId]
    )).rows;
  }

  if (!variants.length) throw new Error("ยังไม่มีสินค้า — สร้าง BMS Products ก่อน");
  if (!customers.length) throw new Error("ยังไม่มีลูกค้า — สร้าง BMS Customers ก่อน");

  const shuffled = [...variants].sort(() => Math.random() - 0.5);
  const splitAt = Math.max(1, Math.floor(shuffled.length / 2));
  const inStockPool = shuffled.slice(0, splitAt);
  const outOfStockPool = shuffled.slice(splitAt);
  const inPool = inStockPool.length ? inStockPool : shuffled;
  const outPool = outOfStockPool.length ? outOfStockPool : shuffled;

  const staffPool = await listAutoAssignPool(tenantId);
  const convs: any[][] = [];
  const msgs: any[][] = [];
  const identities: any[][] = [];
  const subs: any[][] = [];
  const deliveries: Array<{ subscriptionId: string; channel: string; body: string; status: "SENT" | "FAILED"; error: string | null; triggeredBy: string; createdAt: string; completedAt: string }> = [];
  const createdConversations: Array<{ id: string; customerId: string; customerName: string; customerRef: string; channel: string }> = [];
  const inStockKeys = new Set<string>();
  const outOfStockKeys = new Set<string>();

  for (let i = 0; i < count; i++) {
    const scenario = pick([...RESTOCK_SCENARIOS]);
    const requiresStock = scenario === "READY_TO_NOTIFY" || scenario === "NOTIFIED" || scenario === "FAILED" || scenario === "PURCHASED";
    const variant = pick(requiresStock ? inPool : outPool);
    const variantKey = `${variant.sku}::${variant.size}`;
    if (requiresStock) inStockKeys.add(variantKey);
    else outOfStockKeys.add(variantKey);

    let conversation = createdConversations.length && i % 5 === 4 ? pick(createdConversations) : null;
    if (!conversation) {
      const customer = pick(customers);
      const channel = pick([...RESTOCK_CHANNELS]);
      const customerRef = `FAKE-RS-${short().toUpperCase()}`;
      const conversationId = uuid();
      const assignedToUserId = staffPool.length ? staffPool[i % staffPool.length] : null;
      const createdAt = minutesAgo(60 + R(60 * 24 * 10));
      const productHint = pick(outPool);
      const script = [
        `มี ${productHint.name} ไซซ์ ${productHint.size} ไหมครับ`,
        `ตอนนี้ ${productHint.name} ไซซ์ ${productHint.size} หมดชั่วคราวค่ะ`,
        `ถ้าของเข้าแล้วให้ร้านแจ้งกลับได้ไหมคะ`,
        `ได้ครับ ถ้าเข้าแล้วรบกวนทักมาหน่อย`,
        `รับทราบค่ะ ถ้าของเข้าแล้วจะรีบแจ้งทันที`,
      ];
      convs.push([
        tenantId,
        conversationId,
        channel,
        customerRef,
        customer.id,
        "OPEN",
        ["fake", "restock"],
        0,
        script[script.length - 1].slice(0, 500),
        createdAt,
        assignedToUserId,
      ]);
      script.forEach((body, idx) => {
        msgs.push([
          tenantId,
          conversationId,
          idx % 2 === 0 ? "IN" : "OUT",
          body,
          idx % 2 === 0 ? "customer" : "ai",
          new Date(new Date(createdAt).getTime() - (script.length - idx) * 60_000).toISOString(),
        ]);
      });
      identities.push([tenantId, customer.id, channel, customerRef, customer.name]);
      conversation = { id: conversationId, customerId: customer.id, customerName: customer.name, customerRef, channel };
      createdConversations.push(conversation);
    } else {
      msgs.push([
        tenantId,
        conversation.id,
        "IN",
        `ถ้า ${variant.name} ไซซ์ ${variant.size} ของเข้าแล้ว รบกวนแจ้งด้วยนะครับ`,
        "customer",
        minutesAgo(30 + R(60 * 24 * 4)),
      ]);
      msgs.push([
        tenantId,
        conversation.id,
        "OUT",
        `ได้เลยค่ะ ถ้า ${variant.name} ไซซ์ ${variant.size} เข้ามาแล้ว ร้านจะแจ้งผ่าน ${restockChannelLabel(conversation.channel)} ให้อีกครั้งค่ะ`,
        "ai",
        minutesAgo(29 + R(60 * 24 * 4)),
      ]);
    }

    const subscriptionId = uuid();
    const consentedAt = minutesAgo(20 + R(60 * 24 * 7));
    const readyAt = requiresStock ? minutesAgo(5 + R(60 * 24 * 2)) : null;
    const lastNotifiedAt = scenario === "NOTIFIED" || scenario === "PURCHASED" ? minutesAgo(3 + R(60 * 24)) : null;
    const resolvedAt = scenario === "PURCHASED" || scenario === "CANCELLED" ? minutesAgo(1 + R(60 * 12)) : null;
    const status = scenario === "FAILED" ? "READY_TO_NOTIFY" : scenario;
    const requestedQty = 1 + R(3);

    subs.push([
      subscriptionId,
      tenantId,
      conversation.id,
      conversation.customerId,
      conversation.channel,
      conversation.customerRef,
      variant.sku,
      variant.size,
      requestedQty,
      status,
      i % 4 === 0 ? "ADMIN" : "AI_CHAT",
      consentedAt,
      readyAt,
      lastNotifiedAt,
      resolvedAt,
      `dev:fake:${scenario.toLowerCase()}`,
      consentedAt,
      resolvedAt || lastNotifiedAt || readyAt || consentedAt,
    ]);

    if (scenario === "NOTIFIED" || scenario === "FAILED" || scenario === "PURCHASED") {
      const body = `${variant.name} (${variant.sku}) ไซซ์ ${variant.size} เข้ามาแล้วค่ะ ตอนนี้มีพร้อมขาย ${scenario === "FAILED" ? 2 : 6} ชิ้น สนใจให้ร้านช่วยสั่งให้ไหมคะ`;
      const createdAt = lastNotifiedAt || readyAt || consentedAt;
      deliveries.push({
        subscriptionId,
        channel: conversation.channel,
        body,
        status: scenario === "FAILED" ? "FAILED" : "SENT",
        error: scenario === "FAILED" ? "Fake send failure for QA review" : null,
        triggeredBy: scenario === "FAILED" ? "dev:fake:send-error" : "dev:fake:send-success",
        createdAt,
        completedAt: createdAt,
      });
    }
  }

  const outboxMessageIds = new Map<string, string>();
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await bulkInsert(client, "bms_conversations",
      ["tenant_id", "id", "channel", "customer_ref", "customer_id", "status", "tags", "unread", "last_message", "last_message_at", "assigned_to_user_id"], convs);
    await bulkInsert(client, "bms_messages",
      ["tenant_id", "conversation_id", "direction", "body", "sender", "created_at"], msgs);
    await bulkInsert(client, "bms_customer_identities",
      ["tenant_id", "customer_id", "channel", "external_ref", "display_name"], identities);
    await bulkInsert(client, "bms_restock_subscriptions",
      ["id", "tenant_id", "conversation_id", "customer_id", "channel", "customer_ref", "product_sku", "size", "requested_qty", "status", "source", "consented_at", "ready_at", "last_notified_at", "resolved_at", "created_by", "created_at", "updated_at"], subs);

    for (const item of deliveries) {
      if (item.status === "SENT") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta, created_at)
           SELECT tenant_id, conversation_id, 'OUT', $3, 'staff:dev-fake', '{"delivered":true,"status":"SENT","fake":true}'::jsonb, $4
             FROM bms_restock_subscriptions
            WHERE id = $1 AND tenant_id = $2
           RETURNING id`,
          [item.subscriptionId, tenantId, item.body, item.createdAt]
        );
        if (inserted.rows[0]?.id) outboxMessageIds.set(item.subscriptionId, String(inserted.rows[0].id));
      }
    }

    for (let i = 0; i < deliveries.length; i++) {
      const item = deliveries[i];
      await client.query(
        `INSERT INTO bms_restock_deliveries
           (tenant_id, subscription_id, attempt_no, channel, body, status, inbox_message_id, error, triggered_by, created_at, completed_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tenantId,
          item.subscriptionId,
          item.channel,
          item.body,
          item.status,
          outboxMessageIds.get(item.subscriptionId) ?? null,
          item.error,
          item.triggeredBy,
          item.createdAt,
          item.completedAt,
        ]
      );
    }

    for (const key of outOfStockKeys) {
      const [sku, size] = key.split("::");
      await client.query(
        `UPDATE bms_inventory
            SET current_stock = 0, reserved_stock = 0, reorder_point = GREATEST(reorder_point, 3)
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
        [tenantId, sku, size]
      );
    }
    for (const key of inStockKeys) {
      const [sku, size] = key.split("::");
      await client.query(
        `UPDATE bms_inventory
            SET current_stock = $4, reserved_stock = 0, reorder_point = GREATEST(reorder_point, 3)
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
        [tenantId, sku, size, 2 + R(10)]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  const statusSummary = subs.reduce<Record<string, number>>((acc, row) => {
    acc[row[9]] = (acc[row[9]] || 0) + 1;
    return acc;
  }, {});

  return {
    created: subs.map((s) => ({
      id: s[0],
      name: `${s[6]} · ${s[7]} · ${s[4]}`,
      status: s[9],
    })),
    summary: {
      restockSubscriptions: subs.length,
      restockDeliveries: deliveries.length,
      restockConversations: convs.length,
      ...statusSummary,
    },
  };
}

const FAKE_STAFF_ROLES = ["Sales", "Warehouse"];

export async function seedFakeStaff(tenantId: string, count: number, generatedBy?: string | number) {
  const password_hash = await bcrypt.hash("password123", 10);
  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = nanoid(5);
    const name = `Fake Staff ${suffix}`;
    const email = `fake-staff+${suffix}@example.test`;
    const phone = `08${Math.floor(10000000 + Math.random() * 90000000)}`;
    const role = FAKE_STAFF_ROLES[Math.floor(Math.random() * FAKE_STAFF_ROLES.length)];
    const meta = JSON.stringify({ generated_by: generatedBy ?? "internal", env: process.env.NODE_ENV });

    const { rows } = await query(
      `INSERT INTO users (name, email, phone, role, password_hash, meta, fake_test, tenant_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, true, $7, NOW()) RETURNING id, name, email, phone, role, created_at`,
      [name, email, phone, role, password_hash, meta, tenantId]
    );
    created.push(rows[0]);
  }
  return created;
}

// marker: note ขึ้นต้น 'FAKE' → cleanup ลบได้ (เหมือน PO) · code สุ่มด้วย 'FAKE' + short() กันชนกัน
// เวลา seed ซ้ำ (UNIQUE tenant_id, code — ON CONFLICT DO NOTHING เผื่อชนพอดี ไม่ throw ทั้ง batch)
export async function seedFakeCoupons(tenantId: string, count: number) {
  const now = Date.now();
  const PERCENT_VALUES = [5, 10, 15, 20, 30];
  const FIXED_VALUES = [20, 50, 100, 150, 200];
  const MIN_ORDER_POOL: (number | null)[] = [null, null, 300, 500, 1000];

  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const isPercent = R(2) === 0;
    const type = isPercent ? "PERCENT" : "FIXED";
    const value = isPercent ? pick(PERCENT_VALUES) : pick(FIXED_VALUES);
    const minOrderAmount = pick(MIN_ORDER_POOL);
    const maxRedemptions = R(3) === 0 ? null : 10 + R(90);
    const perCustomerLimit = R(3) === 0 ? 1 : null;
    const expiresAt = R(4) === 0 ? null : new Date(now + (7 + R(60)) * 864e5).toISOString();
    const active = R(5) !== 0; // ส่วนใหญ่ active — เหลือส่วนน้อยปิดไว้ทดสอบ UI สถานะปิดใช้งาน
    const code = "FAKE" + short().toUpperCase();

    const { rows } = await query(
      `INSERT INTO bms_coupons (tenant_id, code, type, value, min_order_amount, max_redemptions, per_customer_limit, expires_at, active, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FAKE coupon (dev seed)')
       ON CONFLICT (tenant_id, code) DO NOTHING
       RETURNING id, code, type, value, active`,
      [tenantId, code, type, value, minOrderAmount, maxRedemptions, perCustomerLimit, expiresAt, active]
    );
    if (rows[0]) created.push(rows[0]);
  }
  return created;
}
