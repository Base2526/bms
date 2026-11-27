# จอสั่งอาหารหน้าร้าน: ใบตรวจ pilot 1 สาขา

สถานะเอกสาร: ขั้นตอนตรวจที่ต้องทำบนฐานที่ restore และฮาร์ดแวร์จริง ยังไม่ใช่ผลผ่านการทดสอบ

ผลตรวจในเครื่องพัฒนา 27 พ.ย. 2026: browser fixture ของ `/kiosk/[token]` ดีไซน์แดง–ขาว
ผ่านที่ 1440×900, 1920×1080, 1080×1920 และ 390×844 px บน production build โดยตรวจ
การกรองหมวดจาก field ใน API fixture, รูปเสีย, ขนาดหมด, modifier บังคับ, ตะกร้า, response หาย,
สถานะคำขอ, idle reset, browser back/bfcache และหน้าเครือข่ายล้ม. ภาพ HOME, MENU, modal,
CART, PENDING/ACCEPTED/REJECTED/EXPIRED, unavailable และ network อยู่ใน
`.test-output/restaurant-kiosk-browser/`. Browser fixture ของ `/pos/restaurant?screen=kiosk`
และ `/admin/restaurant-floor` ผ่านที่ 1440/390 px โดยจำลอง API ใน Playwright
รวมการค้นรหัสคำขอ, หลักฐานบิล/ชำระ, และสถานะเมื่ออ่าน trace ไม่ได้
ไม่ได้ใช้ฐานหรือเครื่อง POS จริง; ภาพอยู่ใน
`.test-output/restaurant-kiosk-pos-browser/` และ
`.test-output/restaurant-kiosk-admin-browser/`. `cd apps/web && npm run gate` ผ่าน:
pure 4,037 (ผ่าน 4,031, ข้าม 6, ล้ม 0), typecheck และ production build ผ่าน.
`cd apps/mobile && npm test -- --runInBand` ผ่าน 524/524, typecheck ผ่าน; Desktop
`npm test` ผ่าน 179/179 และ lint ผ่าน. Kiosk Desktop lint/unit 7/7, Electron smoke,
native-main fixture และ Windows x64 package ผ่าน แต่ installer ล่าสุดยัง `NotSigned`.
ผลเหล่านี้ยังเป็น fixture/automated tests.
ยัง **ไม่ได้ทดสอบ** migration/DB service tests บนฐาน restore, Caddy ingress จริง, Redis หลาย instance,
จอ USB touch, KDS/เครื่องพิมพ์, การชำระเงินจริงหรือใบเสร็จจริง จึงยังเป็น **No-Go**

## ขอบเขตและผู้รับผิดชอบ

- ผู้จัดการสาขา: เลือกสาขา เครื่อง POS พนักงานรับคำขอ และอนุมัติเปิด/ปิดจอ
- พนักงานหน้าร้าน: ช่วยลูกค้า เฝ้า badge และค้นรหัสคำขอ ยืนยันโต๊ะ/บิล แจ้งราคาที่เปลี่ยน
- แคชเชียร์: เปิดกะ ใช้ PIN รับคำขอเมื่อพร้อมดำเนินการ เปิดบิลจากแผงจอสั่ง รับเงิน ตรวจใบเสร็จ/เลขรับอาหาร
- ครัว: ตรวจ KDS/station และงานพิมพ์ครัว; เมื่อผลพิมพ์ไม่แน่ใจ ตรวจถาดกับ journal ก่อน retry ด้วยคน
- วิศวกร: เตรียมฐานทิ้งได้ที่ restore จาก dev ที่เหมาะสม ตรวจ migration/rollback/audit และบันทึกผล

การรับคำขอส่งครัว **ก่อน** รับเงิน จึงให้แคชเชียร์รับเมื่อแขกยืนพร้อมชำระหรือพนักงานโต๊ะยืนยันว่าแขกยังอยู่จริง หากแขกไม่จ่าย ให้ผู้จัดการจัดการบิลผ่านการยกเลิก/void เดิมตามสถานะจริง อย่าลบ submission หรือแก้ stock เอง

## หลักฐานเริ่มต้น

