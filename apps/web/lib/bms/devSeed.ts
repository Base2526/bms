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
