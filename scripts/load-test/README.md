# BMS Load Test

ชุดนี้เป็น baseline load-test สำหรับวัด capacity ของ BMS ตาม scenario จริงของระบบ แทนการยิงหน้าเว็บกว้าง ๆ

## เป้าหมาย

คำถามว่า "ระบบรองรับกี่ user" ต้องผูกกับ workload ที่ชัดเจนก่อน เช่น

- admin เปิด dashboard/query ข้อมูลหลังบ้าน
- ลูกค้าคุยกับ AI ผ่าน demo chat
- ลูกค้าเปิดหน้า checkout จาก signed link

แต่ละแบบใช้ resource คนละชุด:

- `admin-dashboard` เน้น Next.js + GraphQL + PostgreSQL
- `admin-inbox-list` เน้น query รายการแชทหลังบ้าน
- `admin-inbox-detail` เน้น query รายละเอียดแชทพร้อม messages/notes/system events
- `admin-orders-list` เน้น query รายการออเดอร์พร้อม line items
- `admin-customer360` เน้น query ข้อมูลลูกค้า 360 ที่หนักกว่า dashboard
- `pos-session` เน้น device auth และข้อมูลเริ่มต้นของจอ POS
- `pos-scan` เน้น device auth, ราคา authoritative และ stock lookup ต่อการสแกน
- `demo-chat` เน้น AI pipeline + database + conversation logging
- `checkout-read` เน้น public checkout read path

## สิ่งที่สคริปต์วัด

- throughput (`req/s`)
- success rate / error rate
- latency (`avg`, `p50`, `p95`, `p99`, `max`)
- status code distribution

## การใช้งาน

รันจาก `apps/web` เพราะ repo นี้มี `tsx` อยู่ใน package นี้:

```bash
cd apps/web
npx tsx ../../scripts/load-test/run.mts --scenario admin-dashboard --concurrency 20 --duration 60
```

หรือกำหนดผ่าน env:

```bash
cd apps/web
BASE_URL=http://localhost:3000 \
BMS_ADMIN_EMAIL=admin@example.com \
BMS_ADMIN_PASSWORD=secret \
npx tsx ../../scripts/load-test/run.mts --scenario admin-dashboard --concurrency 20 --duration 60
```

## Scenarios

### 1. `admin-dashboard`

จำลองแอดมินล็อกอินแล้ว query GraphQL หน้า dashboard/inbox

Env ที่ต้องใช้:

```bash
BASE_URL=http://localhost:3000
BMS_ADMIN_EMAIL=admin@example.com
BMS_ADMIN_PASSWORD=secret
```

### 2. `demo-chat`

จำลองลูกค้าคุยกับ AI ผ่าน `POST /api/bms/demo-chat`

Env เพิ่มเติม:

```bash
BASE_URL=http://localhost:3000
DEMO_SHOP_KEY=default
DEMO_MESSAGE=มีสินค้าแนะนำไหม
```

### 3. `checkout-read`

จำลองลูกค้าเปิด checkout link

Env เพิ่มเติม:

```bash
BASE_URL=http://localhost:3000
CHECKOUT_TOKEN=...
```

### 4. `admin-inbox-list`

จำลองหน้า Inbox queue/list

Env ที่ต้องใช้:

```bash
BASE_URL=http://localhost:3000
BMS_ADMIN_EMAIL=admin@example.com
BMS_ADMIN_PASSWORD=secret
```

### 5. `admin-inbox-detail`

จำลองเปิดแชท 1 ห้อง พร้อมโหลด messages / notes / system events

ต้องมี conversation จริงอย่างน้อย 1 รายการใน tenant

### 6. `admin-orders-list`

จำลองหน้า Orders ที่โหลดออเดอร์ 100 รายการพร้อม items

### 7. `admin-customer360`

จำลองเปิด Customer 360 จาก conversation จริง 1 รายการ

ต้องมี conversation จริงอย่างน้อย 1 รายการใน tenant

### 8. `pos-session`

จำลองการเปิดหรือ refresh จอ POS โดยใช้ device token จริง เป็น read-only scenario
ยกเว้นการอัปเดต `last_seen_at` ที่ระบบ throttle ไว้ไม่เกินหนึ่งครั้งต่อนาทีต่อเครื่อง

```bash
cd apps/web
POS_DEVICE_TOKEN=pos_xxx \
npx tsx ../../scripts/load-test/run.mts --scenario pos-session --concurrency 20 --duration 60
```

### 9. `pos-scan`

จำลองการสแกน barcode/SKU ที่มีอยู่จริง ตรวจทั้ง token lookup, canonical price และ stock ของสาขา