บันทึกวันเวลา สาขาทดสอบ (รหัสสังเคราะห์), commit/working-tree hash, ฐาน restore และคำยืนยันว่าไม่ใช่ production, migration ที่ apply, เครื่อง POS/กะ/ผู้ทดสอบ, รุ่น/ขนาด/ความละเอียดจอ, OS/browser, HDMI/USB touch, network path, KDS/station/printer, การตั้งค่าเลขรับอาหาร และรูป/คลิป/SQL assertion พร้อมเวลาแต่ละกรณี อย่าใส่ token, PIN, raw note หรือข้อมูลลูกค้าจริงในหลักฐาน

## ฐานข้อมูลที่ทิ้งได้

เพิ่ม `10.147` ในการ apply/reapply บนฐาน restore: ตรวจ release identity
ไม่ซ้ำ, branch grant composite FK, RLS/grants/revision/audit ภายใต้
`bms_app` ทั้ง tenant GUC ถูก/ผิด/ว่าง และตรวจว่า migration ไม่เผยแพร่
installer ใดเอง ห้ามรันบน production

## ไฟล์ติดตั้งและการเผยแพร่

| ขั้นตอน | ผลที่ต้องเห็น | หลักฐาน |
| --- | --- | --- |
| Platform admin อัปโหลด Windows x64 NSIS พร้อม SHA-256 แล้วตรวจไฟล์จริง | release เป็น draft; SHA-256 และ Authenticode มีผลตรวจจริง; unsigned/corrupt เผยแพร่ไม่ได้ | hash, signature status, release id ที่ไม่ใช่ token |
| Publish ให้สาขา pilot แล้วเข้าหลังบ้าน `/admin/restaurant-floor` ด้วยผู้จัดการสาขา | เห็นเฉพาะรุ่นที่เผยแพร่ของสาขานั้น, วันเผยแพร่, ขนาด, hash, minimum OS และคู่มือ | screenshot ที่ตัดข้อมูลอ่อนไหว, HTTP status |
| ลอง session ไม่มีสิทธิ์/ผิดสาขา/ไม่มี session/public kiosk URL, draft/hidden/ID เดา | ไม่ดาวน์โหลด; 401/403/404 ตามเหตุ; Redis rate limit ล้มได้ 503 | HTTP trace ที่ตัด cookie/token |
| ดาวน์โหลดไฟล์ขนาดจริงและตรวจบนเครื่อง IT | stream สำเร็จ, SHA-256 ตรง, Authenticode Valid และ signer ที่อนุมัติ | hash/signature, ขนาดไฟล์, memory profile |
| ติดตั้ง/อัปเกรด/rollback บัญชี OS เดิม, reboot และ OS lockdown | config ที่เข้ารหัสอยู่ครบ; หน้าลูกค้าเปิดได้เฉพาะ URL ที่ผูก; หลุดไป desktop ไม่ได้ | คลิปและ checklist เครื่อง pilot |

ไฟล์ที่เคยแพ็กได้ยัง `NotSigned`: คงเป็น draft จนลงลายเซ็นและทดสอบบน
เครื่องจริงผ่าน ห้ามใช้ gate/build หรือ browser fixture แทนผลนี้

