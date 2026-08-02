# Admin Scale Readiness

เอกสารนี้เป็น checklist สำหรับเตรียม BMS ให้พร้อมรองรับการเติบโตของ admin users โดยยังไม่บังคับให้ต้อง
อัปเกรด infra ทันที ใช้เป็นแผนลงมือทีละขั้นก่อนถึงวันที่ต้อง scale จริง

อัปเดตล่าสุดตามผลที่วัดได้วันที่ **2026-08-02**

## เป้าหมาย

เป้าหมายระยะยาวที่ใช้เอกสารนี้คือ:

- รองรับ `1000 active concurrent admins`

คำว่า `active` ในที่นี้ต้องนิยามร่วมกันก่อนทุกครั้ง เช่น

- admin 1 คน ทำ request เฉลี่ย 1 ครั้งทุก 3 วินาที
- หรือ admin 1 คน ทำ request เฉลี่ย 1 ครั้งทุก 5 วินาที

ตัวเลขสองแบบนี้ทำให้ความต้องการ throughput ต่างกันมาก

## Baseline ปัจจุบัน

ผล load test production ที่ `https://bms.jachoei.com` เมื่อวันที่ `2026-08-02`

| Scenario | Concurrency | Throughput | p95 latency | Result |
| --- | ---: | ---: | ---: | --- |
| `admin-dashboard` | 10 | ~14.53 req/s | ~765 ms | ใช้งานได้ |
| `admin-dashboard` | 20 | ~15.39 req/s | ~1.41 s | เริ่มช้า |
| `admin-inbox-list` | 10 | ~14.85 req/s | ~744 ms | ใช้งานได้ |
| `admin-orders-list` | 10 | ~17.14 req/s | ~667 ms | ใช้งานได้ |
| `admin-customer360` | 5 | ~17.06 req/s | ~327 ms | เบา |

ข้อสรุปจาก baseline นี้:

- admin read path ปัจจุบัน plateau อยู่ประมาณ `15-17 req/s`
- bottleneck หลักน่าจะอยู่ในกลุ่ม `dashboard` และ `inbox list`
- ระบบยังไม่พร้อมสำหรับ `1000 active concurrent admins` ในสภาพปัจจุบัน

## Capacity Target แบบหยาบ

ตารางนี้ใช้คุย planning ก่อนลงลึกเรื่องเครื่อง

| Active concurrent admins | ถ้า 1 คนยิง ~1 req / 5s | ถ้า 1 คนยิง ~1 req / 3s |
| --- | ---: | ---: |
| 100 | ~20 req/s | ~33 req/s |
| 250 | ~50 req/s | ~83 req/s |
| 500 | ~100 req/s | ~167 req/s |
| 1000 | ~200 req/s | ~333 req/s |

เมื่อเทียบกับ baseline ปัจจุบัน:

- เป้า `1000 admins` ยังห่างประมาณ `12x-20x`

ดังนั้นงานหลักตอนนี้ไม่ใช่ “ซื้อเครื่องเพิ่มกี่ตัว” แต่คือ “เตรียม structure ให้ scale ได้”

## หลักคิด

สำหรับเป้า `1000 admins` อย่าพึ่งพา:

- app instance เดียว
- database อ่านสดทุกหน้า
- dashboard ที่คำนวณทุกอย่าง on-demand
- state ที่ผูกอยู่กับ memory ของเครื่องเดียว

ให้เตรียมระบบให้พร้อมกับโครงแบบนี้:

```text
Admins
  -> Load Balancer
  -> Multiple Web App Instances
  -> Redis / shared cache / pubsub
  -> PostgreSQL primary
  -> Read replicas or precomputed summaries
  -> Background workers / async jobs
```

## Phase 0: นิยามเป้าหมายร่วมกัน

เป้าหมายของ phase นี้คือเลิกใช้คำว่า “รองรับ 1000 admins” แบบกว้างเกินไป

Checklist:

- [ ] นิยาม `active admin` ให้ชัด
- [ ] กำหนด SLA ของแต่ละหน้า
- [ ] ระบุหน้า critical ที่ต้องเร็วจริง
- [ ] ระบุหน้าไหนยอม cache ได้

ค่าตั้งต้นแนะนำ:

- `dashboard` → `p95 < 1s`
- `inbox list` → `p95 < 1s`
- `inbox detail` → `p95 < 1.5s`
- `orders list` → `p95 < 1s`
- `customer 360` → `p95 < 1s`

Deliverable:

- เอกสาร SLA 1 หน้า
- รายชื่อ critical queries ที่ต้องเฝ้าดู

