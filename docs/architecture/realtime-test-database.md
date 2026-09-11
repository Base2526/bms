# ฐานทดสอบแยกสำหรับ migration realtime (`9.70`–`9.72`)

> compose: [`docker-compose.realtime-test.yml`](../../docker-compose.realtime-test.yml) ·
> สถาปัตยกรรม: [mobile-graphql-ws-realtime.md](mobile-graphql-ws-realtime.md) ·
> ADR: [001](decisions/001-transactional-realtime-invalidation.md)

`9.71` ติด AFTER trigger **25 ตัว** และ `9.72` อีก **2 ตัว** บนตารางที่ร้อนที่สุดของระบบ
(`bms_orders`, `bms_inventory`, `bms_payments`, `bms_pos_shifts`, …) ทุกตัวเขียนลง
`bms_realtime_outbox` **ในทรานแซกชันเดียวกับงานธุรกิจ** แปลว่า trigger ที่อ้างคอลัมน์ผิด
ไม่ได้ทำให้ "realtime เงียบ" แต่ทำให้ **การขาย/รับของ/ปิดกะ rollback ทั้งก้อน**

ณ วันที่เขียน trigger ทั้ง 27 ตัว **ยังไม่เคยยิงกับฐานจริงสักครั้ง** จึงต้องทดสอบบนฐานที่ทิ้งได้

## ทำไมต้องเป็นคนละ instance ไม่ใช่แค่คนละ database

| ของ | ขอบเขต | แยกด้วย database พอไหม |
| --- | --- | --- |
| ตาราง / ฟังก์ชัน / trigger | ต่อ database | ✅ พอ |
| **role (`bms_realtime_dispatcher`, `BYPASSRLS`)** | **ต่อ cluster** | ❌ **ไม่พอ** |

`9.70` รัน `CREATE ROLE bms_realtime_dispatcher NOLOGIN BYPASSRLS` และ `9.71`/`9.72` รัน
`ALTER FUNCTION … OWNER TO` role นั้น · role อยู่ระดับ cluster ดังนั้นถึงแยก database
มันก็ไปโผล่ที่ฐาน dev ด้วย และ `DROP DATABASE` ไม่ลบมันทิ้ง

instance ของตัวเองทำให้ `down -v` ครั้งเดียวคืนสภาพได้หมดจริง ซึ่งเป็นสิ่งที่ต้องการเวลาลอง
ของที่ยังไม่เคยรัน

## ⚠️ สร้างฐานเปล่าจาก `db/migrations` ไม่ได้

`1.24__roles.sql` กับ `001_normalize_roles_phase1.sql` นิยามตาราง `roles` คนละแบบที่อยู่ร่วมกัน
ไม่ได้ (`key`/`is_system` กับ `is_active`/`updated_at`) · แอปใช้ของ `001` แต่ `1.24` เลขน้อยกว่า
จึงรันก่อน แล้ว `001` เป็น `IF NOT EXISTS` จึงข้ามตัวเองเงียบ ๆ → **ฐานสร้างเสร็จโดยไม่มี error
แต่หน้า users/roles พังทั้งหมด** (ตรึงไว้ใน `scripts/migration-order-contract.test.mts`)

**ต้อง restore จาก dump ของฐานที่ใช้งานอยู่เสมอ** ไม่มีทางลัด

## ขั้นตอน

### 1. ได้ dump มาก่อน

จากเซิร์ฟเวอร์ (หรือเครื่องที่ยังมีฐาน dev):

```bash
docker compose ... exec -T postgres \
  pg_dump -U <user> -d <db> --no-owner --no-privileges -Fc > bms-dev.dump
```

`--no-owner --no-privileges` เพราะฐานทดสอบมี role คนละชุด · ถ้าไม่ใส่ restore จะพ่น error
เรื่อง owner เต็มไปหมดแล้วกลบ error จริง

### 2. ยกฐานทดสอบขึ้น

```bash
docker compose -f docker-compose.realtime-test.yml up -d
docker compose -f docker-compose.realtime-test.yml ps     # รอ healthy
```

พอร์ตคือ **5433** ไม่ใช่ 5432 — ถ้าเผลอชี้ env ผิดจะต่อไม่ติด ซึ่งดีกว่าต่อติดฐานผิดใบ

### 3. restore

```bash
docker compose -f docker-compose.realtime-test.yml exec -T postgres-realtime-test \
  pg_restore -U app -d bms_realtime_test --no-owner --no-privileges < bms-dev.dump
```

### 4. ยืนยันว่า "ก่อนรัน migration" ฐานนี้ใช้งานได้จริง

ขั้นนี้ห้ามข้าม — ต้องรู้ว่าอะไรพังเพราะ migration และอะไรพังมาก่อนแล้ว