| ขั้นตอน | ผลที่ต้องเห็น | หลักฐาน |
| --- | --- | --- |
| Restore ฐาน dev ที่เหมาะสมใน instance แยก; ตรวจ hostname/database ก่อนเริ่ม | ไม่มีการต่อ production; schema ตั้งต้นครบ | คำสั่ง restore ที่ปิดรหัสผ่าน, fingerprint dump, hostname/db |
| Apply `10.144` และ `10.145` แล้ว reapply | รอบสอง idempotent; ตาราง/index/policy/grant/revision trigger ครบ | log migration, `pg_indexes`, `pg_policies`, `information_schema` |
| สร้าง URL 2 ครั้งสาขาเดียวกันพร้อมกัน | active เพียงหนึ่ง URL; URL เดิมใช้ไม่ได้หลังหมุน/ปิด | SQL count, HTTP status, audit/revision |
| ใช้ `SET ROLE bms_app` กับ tenant GUC ที่ถูก/ผิด/ว่าง และ token-hash GUC | submission ไม่มี GUC ต้องไม่เห็นข้อมูล; locator เห็นเฉพาะ token hash ที่ตรงและ active; ห้ามใช้ token GUC เขียน | SQL matrix, current role/GUC |
| ป้อน kiosk/check ข้าม tenant/branch | composite FK และ service ปฏิเสธ ไม่มีข้อมูลข้ามสาขา | SQLSTATE, count ก่อน/หลัง |
| Submit key เดิมพร้อมกัน/ส่งซ้ำ | submission เดียวและรหัสเดิม | count/idempotency result |
| รับคำขอเดียวกันจาก POS สองเครื่องพร้อมกันและทำให้ response แรกหาย | check/order/reservation/ticket/audit อย่างละชุด; replay ชี้ check เดิม | row ids/count/stock movement |
| 20 บรรทัดโดยบรรทัดท้ายผิด, หมดสต็อก, sold-out, modifier/size เปลี่ยน | transaction rollback; ไม่มี check/order/stock/KDS/audit ครึ่งชุด | before/after SQL และ error |
| DINE_IN ไม่มี check, เปิด check, ย้ายโต๊ะ, split, ปิด check, มี NEW ค้าง, สั่งเพิ่ม | ใช้ได้เฉพาะ check ที่ OPEN/DINE_IN/สาขาถูกและตรง preview; กรณีเปลี่ยนไม่มี partial write | check version/table/opened_at และผลแต่ละกรณี |
| ราคาเปลี่ยนหลัง submit และหลัง preview | ต้องเห็นยอดเดิม/ใหม่; accept ที่ใช้ fingerprint เก่าถูกปฏิเสธ; ยืนยันราคาใหม่ก่อนรับ | ราคา/quote fingerprint, audit ที่ไม่เก็บ note |
| ยกเลิก/return/void หลังส่งหรือหลังขาย | ใช้บริการ POS เดิม สต็อก/เงิน/ตั๋ว/ภาษีสอดคล้อง | movement, payment, receipt/return IDs |

**ยังต้องพิสูจน์:** `10.145` เปลี่ยน RLS fallback ของ `10.144` เป็น fail closed พร้อม token-hash locator ที่ตั้งค่าเฉพาะ transaction ต้องทดสอบภายใต้ `bms_app` และ public API จริงบนฐาน restore ก่อนเปิด URL กว้าง

หลังยืนยันว่า `POSTGRES_HOST`/`POSTGRES_DB` ชี้ instance ที่ restore และทิ้งได้ ให้รัน `BMS_KIOSK_RESTORED_DB=1 node scripts/run-contract-tests.mjs db restaurant-kiosk-db-contract` จาก root (PowerShell ตั้ง `$env:BMS_KIOSK_RESTORED_DB='1'` ก่อน) ชุดนี้ตรวจ reapply migration, RLS ภายใต้ `bms_app`, token locator, unique และ composite FK ใน transaction ที่ rollback ทั้งหมด จากนั้นรัน `node scripts/run-contract-tests.mjs db restaurant-pos-db-contract` ด้วย fixture ร้านอาหารแยก ซึ่งรวมสองคำขอ TAKEAWAY, duplicate accept และ 20-line rollback. ทั้งสองชุดยังต้องรันจริงและเพิ่มหลักฐานของ route/PIN, DINE_IN race, settlement/return และ pickup queue ก่อนผ่าน gate pilot

## จอสัมผัสและเส้นทางจริง

