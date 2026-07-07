# BMS Daily Log Triage (AI → draft PR)

อัตโนมัติทุกวัน: อ่าน error จาก `system_logs` → ให้ Claude วิเคราะห์ + เสนอแพตช์ → เปิด **draft PR** ให้คนรีวิว

## ส่วนประกอบ
- [`collect-error-logs.mjs`](collect-error-logs.mjs) — ดึง error 24 ชม.ล่าสุด, จัดกลุ่ม/dedupe, **ปิดบัง secret/PII**, เขียน `bms-log-report.md`
- [`notify-line.mjs`](notify-line.mjs) — แจ้งเตือนทีมผ่าน LINE (Messaging API push) เมื่อเปิด PR
- [`../../.github/workflows/daily-log-triage.yml`](../../.github/workflows/daily-log-triage.yml) — cron รายวัน → collector → Claude → draft PR → แจ้ง LINE

## ตั้งค่าครั้งเดียว (GitHub → Settings → Secrets and variables → Actions)
| Secret | ค่า |
|---|---|
| `BMS_LOG_DATABASE_URL` | connection string ของ Postgres — **แนะนำสร้าง user READ-ONLY** (`GRANT SELECT ON system_logs`) |
| `ANTHROPIC_API_KEY` | API key ของ Claude |
| `LINE_OPS_TOKEN` | (ทางเลือก) Channel access token ของ LINE OA สำหรับทีม ops |
| `LINE_OPS_TO` | (ทางเลือก) userId / groupId ปลายทางที่ให้ OA push แจ้งเตือน |

> **LINE:** ใช้ **Messaging API push** — ไม่ใช่ LINE Notify (ปิดบริการแล้ว มี.ค. 2025)
> ทำ LINE OA แยกสำหรับทีม (ops) แล้วเอา userId/groupId มาใส่ `LINE_OPS_TO` ·
> ถ้าไม่ตั้ง 2 secret นี้ ระบบจะข้ามการแจ้งเตือน (ไม่ error)

> ⚠️ GitHub-hosted runner ต้องต่อ DB ได้ — Cloud SQL ต้องเปิด public IP + authorized networks
> หรือใช้ Cloud SQL Auth Proxy / self-hosted runner ในวงเน็ตเวิร์ก (ดีต่อ data residency AU/UK)

## ทดสอบ
- **local:** `BMS_LOG_DATABASE_URL=... node scripts/bms-log-triage/collect-error-logs.mjs` แล้วดู `bms-log-report.md`
- **บน GitHub:** Actions → *Daily Log Triage* → **Run workflow** (workflow_dispatch)

## ปรับแต่ง
- เวลา: แก้ `cron` ใน workflow (ตอนนี้ 22:00 UTC ≈ 09:00 AEST)
- ช่วง/ขนาด: env `LOG_WINDOW_HOURS` (24), `LOG_MAX_GROUPS` (30)
- ขอบเขตการแก้ของ AI: แก้ `prompt` / `claude_args --allowedTools` ใน workflow

## กติกาความปลอดภัย (ยึดตาม production safety)
- เปิดเป็น **draft PR เสมอ** — คนต้องรีวิว/merge เอง (ไม่มี auto-merge, ไม่มี deploy)
- log ถูก **redact** ก่อนส่งออก (email/phone/token/api-key/enc/hex/ip)
- AI แก้เฉพาะที่มั่นใจ + minimal + ห้ามแตะ migration/secret/config
- ถ้าไม่มีอะไรมั่นใจพอ → PR มีแค่รายงาน (ไม่ดันโค้ดมั่ว)
