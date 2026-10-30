# ร่างแผนร้านนำร่อง BMS Retail Local — 12 สัปดาห์

> สถานะ: **ร่างรอเจ้าของอนุมัติ** แผนนี้ไม่ใช่การประกาศ GA และไม่อนุญาตให้ใช้ telemetry
> เกินสัญญาหรือความยินยอม

## เกณฑ์คัดร้าน

เป้ากลุ่มนำร่องคือ 20 ร้านค้าปลีกที่มี Windows อยู่แล้ว ไม่รวมร้านอาหารหรือร้านยาในรอบนี้
ใช้ราคา `pilotPlus` จาก config กลางพร้อมข้อตกลง feedback โทรทุกร้านในสัปดาห์แรกหลังเริ่มติดตั้ง
12 สัปดาห์ด้านล่างคือสัปดาห์ที่ 5–16 ของแผนรวม

- เจ้าของ/ผู้ตัดสินใจยอมรับสถานะรุ่นนำร่องและมีผู้ประสานงานที่ตอบกลับได้
- ใช้ target หลักที่ประกาศและยอมทำ preflight; macOS ยังคง experimental
- ยอมทดสอบ flow ขาย คืน ปิดกะ backup/restore และอุปกรณ์ของร้านก่อนเปิดใช้งานจริง
- มี USB/NAS หรือปลายทางแยกสำหรับ encrypted off-host backup และเก็บ recovery identity แยกได้
- ยอมรายงาน incident/ผลทดสอบ โดยไม่ส่ง PII หรือข้อมูลธุรกิจเกินจำเป็น
- ไม่เลือกเป็น pilot ถ้าต้องการ hardware certification, cloud migration หรือ SLA ที่ระบบยังไม่มี

## ตัวชี้วัดและเป้าหมายที่เสนอ

| ตัวชี้วัด | เป้าหมายรออนุมัติ | วิธีเก็บจากระบบจริง | ข้อจำกัดการตีความ |
| --- | --- | --- | --- |
| 1. ติดตั้งสำเร็จเอง | ≥ 70% | โทรสัปดาห์แรก + receipt + บันทึกว่ามีเจ้าหน้าที่ช่วยหรือไม่ | event อย่างเดียวบอกไม่ได้ว่าทำเอง |
| 2. ยังใช้งานหลัง 30 วัน | ≥ 60% | `RUNTIME_SEEN` หลังครบ 30 วัน พร้อมวันที่รับฝั่ง server | ไม่มี event ไม่เท่ากับเลิกใช้; ร้านไม่ activate ไม่มี license pulse |
| 3. เวลาซัพพอร์ตต่อร้านต่อเดือน | ≤ 20 นาที | รวมเวลาจริงจากแบบบันทึกเคสต่อ LIC- | ต้องจดเวลา ไม่อนุมานจาก telemetry |
| 4. lead ฟรีเปลี่ยนเป็นผู้ซื้อ | วัด baseline ก่อนกำหนดเป้า | lead ที่ consent และตรวจชำระแล้ว / lead ฟรีใน cohort เดียวกัน | Paid เป็นสถานะบันทึกโดยคน ต้องเทียบหลักฐานรับเงิน |
| 5. ร้านที่มี backup จริง | ≥ 80% | ผลผ่าน off-host ล่าสุด + ตรวจสื่อ USB/NAS โดยได้รับความยินยอม | local alert ไม่ส่งข้อมูลไป cloud; passed ไม่พิสูจน์ restore |
| 6. ร้านขอเครื่องที่สอง | วัด baseline | คำขอใน LINE/ทะเบียนขายที่คนบันทึก | ไม่มี device-count telemetry และห้ามสัญญาติดต่ออัตโนมัติ |

มีกลไก installation registry แยกจาก license events ใน migration `10.36` ซึ่งอาจรายงาน instance
ที่ไม่ได้ activate จึงไม่ควรกล่าวรวมว่าร้านฟรีไม่ส่งข้อมูลทุกชนิด ข้อมูลนี้ไม่พิสูจน์จำนวนเครื่องขายต่อร้าน
และไม่ใช้แทน cohort ที่ยินยอมใน pilot

## ตารางเวลา 12 สัปดาห์

| สัปดาห์ | งาน | หลักฐานออกจากช่วง |
| --- | --- | --- |
| 1 (รวม 5) | เริ่ม 3–5 ร้านแรกหลัง decisions/EULA อนุมัติแล้ว; preflight, ติดตั้ง, ตั้ง backup และโทรทุกร้าน | รายชื่อแบบ pseudonymous + installation receipt + ผลติดตั้งเอง/มีคนช่วย |
| 2 | ขยาย cohort เมื่อกลุ่มแรกผ่าน sale/return/shift flow และเก็บ hardware/OS inventory | acceptance result + support log |
| 3 | ติดตามการใช้และแก้ incident ของกลุ่มแรก ตรวจ scheduled off-host backup | ผล backup + incident log |
| 4 | restore drill บนเครื่องทดแทนและ Activate or Transfer | reconciliation + transfer timeline |
| 5 | เปิดใช้งานร้านกลุ่มแรก ติดตาม incident รายวัน | support log + baseline metrics |
| 6 | ทดสอบ update ปกติและ update ที่ต้อง rollback | signed release evidence + recovery result |
| 7 | เพิ่มร้านกลุ่มสองเมื่อ blocker ของกลุ่มแรกปิดแล้ว | go/no-go decision |
| 8 | ทดสอบไฟดับ disk full restart และ suspend/resume บน target จริง | failure-recovery evidence |
| 9 | ทบทวน peripheral matrix และข้อความคู่มือจากเคสจริง | matrix พร้อมรุ่น/OS/release |
| 10 | ตรวจ backup freshness และสุ่ม restore ซ้ำ | backup/restore sample report |
| 11 | สรุป conversion, support load, incident และช่องว่าง telemetry | metric report พร้อมข้อจำกัด |
| 12 | owner review: หยุด ขยาย pilot หรือเริ่มปิด GA blockers | มติลงนาม; ห้ามเรียก GA โดยอัตโนมัติ |