| ขั้นตอน | ผลที่ต้องเห็น | หลักฐาน |
| --- | --- | --- |
| ต่อ HDMI/DisplayPort และ USB touch, reboot | ภาพและ touch ผูกกับจอที่ถูก ไม่แตะแล้วไป POS; kiosk mode กลับมาได้ | คลิปก่อน/หลัง reboot, display map |
| ตรวจ calibration ทั้ง 4 มุม, scaling 100/125/150%, ความละเอียดจริง | ปุ่มขนาด/ตัวเลือก/จำนวน/ส่งแตะได้; ไม่มีปุ่มถูกตัดหรือ horizontal overflow | ภาพ 4 มุม, resolution/scaling |
| เปิดดีไซน์ใหม่ที่ 1080×1920, 1920×1080 และ 390 px | HOME/MENU/modal/CART/STATUS อ่านได้ ปุ่มหลักแตะง่าย sticky cart ไม่บังการ์ดใบสุดท้าย | ภาพแต่ละขนาด, touch recording |
| ตั้งหมวดและรูปใน catalog ของร้าน แล้วลองหมวดว่าง/รูปเสีย | เห็นเฉพาะหมวดจริงจาก `bms_products.category`; เมนูไร้หมวดยังอยู่ใน ทั้งหมด; hero/การ์ดใช้รูปของร้านหรือ fallback กลาง ไม่มีรูป demo หรือป้ายโปรโมชันปลอม | API response ที่ตัด token, ภาพจอ |
| ขนาดราคาถูกหมดและ modifier บังคับ | ราคาเริ่มต้นมาจากขนาดที่ขายได้; ขนาดหมดกดไม่ได้; เพิ่มตะกร้าไม่ได้จนเลือก modifier บังคับ; ราคา modal มาจาก detail API | request/response ที่ตัด token, ภาพ modal |
| เปิด browser kiosk mode และ virtual keyboard ไทย/อังกฤษ | พิมพ์ค้นหา/หมายเหตุได้ focus ไม่หลุด modal; screen reader อ่าน label ที่ใช้ได้ | คลิปและรายการปัญหา |
| เลือกทั้งโหมด เมนูหลายขนาด modifier บังคับ ภาพโหลดไม่ขึ้น | การ์ดหลายขนาดบอก “ราคาเริ่มต้น”; modifier ที่บังคับต้องเลือก; ภาพล้มไม่บังชื่อ/ราคา | screenshot สองภาษาและเมนูตัวอย่าง |
| ส่งแล้วกดซ้ำ, ตัด Wi-Fi ระหว่างส่ง, refresh/back/restart | ไม่สื่อว่าแน่นอนว่าล้ม; พนักงานค้นรหัสก่อนคีย์ใหม่; ลูกค้าคนถัดไปไม่เห็น cart/note/status เดิม | network trace, screen recording, submission/check count |
| ปล่อยจอไม่มีการใช้งาน 2 นาที และลอง browser back | กลับหน้าแรก ไม่มีข้อมูลก่อนหน้า | คลิปพร้อมเวลา |
| เปิดกะ ใช้ PIN ถูก/ผิด/ไม่มีสิทธิ์/ผิดสาขา; ปิดกะ | รับ/จัดการ URL ได้เฉพาะผู้มีสิทธิ์และกะเปิด; ก่อนปิดกะปิดจอและจัดการ pending | POS/HTTP/audit screenshot |
| TAKEAWAY สองคำขอติดกัน | ค้นแต่ละรหัส เปิดบิลตรงใบ ชำระเงินแยกและพิมพ์ใบเสร็จถูกใบ | รหัส→check→order→receipt ทั้งสอง |
| DINE_IN เปิดโต๊ะก่อนรับ, split/move/close ระหว่าง preview | UI บอก area/โต๊ะ/เลขบิลและบังคับยืนยัน; server ปฏิเสธ stale preview | คลิป/SQL before-after |
| KITCHEN_WORKFLOW เปิด/ปิด, station, KDS, printer timeout | ตั๋วตาม branch/station; ไม่พิมพ์ซ้ำอัตโนมัติเมื่อผลไม่แน่ใจ | KDS screenshot, print journal, ถาดจริง |
| รับ cash/split tender, VAT/ส่วนลดที่ต้องอนุมัติ, receipt | ยอดจริง/ภาษี/ส่วนลด/เงินทอนจาก POS; kiosk ไม่รับเงิน | receipt และ settlement response |
| เลขรับอาหารปิด/เปิด, ออกเลขล้มหลังขาย, issue-again, READY/call/collect | ไม่สร้างเลขจากรหัสคำขอ; ขายสำเร็จไม่กลายเป็นล้ม; retry คืนเลขเดิม | order/queue ids, จอคิว, ใบเสร็จ |
| หมุน/ปิด URL ขณะมี pending | URL เก่าตอบ 410; จอเก่าล้างข้อมูลและบอกให้ติดต่อพนักงาน; pending ไม่เข้าครัว | HTTP/status, audit, ticket count |
| Desktop เปิด `/pos/restaurant?screen=kiosk` จาก pairing จริงและเน็ตหลุด | ค้นรหัส เปิด check ที่ผูก และกลับมา refresh ได้; journal บันทึก route แต่ไม่มี token/PIN/note | คลิป Desktop, journal ที่ redacted |
| Mobile Restaurant Ops → จอสั่งอาหาร บนเครื่องจับคู่ | badge/เสียงขึ้นภายในรอบ poll; ค้นรหัสนอก 100 แถว; quote ราคา/ตัวเลือก/โต๊ะหลัง split ตรง server; รับ/ปฏิเสธด้วย PIN และเปิด check ที่ผูกไป Checkout ได้ | คลิป iOS/Android, GraphQL trace ที่ตัด PIN, check/receipt ids |
| หลังบ้านหน้าจัดผังร้านเลือกสาขาที่มี/ไม่มี URL | แสดงสถานะและ pending count เฉพาะสาขาที่มีสิทธิ์; URL เดิมไม่ปรากฏ; ลิงก์พาไป POS เพื่อจัดการจอ | ภาพสองสาขา, denial ข้ามสาขา |
| หลังบ้านค้นรหัสคำขอ TAKEAWAY และ DINE_IN ก่อนและหลังชำระ | PENDING ไม่เป็นยอดขาย; ACCEPTED ผูก check และ order ปัจจุบัน; PAID ต้องมี check PAID, order COMPLETED และเวลา paid_at; แสดง payment ID, ใบเสร็จ และเลขรับอาหารเฉพาะเมื่อมีจริง | รหัสคำขอ→submission→check→order→payment→receipt→queue ที่ตัด note/PIN/token |
| เปลี่ยนรอบครัวหรือคืนเงิน แล้วค้นรหัสเดิม | order ที่แสดงเป็น order ปัจจุบันของ check; รายการ RETURNED/สถานะไม่แน่ใจไม่ถูกเรียกว่าเพิ่งชำระ และต้องตรวจประวัติ POS | before/after IDs และสถานะจาก DB/POS |
| ใช้ manager ผิดสาขาหรือปิดเน็ตระหว่างดู trace | API ปฏิเสธ 403 หรือจอแจ้งตรวจ POS; ไม่แสดงผลเก่าราวกับเป็นสถานะใหม่ | HTTP status, screenshot สองสาขา |