```bash
cd apps/web
POS_DEVICE_TOKEN=pos_xxx \
POS_SCAN_CODE=8850000000000 \
npx tsx ../../scripts/load-test/run.mts --scenario pos-scan --concurrency 20 --duration 60
```

## ตัวอย่างไล่ระดับ

เริ่มแบบ step test:

```bash
cd apps/web
for c in 5 10 20 40 80; do
  echo "== concurrency $c =="
  BASE_URL=http://localhost:3000 \
  BMS_ADMIN_EMAIL=admin@example.com \
  BMS_ADMIN_PASSWORD=secret \
  npx tsx ../../scripts/load-test/run.mts --scenario admin-dashboard --concurrency "$c" --duration 60
done
```

## วิธีตีความผล

ให้ถือว่า "รองรับได้" เมื่อครบทุกข้อพร้อมกัน:

- success rate >= 99%
- `p95` ต่ำกว่า SLA ที่ยอมรับได้
- ไม่มี error spike จาก DB / Redis / AI provider
- CPU / memory / DB connections ยังไม่ชนเพดาน

ตัวอย่าง SLA ตั้งต้น:

- admin query: `p95 < 800ms`
- public checkout read: `p95 < 500ms`
- POS session: `p95 < 500ms`
- POS scan: `p95 < 250ms`
- AI chat: `p95 < 5000ms` หรือค่า SLA ที่ธุรกิจยอมรับจริง

## ข้อควรระวัง

- `demo-chat` วัดรวม dependency ภายนอกของ AI provider ด้วย จึงตอบคำถามเรื่อง "capacity ของระบบรวม" มากกว่า "capacity ของ app server ล้วน ๆ"
- ถ้าอยากวัดเฉพาะ backend/app ให้เริ่มจาก `checkout-read` หรือ `admin-dashboard` ก่อน
- อย่ายิง production แบบหนักโดยไม่มี rate limit / maintenance window / observability พร้อม
- ใช้ device token ของ staging สำหรับ POS load test; token คือ credential ประจำเครื่องและห้ามใส่ใน git/log

## คำแนะนำการทดสอบจริง

1. รันกับ local/dev เพื่อเช็คว่าสคริปต์ทำงานถูก
2. รันกับ staging ที่สเปกใกล้ production
3. ไต่ `concurrency` ทีละขั้น
4. จดจุดที่ `p95` หรือ error rate เริ่มพุ่ง
5. ดู metrics ฝั่ง app, postgres, redis, และ AI provider พร้อมกัน

ถ้าต้องการ test แบบหนักขึ้นจริงจัง เช่น ramping arrival rate, distributed load generator, percentile trend per second,
แนะนำค่อยย้ายไป `k6` หรือ `artillery` หลังจาก baseline นี้นิ่งแล้ว

## Capacity Planning

เวลาจะคุยเรื่อง "ต้องเตรียม server เท่าไร" ให้แยก 2 อย่าง:

- current measured capacity: วันนี้รองรับได้เท่าไรใน scenario ที่วัด
- target capacity: อยากรองรับกี่ concurrent users ภายใต้ SLA อะไร

สูตรคร่าว ๆ ที่ใช้คุย planning:

```text
throughput (req/s) ≈ concurrent users / average think time per second
concurrency ≈ req/s × response time (Little's Law แบบหยาบ)
```

ตัวอย่างสำหรับ admin workload:

- ถ้า "active admin" 1 คน ทำ request เฉลี่ยทุก 3 วินาที
- 100 admins จะประมาณ 33 req/s
- 1000 admins จะประมาณ 333 req/s

ตาราง planning แบบหยาบ:

| Active concurrent admins | If each admin sends ~1 req / 3s | If each admin sends ~1 req / 5s |
| --- | ---: | ---: |
| 100 | ~33 req/s | ~20 req/s |
| 250 | ~83 req/s | ~50 req/s |
| 500 | ~167 req/s | ~100 req/s |
| 1000 | ~333 req/s | ~200 req/s |

เมื่อเทียบกับผล production scenario `admin-dashboard` ที่คุณวัดได้ก่อนหน้า:

- plateau throughput อยู่ประมาณ `14-15 req/s`
- ดังนั้นถ้าจะไปถึง `1000 active concurrent admins` ยังไม่ใช่แค่ "เพิ่ม server นิดหน่อย"
- ต้องทั้ง optimize query path และค่อย scale infra

คำแนะนำการใช้ scenario:

- เริ่มจาก `admin-dashboard` เพื่อหา baseline
- ตามด้วย `admin-inbox-list` และ `admin-orders-list` เพื่อหา page-level bottleneck
- ใช้ `admin-inbox-detail` และ `admin-customer360` เพื่อหา worst-case admin read path
