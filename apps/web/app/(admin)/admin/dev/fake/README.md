**Fake Data** ที่ปลอดภัย (สำหรับใช้ทดสอบ) และให้โค้ดตัวอย่างทั้ง **หน้า UI (Next.js + Antd)** กับ **API routes (Next.js App Router)** ที่สร้างข้อมูลเทียม (users / posts) ให้เลย — คุณสามารถเอาไปวาง ปรับให้เข้ากับโครงโปรเจกต์ได้ทันที

ผมแบ่งเป็น 3 ส่วนสั้น ๆ: แนวคิดความปลอดภัย, API (server) ตัวอย่าง, หน้า UI (client) ตัวอย่าง — ทั้งหมดเป็น TypeScript + Next.js App Router + fetch แบบ `credentials: 'include'` (ถ้าจำเป็น)

---

## ✅ BMS Fake Data (สร้างจำนวนมากเพื่อทดสอบ)

เพิ่ม generator สำหรับ **BMS products / customers** (สูงสุด 2000/ครั้ง, insert คิวรี่เดียวด้วย `generate_series`):

| Kind | Endpoint | สร้างอะไร | เติมหน้าจอ | marker |
|---|---|---|---|---|
| `bms-products` | `POST /api/dev/fake/bms-products` | products + inventory S/M/L/XL | Products | SKU `FAKE-` + keyword `fake` |
| `bms-customers` | `POST /api/dev/fake/bms-customers` | customers (ชื่อ/เบอร์/tag สุ่ม) | Customers | tag `fake` |
| `bms-orders` | `POST /api/dev/fake/bms-orders` | orders (backdate 30 วัน, หลายสถานะ/ช่องทาง) + items + payment + shipment | Dashboard, Reports, CRM, Payment, Shipping | customer_ref `FAKE-` |
| `bms-conversations` | `POST /api/dev/fake/bms-conversations` | conversations + messages (บทสนทนาสำเร็จรูป) | Inbox | customer_ref `FAKE-` + tag `fake` |
| `bms-purchase` | `POST /api/dev/fake/bms-purchase` | suppliers + PO + items (หลายสถานะ OPEN/PARTIAL/RECEIVED/CANCELLED) | Purchase | PO note `FAKE%` + supplier `FAKE %` |
| `bms-ai-usage` | `POST /api/dev/fake/bms-ai-usage` | เพิ่มตัวนับ AI shared-key quota ของเดือนนี้ | Settings | แก้ `bms_ai_usage_monthly` โดยตรง |

**ลำดับแนะนำ:** Products → Customers → Orders → Conversations → Purchase (Orders/Conversations/Purchase สุ่มจาก products/customers ที่มีอยู่)

- ลงที่ **tenant default** (ส่ง `{ tenantId }` ใน body เพื่อระบุร้านอื่นได้) · สูงสุด 2000/ครั้ง
- **Orders ไม่ขยับสต็อก** (ใช้เติม analytics) — ถ้าจะเทสต์ flow จ่าย/ส่งจริง ให้สั่งผ่าน Playground · สถานะเน้น revenue (COMPLETED/PAID/SHIPPED + CANCELLED/RETURNED)
- **Cleanup** (`DELETE /api/dev/fake/cleanup`) ลบ fake ทั้งหมดตามลำดับ FK: orders + conversations (cascade items/payments/shipments/messages/notes) → products (cascade inventory) → customers · ข้ามตัวที่ยังมี order อ้างถึง
- BMS tables ไม่มีคอลัมน์ `fake_test` จึงใช้ marker `FAKE-` / tag `fake` แทน (ไม่ต้องแก้ schema)

---

## แนวคิดความปลอดภัย (สำคัญ)

1. **ห้ามเปิดหน้า/endpoint นี้ใน production** — ตรวจ `NODE_ENV !== 'production'` หรือ require `INTERNAL_SECRET` / `x-internal` signature / admin cookie ก่อนอนุญาต
2. ควรจำกัดให้เรียกได้เฉพาะผู้ใช้ที่เป็น `Administrator` หรือเรียกจาก server เท่านั้น
3. ล็อกการสร้างข้อมูล (system_logs) เพื่อย้อนกลับได้ถ้าจำเป็น
4. หากต้องการลบข้อมูลที่สร้าง ให้เตรียม endpoint `DELETE /api/dev/fake/cleanup` ที่ล้างเฉพาะเรคอร์ดที่ tag ว่า `fake_test = true` หรือมี `created_by_test = true`

---

