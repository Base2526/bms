ถ้าจุดประสงค์คือ “เอารูปที่เก็บในดิสก์จริง (เช่น `/app/storage/2025/11/07/xxx.png`) มาแสดงบนเว็บ”, อย่าโยน **filesystem path** ออกหน้าเว็บตรงๆ นะครับ ให้แปลงเป็น **URL ที่เสิร์ฟผ่านแอป** แทน มี 3 วิธีหลัก:

---

# วิธีแนะนำ (ปลอดภัยสุด): เสิร์ฟผ่าน API `/api/files/:id`

> Security contract: `GET /api/files/:id` เปิดได้โดยไม่ล็อกอินเฉพาะแถวที่
> `visibility = 'public'`; ไฟล์ private ตรวจ session และ tenant เจ้าของก่อนเสิร์ฟ
> ส่วน `GET/POST /api/files` สำหรับ Files panel ต้องล็อกอิน, จำกัดรายการตาม tenant,
> ผูก tenant ตอนอัปโหลด, ไม่ส่ง storage key (`relpath`) ให้ client และจำกัดไฟล์ไม่เกิน
> 25 MB ห้ามสร้าง route ใหม่ที่ข้าม guard นี้

ให้ตาราง `files` เก็บอย่างน้อย: `id (uuid)`, `relpath` (เช่น `2025/11/07/xxx.png`), `mime`, `size`.

### 1) helper สร้าง URL ไปหน้าเว็บ

```ts
// lib/files-url.ts
export function buildFileUrlById(id: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''; // เช่น https://admin.example.com
  return `${base}/api/files/${id}`;
}
```

> ใน resolver คุณทำอยู่แล้ว: `images: imgs.map(r => ({ id:r.id, url: buildFileUrlById(r.id) }))`
> หน้าบ้านก็แค่: `<img src={img.url} />` จบ

### 2) route เสิร์ฟไฟล์ตาม id

```ts
// app/api/files/[id]/route.ts
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import path from 'path';
import fs from 'fs/promises';

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { rows } = await query(
    `SELECT relpath, mime FROM files WHERE id=$1 LIMIT 1`,
    [params.id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { relpath, mime } = rows[0];
  const abs = path.join(STORAGE_DIR, relpath); // ← path จริงในเครื่อง

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable', // ปรับตามต้องการ
      },
    });
  } catch {
    return NextResponse.json({ error: 'File missing' }, { status: 404 });
  }
}
```

> ข้อดี: ไม่เปิดโครงสร้างดิสก์, ตรวจสิทธิ์ได้, ใส่ header cache ได้, เปลี่ยนระบบเก็บไฟล์ทีหลัง (S3, CDN) ก็ยังใช้ URL เดิม

---

# วิธีเร็ว (dev-only/ภายใน): map static path → URL

ถ้าคุณโอเคจะเปิดโฟลเดอร์ `storage` ตรง ๆ (เช่นใน Intranet/Dev):

### 1) next.config.js ตั้ง `rewrites`

```js
// next.config.js
module.exports = {
  async rewrites() {
    return [
      { source: '/files/:path*', destination: '/api/files/static/:path*' },
    ];
  },
};
```

### 2) route อ่านไฟล์ตาม relpath

```ts
// app/api/files/static/[...path]/route.ts
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
const mime = (await import('mime-types')).default;

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');

export async function GET(_: Request, { params }: { params: { path: string[] } }) {
  const rel = params.path.join('/'); // 2025/11/07/xxx.png
  const abs = path.join(STORAGE_DIR, rel);

  try {
    const buf = await fs.readFile(abs);
    const ct = mime.lookup(rel) || 'application/octet-stream';
    return new NextResponse(buf, { headers: { 'Content-Type': ct } });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
```

> แล้วหน้าเว็บก็ `<img src={`/files/2025/11/07/xxx.png`} />`

> ระวัง: ถ้าเปิดแบบนี้ควรบล็อค path traversal (`..`) / ตรวจสิทธิ์เอง

---

# วิธี production แบบ infra: Nginx map URL → โฟลเดอร์

ถ้ารันหลัง Nginx:

```nginx
location /files/ {
  alias /app/storage/;         # /files/2025/... → /app/storage/2025/...
  add_header Cache-Control "public, max-age=31536000, immutable";
  try_files $uri =404;
}
```

แล้วหน้าเว็บ `<img src="/files/2025/11/07/xxx.png" />` ได้เลย

---

## ใช้กับ Next/Image

ถ้า `img.url` เป็นโดเมนเดียวกัน ไม่ต้องตั้งอะไรเพิ่ม
ถ้าไปหลัง CDN/โดเมนอื่น ให้ใส่ใน `next.config.js`:

```js
images: {
  remotePatterns: [{ protocol: 'https', hostname: 'cdn.example.com' }],
}
```

---

## TL;DR สำหรับโปรเจกต์นี้

* คุณมี `persistWebFile` → บันทึกลง `files(relpath, mime, id)` แล้ว
* ฝั่ง GraphQL: ส่ง `url` กลับเลยด้วย `buildFileUrlById(id)`
* ฝั่งหน้าเว็บ: ใช้ `<img src={img.url} />` ไม่ต้องยุ่งกับ path จริง
* Dev ชี้ดูได้ในโฟลเดอร์ `storage/2025/11/07/...` (อย่างในภาพ) แต่ “หน้าเว็บ” ควรใช้ **URL** ไม่ใช่ **absolute path** ของดิสก์

ถ้าจะเลือกอันเดียว: ผมแนะนำ **วิธี API `/api/files/:id`** (ยืดหยุ่น/ปลอดภัย/ย้าย storage ได้ง่าย) ครับ ✅
