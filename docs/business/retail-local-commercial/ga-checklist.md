# ร่าง checklist จาก Retail Local รุ่นนำร่องสู่ GA

> สถานะ: **ร่างรอเจ้าของอนุมัติ** เรียงตามผลกระทบต่อการขาย ไม่ใช่หลักฐานว่า GA แล้ว
> ค่าใช้จ่ายทุกช่วงเป็นกรอบประมาณการสำหรับตั้งงบ ต้องขอใบเสนอราคาและตรวจราคาปัจจุบันก่อนอนุมัติ

แหล่งสถานะทางวิศวกรรม: [Retail Local GA readiness](../retail-local-ga-readiness.md)

## P0 — ต้องปิดก่อนขายในวงกว้าง

- [ ] **เซ็นโค้ด Windows เป็นอันดับแรก** — Authenticode-sign bootstrap, host agent และ Desktop,
  มี timestamp และหลักฐานติดตั้งผ่าน SmartScreen บน clean Windows 11/target ที่รองรับ
  - งบเพื่อพิจารณา: **หลักพันปลายถึงหลักหมื่นบาทต่อปี** ขึ้นกับชนิด certificate/token/service
  - ต้องตรวจ: ผู้ขาย certificate, เงื่อนไข EV/OV, hardware/cloud key custody, timestamp และนโยบาย SmartScreen
- [ ] **production release key custody** — key อยู่ใน isolated signing service มีสิทธิขั้นต่ำ rotation,
  recovery และ audit ที่ซ้อมจริง
  - งบเพื่อพิจารณา: **หลักพันถึงหลักหมื่นบาทต่อเดือน** ตาม HSM/KMS/CI และปริมาณ signing
  - ต้องตรวจ: cloud region, HSM tier, audit retention และค่า egress/operation
- [ ] **deploy และ qualify licensing control plane** — จำกัด platform admin, ทดสอบ one-use activation,
  retry, duplicate/key/chain review, commercial action idempotency และ transfer โดยไม่มี kill switch
  - งบเพื่อพิจารณา: **หลักพันถึงหลักหมื่นบาทต่อเดือน** สำหรับ hosting, DB, monitoring และ on-call
  - ต้องตรวจ: topology จริง ปริมาณร้าน retention และ backup ของ control plane
- [ ] **replacement-machine restore + off-host backup qualification** — ทำ scheduled export ไป USB/NAS จริง
  บังคับ failure ให้เตือน แล้ว restore DB/files/secrets บนคนละเครื่องพร้อม reconcile
  - งบเพื่อพิจารณา: **หลักหมื่นถึงหลักแสนบาทแบบครั้งเดียว** สำหรับเครื่องทดสอบ สื่อเก็บข้อมูล และแรงงาน
  - ต้องตรวจ: จำนวน OS/รุ่นเครื่อง ขนาดข้อมูล และรอบทดสอบ

## P1 — ลดความเสี่ยงปิดการขายและซัพพอร์ต

- [ ] **transactional update qualification** — exact signed update, incompatible-schema rollback,
  power interruption และ reconciliation บน Windows/Ubuntu
- [ ] **clean-machine acceptance matrix** — Windows 11, Windows 10 IoT Enterprise LTSC 2021,
  Ubuntu 24.04; แยก transition target และ macOS experimental ไม่ปะปน
- [ ] **failure recovery** — power loss, disk full, forced restart, suspend/resume และ lost pairing-token path
- [ ] **peripheral certification** — ระบุชื่อรุ่น printer/scanner/drawer/customer display, OS, release และผลจริง
- [ ] **support lifecycle** — รุ่นที่รองรับ ช่องทางตอบสนอง key/package revocation, end-of-support และ escalation

กรอบงบรวม P1: **หลักหมื่นถึงหลักแสนบาท** ตามจำนวนเครื่อง อุปกรณ์ และวันทดสอบ ต้องขอราคาฮาร์ดแวร์
ห้องทดสอบและแรงงานก่อนอนุมัติ ไม่ถือช่วงนี้เป็นใบเสนอราคา

## P2 — ขยาย target และความน่าเชื่อถือ

- [ ] **Linux package trust** — signed repository/package metadata และ clean-host verification
- [ ] **macOS package trust** — Developer ID sign + notarize bootstrap และ Desktop ทั้ง Apple Silicon/Intel;
  ทดสอบ Gatekeeper บนเครื่องจริง
- [ ] **macOS capability gap** — signed transactional update, scheduled off-host backup, restore orchestration
  และ package signing/notarization ต้องครบก่อนเลิกป้าย experimental
- [ ] **consent-gated diagnostics qualification** — ทดสอบ redaction, transport, encryption, retention,
  authorization และการยินยอมต่อเคสกับ exact release

กรอบงบ P2: **หลักพันถึงหลักหมื่นบาทต่อปีสำหรับบัญชีนักพัฒนา/บริการเซ็น** บวก **หลักหมื่นถึง
หลักแสนบาทสำหรับเครื่องและแรงงานทดสอบ** ต้องตรวจค่าธรรมเนียม Apple, certificate, CI และฮาร์ดแวร์
ในวันที่จัดซื้อ

## หลักฐานก่อนเปลี่ยน channel เป็น stable

- [ ] `promotion-evidence.json` ตรง exact release version, target และ source commit
- [ ] ทุก gate มี HTTPS evidence ที่ยังไม่หมดอายุและผู้จัดการ release ตรวจความแท้แล้ว
- [ ] รัน `verify-promotion-evidence.mjs` ผ่านกับ release descriptor จริง
- [ ] เจ้าของลงนาม go-live, ฝ่ายกฎหมายอนุมัติ EULA และฝ่ายปฏิบัติการรับ support/on-call
- [ ] หน้าเว็บ เอกสารขาย installer และ release metadata เปลี่ยนคำจากรุ่นนำร่องเฉพาะเมื่อหลักฐานครบ

การผ่าน structural verifier อย่างเดียวไม่เท่ากับ GA และห้ามใช้ checklist ที่ทีมเขียนเองแทน hardware,
security, legal และ operations evidence
