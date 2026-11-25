# Prompt: ตรวจรับและปิดงาน outpatient clinic technical pilot

ทำงานบน branch `codex/clinic-outpatient-pilot` ของ repository BMS นี้จนจบงาน ใช้ข้อมูลสังเคราะห์เท่านั้น ไม่ deploy ไม่เปิด `BMS_CLINIC_PILOT_TENANTS` เป็นค่าเริ่มต้น และไม่อ้างว่าพร้อมใช้กับผู้ป่วยจริง อ่าน `AGENTS.md`, `CLAUDE.md`, `docs/agent-invariants.md`, `docs/AI_GUIDELINES.md`, `docs/business/clinic-adoption-plan-th.md` และ `docs/business/clinic-pilot-technical-th.md` รวมถึง service, adapter, UI, migration และ permission ที่เกี่ยวข้องก่อนแก้ไข

## เป้าหมาย

ตรวจซ้ำโมดูลคลินิกผู้ป่วยนอกตั้งแต่ลงทะเบียน → นัดหมาย → เช็กอิน → เวชระเบียน → ลงนาม/addendum → charge sheet → order/ชำระเงิน → ประวัติและ audit แล้วแก้ข้อบกพร่องที่พบให้ครบตามขอบเขต technical pilot ตรวจ `apps/desktop` และ `apps/mobile` ด้วยว่ามีเส้นทาง POS, order, payment, printing, realtime หรือ navigation ใดได้รับผลกระทบหรือทำข้อมูลสุขภาพรั่ว หากต้องแก้ให้แก้ในแอปนั้นและรัน suite ของแอปนั้น อย่าเพิ่ม UI คลินิกใน POS เพียงเพราะเป็นคนละ platform; ให้ยึดสถาปัตยกรรมที่มีอยู่จริง

## วิธีทำงาน

1. ตรวจ `git status`, branch, remote และการเปลี่ยนแปลงที่มีอยู่ก่อน รักษางานเดิมของผู้ใช้ ห้ามแตะ `.env*`, credentials, customer/patient data จริง, database dump หรือ generated artifact ที่ไม่เกี่ยวข้อง
2. ทำ checklist ตามขอบเขต: identity/guardian, scheduling/concurrency, clinical access, notes/files, billing/payment/stock, privacy, web UI/API, desktop, mobile, manual, migration และ verification แยกสิ่งที่พิสูจน์แล้วกับสิ่งที่ยังต้องทดสอบ
3. ตรวจ code path จริงทั้ง caller และ service โดยเฉพาะ tenant/RLS, RBAC + active clinic role + care relationship, Administrator/platform admin, file endpoint, audit/log metadata, order channel `clinic`, retry, rollback, no-stock และการใช้หน้า Payment เดิม แก้เฉพาะช่องโหว่ที่มีหลักฐานหรือข้อกำหนดชัด
4. ทำคู่มือคลินิกในแอปโดยดูรูปแบบคู่มือที่ BMS ใช้อยู่จริงก่อน: โครงเรื่อง ไทย/อังกฤษ navigation, ขั้นตอนตามบทบาท, สถานะ/ข้อความผิดพลาด, การแก้ปัญหา, ข้อจำกัด pilot และ link ไปหน้าใช้งาน คู่มือต้องตรงกับ code ไม่สร้างคำอ้างว่า clinical/tax compliance ผ่านแล้ว อัปเดต docs และ Assistant guide ที่เกี่ยวข้องให้สอดคล้อง
5. หลังแก้แต่ละส่วนรัน narrow tests ก่อน ตรวจผล แก้และรันซ้ำ เพิ่ม test ที่พิสูจน์ boundary จริง ไม่ทำ test ที่เพียงสแกนข้อความหรือจำลองผลผ่านโดยไม่เดินเส้นสำคัญ รัน `apps/web` gate; ถ้าแก้ mobile ให้รัน typecheck/Jest/GraphQL contract ที่เกี่ยวข้อง; ถ้าแก้ desktop ให้รัน lint และ `node --test`; ถ้าแก้ route/layout/CSS ให้ตรวจ browser desktop/mobile width ถ้าเข้า authenticated page ไม่ได้ ให้ระบุข้อจำกัดจริง
6. DB tests ใช้ local/throwaway synthetic DB เท่านั้น ตรวจ migration รันซ้ำ, constraint/RLS/grants/tenant-branch denial และ transaction เท่าที่ fixture รองรับ ถ้าไม่มี restored BMS schema ห้ามอ้างว่าพิสูจน์ integration/payment end-to-end แล้ว
7. ตรวจ `git diff --check`, status และไฟล์ที่จะ stage ทีละรายการ จากนั้น commit งานที่เกี่ยวข้องทั้งหมดบน branch นี้ และ push `origin` branch นี้ตามที่ผู้ใช้อนุญาต ตรวจว่า push สำเร็จและรายงาน commit hash ห้าม commit secrets หรือข้อมูลจริง

## เกณฑ์จบ

ส่งผลที่แก้และเส้นทางไฟล์, ชุดทดสอบที่รันจริงและผล, ข้อที่ยังไม่ได้พิสูจน์, ความเสี่ยงและ release gates สำหรับผู้รับผิดชอบทางคลินิก ความเป็นส่วนตัว และบัญชี/ภาษี ระบุให้ชัดว่า feature flag ยังปิดและ technical pilot ยังไม่ใช้ผู้ป่วยจริง