## Go / No-Go

### Desktop Kiosk shell และ PIN ดูแลจอ (เพิ่มใน pilot gate)

บนฐาน dev restore ที่ทิ้งได้และยืนยัน host/database แล้ว รัน `BMS_KIOSK_RESTORED_DB=1 node scripts/run-contract-tests.mjs db restaurant-kiosk-device-db-contract` จาก root (PowerShell ตั้ง environment variable ก่อนรัน) เพื่อพิสูจน์ `10.146`, การลอง PIN พร้อมกัน, การล็อก, การเปลี่ยน PIN, การหมุน credential และ audit; ถ้าไม่มีฐานดังกล่าวให้บันทึกว่า **ไม่ได้ทดสอบ**

| ขั้นตอน | ผลที่ต้องเห็น | หลักฐาน |
| --- | --- | --- |
| Apply/reapply `10.146` บนฐาน restore ที่ทิ้งได้ | unique หนึ่งเครื่องต่อสาขา, FK, grants, RLS เมื่อไม่มี tenant GUC, locator เฉพาะ credential, revision ไม่มี hash | SQL assertion และ migration log |
| ลงทะเบียนเครื่องในหลังบ้านเฉพาะสาขาที่มีสิทธิ์ ตั้ง PIN และคัดลอกรหัสเครื่องครั้งเดียว | รายการแสดงสถานะ/เวลาเปลี่ยน แต่ไม่แสดง PIN/hash; ผู้ไม่มีสิทธิ์หรือผิดสาขาถูกปฏิเสธ | ภาพหลังบ้านและ HTTP status ที่ปิดบัง credential |
| ติดตั้ง URL จาก POS และรหัสเครื่องบน Desktop Kiosk | backend ยืนยันว่าสาขาเดียวกันก่อนเปิด `/kiosk/[token]`; guest ไม่มี preload/IPC/POS token | ภาพจอ, process inspection, network trace ที่ปิด token |
| กรอก PIN ถูก/ผิด 5 ครั้งพร้อมกัน/ล็อก/เปลี่ยน PIN/เพิกถอนเครื่อง | ถูกเปิดตั้งค่าได้ 2 นาทีเท่านั้น; PIN เก่าและ credential เก่าใช้ไม่ได้; customer page ปิดเมื่อเพิกถอน | วิดีโอ, audit ที่ไม่เก็บ PIN, count/lock timestamp |
| ปิดหน้าตั้งค่า, restart แอป, เน็ตล้ม, secure storage เสีย | ไม่คืนสถานะปลดล็อก; PIN ที่ตรวจไม่ได้ fail closed; IT กู้ผ่านบัญชี OS โดยไม่ลบคำขอขาย | คลิปและคู่มือ recovery |
| โหลดหน้าลูกค้าช้าระหว่างเปิดหน้า PIN/กู้จอ; HTTP 429, Redis 503, timeout, server 5xx, URL ผิดสาขา | callback เก่าไม่แย่งหน้าจอ; ข้อความระบุเหตุและการแก้ที่ตรงกัน; 429 ไม่แสดงเป็น PIN ล็อก | คลิปและ HTTP trace ที่ไม่เผย token/PIN |
| ต่อ HDMI/USB touch, calibration, scaling, reboot และกลับจากเน็ตล้ม | จอลูกค้าแสดงถูกต้อง, ตั้งค่าต้องใช้ PIN, พนักงานตรวจคำขอใน POS ก่อนคีย์ซ้ำ | คลิป/ภาพจอและรหัสคำขอที่ตัดข้อมูล |
| ตรวจ Windows edition และเลือก OS lockdown สำหรับ Electron | แยกบัญชีจอลูกค้าแบบ standard จาก IT admin; ถ้าใช้ Shell Launcher ต้องเป็น edition ที่รองรับและตั้งนโยบายล็อกเพิ่ม; ทดสอบ Alt+Tab/Alt+F4/Windows key/USB keyboard | edition/build, policy, วิดีโอทุกปุ่ม; อ้างอิง Microsoft Learn ใน README ของแอป |
| อัปเกรด/rollback installer และ login/reboot ด้วยบัญชีจอลูกค้า | เปิดเองหลัง sign-in, URL encrypted เดิมยังอ่านได้เมื่อ upgrade, downgrade ไม่ทำ config เสียเงียบ | installer hash/version, screenshot หลัง reboot, ผล getLoginItemSettings/OS policy |