## Phase 1: ทำให้ App พร้อม scale horizontally

เป้าหมายของ phase นี้คือให้ web app รันหลาย instance ได้โดยไม่พัง behavior

Checklist:

- [ ] ยืนยันว่า app เป็น stateless
- [ ] ตรวจว่าห้ามเก็บ session/state สำคัญใน memory ของ process
- [ ] ยืนยันว่า realtime/pubsub ใช้ shared backend ไม่ใช่ in-memory local only
- [ ] ยืนยันว่า upload / temp file path ที่สำคัญไม่ผูกกับเครื่องเดียว
- [ ] ยืนยันว่า background jobs ไม่ผูกกับ process ของ web ตัวเดียว

ใน repo นี้มีสัญญาณที่ดีอยู่แล้ว:

- GraphQL + REST เป็น thin adapters
- business logic อยู่ที่ `apps/web/lib/bms/*.ts`
- มี Redis/pubsub usage อยู่แล้ว

สิ่งที่ต้อง review เพิ่ม:

- `apps/web/app/api/graphql/route.ts`
- `apps/web/lib/apollo.ts`
- `apps/ws/`
- code path ที่ใช้ notification / subscription / inbox realtime

Deliverable:

- checklist ผ่านครบว่าเพิ่ม web instances ได้โดยไม่ทำให้ session/realtime เพี้ยน

## Phase 2: ใส่ Observability ก่อน scale

ถ้ายังไม่มี metrics ที่พอ การเพิ่มเครื่องจะกลายเป็นการเดา

Checklist:

- [ ] เก็บ request rate, p50, p95, p99 แยกตาม route/query
- [ ] เก็บ error rate แยกตาม route/query
- [ ] เก็บ CPU / memory ของ app
- [ ] เก็บ DB connections
- [ ] เปิด slow query logging
- [ ] ระบุ top 10 GraphQL queries ที่หนักสุด
- [ ] เก็บ Redis latency / connection / memory

ควรแยก metric ตาม scenario ต่อไปนี้อย่างน้อย:

- `admin-dashboard`
- `admin-inbox-list`
- `admin-inbox-detail`
- `admin-orders-list`
- `admin-customer360`

Deliverable:

- dashboard monitoring กลาง 1 ชุด
- รายงาน slow queries รายวัน

## Phase 3: แก้ read bottlenecks ก่อนซื้อเครื่อง

จากผล load test ปัจจุบัน bottleneck น่าจะอยู่ฝั่ง read path ของ admin

Priority แนะนำ:

1. `dashboard`
2. `inbox list`
3. `orders list`
4. `inbox detail`
5. `customer 360`

Checklist:

- [ ] profile query ของ `bmsDashboard`
- [ ] profile query ของ `bmsConversations(limit: 100)`
- [ ] profile query ของ `bmsOrders(limit: 100)`
- [ ] ดูว่ามี N+1 query หรือไม่
- [ ] ดูว่ามี aggregate ที่คำนวณสดทุก request หรือไม่
- [ ] ดูว่ามี join ที่ขาด index หรือไม่

ไฟล์ที่ควร review ก่อน:

- [`apps/web/lib/bms/dashboard.ts`](../../apps/web/lib/bms/dashboard.ts)
- [`apps/web/lib/bms/inbox.ts`](../../apps/web/lib/bms/inbox.ts)
- [`apps/web/lib/bms/orders.ts`](../../apps/web/lib/bms/orders.ts)
- [`apps/web/lib/bms/customer360.ts`](../../apps/web/lib/bms/customer360.ts)

Deliverable:

- รายชื่อ query ที่ต้อง optimize
- action list พร้อม expected gain

## Phase 4: ทำ Cache และ Precomputed Read Models

เป้าหมายคือไม่ให้ทุกหน้า admin ต้องคำนวณทุกอย่างสดจาก primary DB ตลอดเวลา

สิ่งที่เหมาะกับ cache / precompute:

- dashboard summary cards
- unread / badge counters
- top products / top customers
- operational alerts summary
- aggregated inbox queue stats

Checklist:

- [ ] แยก field ที่ต้อง real-time จริง ออกจาก field ที่ยอม stale ได้ 10-60 วินาที
- [ ] ออกแบบ cache key ต่อ tenant
- [ ] กำหนด TTL ต่อ widget/query
- [ ] ทำ invalidation strategy สำหรับ writes สำคัญ
- [ ] ประเมินว่าตัวไหนควรใช้ Redis cache และตัวไหนควรใช้ summary table/materialized view