```bash
cd apps/web
POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=bms_realtime_test \
POSTGRES_USER=app POSTGRES_PASSWORD=realtime_test_only \
  npm run test:db
```

**จดจำนวนที่ผ่าน/แดงไว้เป็น baseline** · ชุด DB 38 ไฟล์นี้ยังไม่เคยรันเลย จึงต้องถือว่าตัวที่แดง
อาจแดงมาก่อนอยู่แล้ว การเทียบกับ baseline คือวิธีเดียวที่แยก regression ออกจากของเดิม

### 5. รัน migration ตามลำดับ — ห้ามสลับ

```bash
for f in 9.70__bms_realtime_outbox \
         9.71__bms_realtime_domain_events \
         9.72__bms_realtime_cash_and_kitchen_events; do
  docker compose -f docker-compose.realtime-test.yml exec -T postgres-realtime-test \
    psql -U app -d bms_realtime_test -v ON_ERROR_STOP=1 -1 < db/migrations/$f.sql || break
done
```

- **`-1`** = ทั้งไฟล์อยู่ในทรานแซกชันเดียว ล้มแล้วไม่ทิ้งของค้างครึ่งทาง
  (เคยเจอกับ `7.98` มาแล้ว ต้อง DROP มือ)
- **`ON_ERROR_STOP=1`** ไม่งั้น psql เดินต่อแล้วรายงานว่าสำเร็จ
- **ลำดับห้ามสลับ** — `9.71`/`9.72` ต้องการ role ที่ `9.70` สร้าง

### 6. ยืนยันว่า schema พร้อม

```bash
docker compose -f docker-compose.realtime-test.yml exec -T postgres-realtime-test \
  psql -U app -d bms_realtime_test < db/checks/schema-readiness.sql
```

ควรได้ "ครบ" · ถ้ายังขาดแปลว่ามี migration เก่าที่ dump ไม่ได้พามาด้วย

### 7. รันชุด DB อีกรอบแล้วเทียบกับ baseline ข้อ 4

ตัวที่เปลี่ยนจากเขียวเป็นแดง = ของที่ migration ทำพัง · ตัวที่แดงทั้งสองรอบ = ของเดิม

### 8. ยืนยันว่า trigger ไม่ได้ทำให้เส้นเงินพัง

สิ่งที่เทสสแกนซอร์สยืนยันแทนไม่ได้ — ต้องเห็นว่า **เขียนได้จริงแล้วมีแถวใน outbox**

```sql
-- ก่อน: นับไว้
SELECT count(*) FROM bms_realtime_outbox;

-- แล้วเดินเส้นจริงจากแอป/เทส: ขายหนึ่งบิล · รับของเข้าคลัง · เปิด-ปิดกะ · เงินเข้าลิ้นชัก

-- หลัง: ต้องเพิ่มขึ้น และต้องไม่มีใบไหนค้าง FAILED
SELECT status, count(*) FROM bms_realtime_outbox GROUP BY status;
SELECT event_type, count(*) FROM bms_realtime_outbox GROUP BY event_type ORDER BY 2 DESC;
```

**เคสที่สำคัญที่สุดและอ่านโค้ดแล้วตอบไม่ได้:** เขียน `bms_orders`/`bms_inventory` จากเส้นทางที่
**ไม่ได้ตั้ง `bms.tenant_id`** (ไม่ได้ผ่าน `beginTenantTx`) · outbox เป็น `FORCE ROW LEVEL
SECURITY` และ trigger พึ่ง `SECURITY DEFINER` + owner ที่เป็น `BYPASSRLS` ว่าจะข้าม RLS ให้
ถ้า owner หลัง restore ไม่ตรง **ทุก write ที่ trigger ครอบจะ rollback** ตรวจด้วย:

```sql
SELECT p.proname, r.rolname, r.rolbypassrls
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
 WHERE p.proname LIKE 'bms_realtime%' OR p.proname = 'bms_emit_realtime_event';
```

ทุกแถวต้องเป็น `bms_realtime_dispatcher` และ `rolbypassrls = t`

### 9. ทิ้งเมื่อเสร็จ

```bash
docker compose -f docker-compose.realtime-test.yml down -v
```

## สิ่งที่ฐานนี้ยังตอบไม่ได้

- **write amplification** — `AFTER INSERT OR UPDATE ON bms_inventory` ยิงทุกการขยับสต็อก
  ต้องวัดกับข้อมูลขนาดจริง ไม่ใช่ฐานทดสอบที่มีไม่กี่ร้าน
- **multi-instance** — dispatcher claim ด้วย `FOR UPDATE SKIP LOCKED` ต้องมีสอง instance
  ยิงพร้อมกันถึงจะพิสูจน์ว่าไม่ publish ซ้ำ
- **สาย Redis → WS → client** — ต้องมี `apps/ws` และ client จริงต่อเข้ามา