## 1) API (server) — ตัวอย่าง route handlers

> เก็บไว้ที่ `apps/web/app/api/dev/fake/posts/route.ts` และ `.../users/route.ts`
> ตัวอย่างด้านล่างใช้ helper `requireAdminOrInternal(req)` ที่เช็ก `verifyAdminSession()` หรือ HMAC internal signature — คุณต้องมีฟังก์ชันพวกนี้ในโปรเจกต์ (ผมใส่ตัวอย่างเช็กง่ายๆ ให้ด้วย)

### helper: ตรวจสิทธิ์ (ตัวอย่าง)

```ts
// apps/web/lib/dev-guards.ts
import { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth"; // จากที่เราเคยทำ
import { verifyInternal } from "@/lib/internal-verify"; // HMAC verify

export function requireAdminOrInternal(req: NextRequest) {
  // server-side cookie check (Next.js server handler)
  const admin = verifyAdminSession();
  if (admin) return { ok: true, actor: admin };

  // หรือถ้ามี internal signature (cron/worker)
  // Note: verifyInternal ต้องการ body text; ตัวอย่างที่ใช้ใน route จะเรียก verifyInternal(req, bodyText)
  return { ok: false, reason: "not admin or internal" };
}
```

### API: สร้าง Posts เทียม

```ts
// apps/web/app/api/dev/fake/posts/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db"; // สมมติมี helper query(pg)
import { nanoid } from "nanoid"; // optional

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });

  const body = await req.json();
  const { count = 5, randomize = true } = body;

  // basic guard: verify admin cookie (server-side) or internal signature
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const title = randomize ? `Test Post ${nanoid(6)}` : `Test Post`;
    const phone = `08${Math.floor(10000000 + Math.random() * 90000000)}`;
    const status = Math.random() > 0.5 ? "public" : "unpublic";
    const content = `Fake content ${new Date().toISOString()}`;

    // ตัวอย่าง insert; ปรับชื่อ table/columns ให้ตรงโปรเจกต์ของคุณ
    const sql = `INSERT INTO posts (title, phone, content, status, author_id, meta, created_at, fake_test)
                 VALUES ($1,$2,$3,$4,$5,$6,NOW(), true) RETURNING *`;
    const author_id = guard.actor?.id || null; // ถ้ามี actor (admin) ให้เป็นผู้สร้าง
    const meta = JSON.stringify({ env: process.env.NODE_ENV, generated_by: guard.actor?.id ?? 'internal' });
    const { rows } = await query(sql, [title, phone, content, status, author_id, meta]);
    created.push(rows[0]);
  }

  return NextResponse.json({ ok: true, created });
}
```

### API: สร้าง Users เทียม

```ts
// apps/web/app/api/dev/fake/users/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { nanoid } from "nanoid";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });

  const body = await req.json();
  const { count = 3 } = body;

  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const name = `Test User ${nanoid(5)}`;
    const email = `test+${nanoid(5)}@example.test`;
    const phone = `08${Math.floor(10000000 + Math.random() * 90000000)}`;
    const role = "Subscriber";
    // Create password_hash same as backend expectation (SHA-256 example)
    const pwd = "password123";
    const password_hash = crypto.createHash('sha256').update(pwd).digest('hex');

    const sql = `INSERT INTO users (name, email, phone, role, password_hash, meta, fake_test, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6, true, NOW()) RETURNING *`;
    const meta = JSON.stringify({ generated_by: guard.actor?.id ?? "internal", env: process.env.NODE_ENV });
    const { rows } = await query(sql, [name, email, phone, role, password_hash, meta]);
    created.push(rows[0]);
  }

  return NextResponse.json({ ok: true, created });
}
```

> **หมายเหตุ**: ปรับ `query` / insert SQL ให้ตรงกับ schema โปรเจกต์คุณ (column ชื่อ `fake_test` เป็นแนวทางแนะนำ — สร้าง column boolean ใน table เพื่อระบุว่าเรคอร์ดมาจากการทดสอบ)

---

## 2) หน้า UI (Next.js + Ant Design) — `apps/web/app/admin/dev/fake/page.tsx` (หรือใต้ `/dev/fake`)

ตัวอย่าง UI ที่มีตัวเลือก (count), dropdown เลือกชนิดข้อมูล, ปุ่มสร้าง, ปุ่ม cleanup, ตารางแสดงผลที่สร้างล่าสุด