หลักการ:

- ค่า aggregate ที่ไม่ต้องสดระดับทุกวินาที ไม่ควรคำนวณใหม่ทุก request
- badge ที่ user คาดหวัง real-time ควรมีทาง invalidation ชัดเจน

Deliverable:

- cache matrix ว่า query ไหนใช้ cache อะไร TTL เท่าไร

## Phase 5: แยก Async / Background Work

เมื่อจำนวน admin โตขึ้น งานที่ไม่จำเป็นต้องอยู่บน critical request path ควรถูกดันออกไป

ตัวอย่างงานที่ควรเป็น async:

- report generation
- heavy recomputation
- digest / notifications
- sync / health checks
- non-critical enrichment

Checklist:

- [ ] แยกงานหนักที่ยังอยู่ใน request path
- [ ] ย้ายไป queue/worker เมื่อเหมาะสม
- [ ] ใส่ timeout และ retry policy
- [ ] ใส่ idempotency สำหรับงานที่ replay ได้

Deliverable:

- รายชื่อ endpoints/queries ที่ควรย้ายงานหลังบ้านออก

## Phase 6: เตรียม Database สำหรับ Scale

แม้ app scale ออกหลาย instance ได้ DB ยังมักเป็นคอขวดหลัก

Checklist:

- [ ] ใช้ connection pooling อย่างชัดเจน
- [ ] มี index ตาม query path หลัก
- [ ] ทบทวน pagination/query bounds ทุกหน้า list ใหญ่
- [ ] แยก read-heavy workload ที่ไม่จำเป็นต้องอ่านจาก primary โดยตรง
- [ ] ประเมิน read replica สำหรับ admin read paths
- [ ] ประเมิน summary tables/materialized views สำหรับ dashboard

ดูเอกสารร่วม:

- [database.md](./database.md)
- [api.md](./api.md)

Deliverable:

- DB readiness checklist
- รายชื่อ candidate สำหรับ read replica / materialized views

## Phase 7: เตรียม Infra สำหรับ Scale จริง

phase นี้ค่อยทำเมื่อ Phase 1-6 พร้อมพอสมควร

Checklist:

- [ ] มี load balancer หน้า web app
- [ ] รัน web app หลาย instances ได้
- [ ] แยก worker ออกจาก web
- [ ] Redis เป็น shared service ที่เชื่อถือได้
- [ ] DB sizing แยกจาก app sizing
- [ ] มี staging environment ที่ใกล้ production
- [ ] มี runbook สำหรับ scale up / rollback

ข้อสำคัญ:

- อย่าคาดหวังว่า “เพิ่ม web servers อย่างเดียว” จะพาไปถึง 1000 admins
- ถ้า query path ยังตันอยู่ที่ DB หรือ aggregate สด throughput จะไม่ขึ้นตามจำนวน app instances

Deliverable:

- deployment topology ที่รองรับ multi-instance
- runbook การ scale

## Suggested Rollout Order

ลำดับแนะนำ:

1. Phase 0
2. Phase 2
3. Phase 1
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7

เหตุผล:

- ต้องรู้ก่อนว่าเป้าหมายคืออะไร
- ต้องมองเห็น bottleneck ก่อน
- ต้องทำให้ app scale ได้ก่อน
- แล้วค่อย optimize/query/cache/db/infra ตามลำดับ

## Practical “Ready for 1000 Admins” Definition

ให้ถือว่า BMS “พร้อมเริ่มรองรับ 1000 active admins” เมื่อครบอย่างน้อย:

- [ ] มีนิยาม `active admin` และ SLA ชัด
- [ ] app รันหลาย instance ได้แบบ stateless
- [ ] มี monitoring/query profiling ครบ
- [ ] dashboard/inbox read path ไม่คำนวณ aggregate สดทั้งหมด
- [ ] มี cache/precomputed summaries สำหรับ read-heavy paths
- [ ] worker/async jobs แยกออกจาก request path
- [ ] DB มี pooling/index/read strategy ที่ชัด
- [ ] ผ่าน load test ซ้ำในระดับอย่างน้อย `100`, `250`, `500` concurrent ตาม scenario สำคัญ

## Related Docs

- [system.md](./system.md)
- [database.md](./database.md)
- [api.md](./api.md)
- [dashboard.md](../ui/dashboard.md)
- [customer360.md](../ui/customer360.md)
- [inbox-diagnostics.md](../ui/inbox-diagnostics.md)
- [scripts/load-test/README.md](../../scripts/load-test/README.md)