ชุด Electron smoke ใช้ fixture และหน้าต่างที่สร้างในเครื่องพัฒนาเท่านั้น ไม่เท่ากับการทดสอบจอ 1080×1920, USB touch หรือเครื่องพิมพ์จริง

**Go เฉพาะ pilot มีพนักงานกำกับ 1 สาขา** เมื่อฐาน restore ผ่านทุกกรณี P0 ที่มีเงินจริง/สต็อก, จอ touch + POS + KDS/เครื่องพิมพ์ + receipt/queue ผ่านจริง, พนักงานซ้อม fallback, มีผู้เฝ้าคำขอทุกช่วงเปิดจอ และผู้จัดการลงชื่อรับความเสี่ยงที่ยังเหลือ หากข้อใดไม่มีผลทดสอบ ให้เป็น **No-Go** แม้ `npm run gate` ผ่าน

ก่อนขยายหลายสาขา: พิสูจน์ RLS/token locator ที่เพิ่มแล้ว; เสนอให้แปลง `PENDING` ที่เกิน 30 นาทีเป็น `EXPIRED` แล้วลบ proposal ที่ปฏิเสธ/หมดอายุเมื่อเกิน 30 วัน และลบ proposal ที่รับแล้วเมื่อเกิน 365 วัน โดยคง check/order/payment/receipt/audit ตามนโยบายหลักของระบบและเก็บ mapping ใน audit — ต้องให้เจ้าของข้อมูลอนุมัติช่วงเวลาและทดสอบ cleanup/restore ก่อนเปิด worker; เพิ่ม monitoring อายุ pending, acceptance failure, rate-limit, queue issue, KDS/print โดยใช้ metrics/structured logs ที่มีอยู่แทนการเขียน per-request ลง Postgres; load test Redis outage/429/503 หลาย instance และ fleet ceiling, 100 pending และตัดสินใจโมเดล URL ต่อเครื่องหรือสาขา. Kiosk throttling ไม่ใช้ `x-forwarded-for` เป็นฐาน IP limit

P2 ต้องทำ discovery แยก: เลือกโต๊ะเอง, ชำระที่จอ, พิมพ์ใบรับคำขอ/เลขคิวจากจอ, คาดการณ์เวลารอ