```tsx
'use client';
import React, { useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider } from 'antd';

type CreatedRow = any;

export default function DevFakePage() {
  const [kind, setKind] = useState<'posts'|'users'>('posts');
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedRow[]>([]);

  async function doFake() {
    setLoading(true);
    try {
      const res = await fetch(`/api/dev/fake/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
        // ถ้าต้องการส่ง cookie ให้แน่ใจว่า server-side จะอ่าน cookie ได้
        credentials: 'include'
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      message.success(`Created ${j.created?.length || 0} ${kind}`);
      setCreated(prev => [...j.created, ...prev].slice(0, 200));
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally { setLoading(false); }
  }

  async function cleanup() {
    setLoading(true);
    try {
      const res = await fetch('/api/dev/fake/cleanup', { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Cleanup failed');
      message.success(`Deleted ${j.deleted} records`);
      setCreated([]);
    } catch (e:any) {
      message.error(e.message || 'Error');
    } finally { setLoading(false); }
  }

  const cols = [
    { title: 'id', dataIndex:'id', key:'id', width:120 },
    { title: 'title / name', dataIndex:'title', key:'title', render: (_:any, r:any) => r.title || r.name },
    { title: 'phone', dataIndex:'phone', key:'phone' },
    { title: 'status', dataIndex:'status', key:'status' },
    { title: 'created_at', dataIndex:'created_at', key:'created_at' },
  ];

  return (
    <Card title="Dev: Fake Data Generator" extra={<Space>
      <Select value={kind} onChange={(v)=>setKind(v as any)} options={[{label:'Posts',value:'posts'},{label:'Users',value:'users'}]} />
      <InputNumber min={1} max={500} value={count} onChange={(v)=>setCount(v||1)} />
      <Button type="primary" onClick={doFake} loading={loading}>Create</Button>
      <Button danger onClick={cleanup} disabled={loading}>Cleanup</Button>
    </Space>}>
      <p>Use this page only on development/test environments. Must be admin or internal caller.</p>
      <Divider />
      <Table dataSource={created} columns={cols} rowKey="id" />
    </Card>
  );
}
```

---

## 3) Endpoint Cleanup (ลบข้อมูลที่สร้างโดย fake)

```ts
// apps/web/app/api/dev/fake/cleanup/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db";

export async function DELETE(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ตัวอย่างลบเฉพาะ rows ที่เราแทรกด้วย fake_test = true
  const resPosts = await query('DELETE FROM posts WHERE fake_test = true RETURNING id');
  const resUsers = await query('DELETE FROM users WHERE fake_test = true RETURNING id');

  return NextResponse.json({ ok: true, deleted: (resPosts.rows.length + resUsers.rows.length), posts: resPosts.rows.length, users: resUsers.rows.length });
}
```

---

## ข้อเสนอแนะเพิ่มเติม (ประโยชน์)

* เพิ่ม `fake_tag` หรือ `fake_test` column เป็น boolean ในทุก table ที่อาจถูกสร้าง เพื่อให้ cleanup ปลอดภัย
* เพิ่ม `meta.generated_by` (user id หรือ worker) ใน row เพื่อ audit
* เก็บ log ใน `system_logs` ว่าใครกดสร้าง จำนวนเท่าไหร่ และ IP / timestamp
* ทำปุ่ม “generate with fixture” ที่ยิง JSON template (เช่น สร้าง post+user+file) เพื่อเปิดใช้ชุดทดสอบ end-to-end

---

## สรุปสั้น ๆ (checklist ก่อนใช้งาน)

* [ ] สร้าง endpoints: `POST /api/dev/fake/posts`, `POST /api/dev/fake/users`, `DELETE /api/dev/fake/cleanup`
* [ ] ปรับ SQL ให้ตรง schema (เพิ่ม `fake_test` bool ถ้ายังไม่มี)
* [ ] ป้องกัน production (`NODE_ENV`) และ require admin/internal auth
* [ ] สร้างหน้า UI `admin/dev/fake` หรือ `/dev/fake` ที่เรียก endpoints ข้างต้น

---

ถ้าชอบ ผมสามารถ:

* แพตช์ไฟล์ตัวอย่างลงในโปรเจกต์ของคุณ (สร้างไฟล์ route + UI) แล้วส่งเป็น ZIP เฉพาะไฟล์ที่เพิ่ม/แก้ให้
* หรือปรับ SQL ให้ตรงกับ schema จริงของคุณ (ส่งตัวอย่าง schema `users` / `posts` มาได้)

อยากให้ผมสร้างไฟล์ตัวอย่างให้เป็น ZIP ให้เลยไหมครับ? 🚀
