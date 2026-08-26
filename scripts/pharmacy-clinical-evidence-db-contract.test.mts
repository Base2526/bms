// =============================================================
// หลักฐานทางคลินิกของเคสหน้าร้าน (9.25)
// -------------------------------------------------------------
// สามอย่างต่อเคส: รูปใบสั่งยา, เลขอ้างอิงใบสั่งยา, บันทึกการให้คำแนะนำ
// เก็บจนกว่าจะมีคนลบ · ลบแบบ soft delete · ผู้ชม = เภสัชกร/แอดมิน
//
// สิ่งที่เทสนี้คุมและสำคัญที่สุด: **file_id ห้ามหลุดออกไปฝั่ง client**
// เพราะ /api/files/[id] ไม่มี auth และ id เป็นเลขเรียง ใครก็ไล่เดาได้
//
// สร้าง tenant ของตัวเองแล้วลบทิ้ง — ไม่ยืมร้านจริง เพราะเทสนี้ต้องตั้ง
// business_archetype = 'pharmacy' ซึ่งเปลี่ยนการกันบิลของทุกสินค้าในร้านนั้น
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/pharmacy-clinical-evidence-db-contract.test.mts
//
// Dev only — เขียนจริงลงฐาน
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  addClinicalEvidence,
  deleteClinicalEvidence,
  getEvidenceFileForStreaming,
  listClinicalEvidence,
} from "../apps/web/lib/bms/pharmacy/clinicalEvidence.ts";

const TAG = "rxevidence-test";

let tenantId = "";
let otherTenantId = "";
let assessmentId = "";
let otherAssessmentId = "";
let fileId = 0;
let imageEvidenceId = "";

const newTenant = async (suffix: string) => {
  const t = await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG} ${suffix}`, `fake-${TAG}-${suffix}-${Date.now()}`]
  );
  const id = t.rows[0].id;
  await query(`INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'pharmacy')`, [id]);
  return id;
};

const newCase = async (tid: string) => {
  const r = await query<{ id: string }>(
    `INSERT INTO bms_pharmacy_assessments
       (tenant_id, channel_id, patient_relationship, consent_status, status,
        needs_manual_intake, risk_level, complaint, structured_answers,
        missing_fields, conflicting_fields, completeness_status,
        customer_confirmation_status, expires_at)
     VALUES ($1,'pos','SELF','GRANTED','WAITING_FOR_PHARMACIST',FALSE,'LOW',
             '{}'::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
             'CONFIRMED', now() + interval '1 day')
     RETURNING id`,
    [tid]
  );
  return r.rows[0].id;
};

test("setup: two throwaway pharmacy tenants, one case each, one stored file", async () => {
  tenantId = await newTenant("main");
  otherTenantId = await newTenant("other");
  assessmentId = await newCase(tenantId);
  otherAssessmentId = await newCase(otherTenantId);
  const f = await query<{ id: number }>(
    `INSERT INTO files (filename, original_name, mimetype, size, relpath)
     VALUES ($1,$2,'image/png',1234,$3) RETURNING id`,
    [`fake-${TAG}.png`, "prescription.png", `fake/${TAG}.png`]
  );
  fileId = f.rows[0].id;
});

test("เก็บได้ทั้งสามอย่าง", async () => {
  const image = await addClinicalEvidence({
    tenantId, assessmentId, kind: "PRESCRIPTION_IMAGE",
    file: { id: fileId, name: "prescription.png", mimetype: "image/png", size: 1234 },
    actorUserId: null, source: "pos",
  });
  assert.equal(image.status, "ADDED", JSON.stringify(image));
  if (image.status !== "ADDED") return;
  imageEvidenceId = image.evidence.id;

  const ref = await addClinicalEvidence({
    tenantId, assessmentId, kind: "PRESCRIPTION_REF",
    textValue: "  RX-2569-0001  ", actorUserId: null, source: "queue",
  });
  assert.equal(ref.status, "ADDED");
  if (ref.status === "ADDED") {
    assert.equal(ref.evidence.textValue, "RX-2569-0001", "ต้อง trim ช่องว่างหัวท้าย");
  }

  const note = await addClinicalEvidence({
    tenantId, assessmentId, kind: "COUNSELING_NOTE",
    textValue: "กินหลังอาหารทันที ห้ามดื่มแอลกอฮอล์", actorUserId: null, source: "queue",
  });
  assert.equal(note.status, "ADDED");

  const all = await listClinicalEvidence(tenantId, assessmentId);
  assert.equal(all.length, 3);
  assert.deepEqual(
    [...all.map((e) => e.kind)].sort(),
    ["COUNSELING_NOTE", "PRESCRIPTION_IMAGE", "PRESCRIPTION_REF"]
  );
});

test("file_id ห้ามหลุดออกไปฝั่ง client — /api/files/:id ไม่มี auth และ id เดาได้", async () => {
  const all = await listClinicalEvidence(tenantId, assessmentId);
  for (const e of all) {
    const keys = Object.keys(e);
    assert.ok(!keys.includes("fileId"), `เจอ fileId ใน payload: ${keys.join(",")}`);
    assert.ok(
      !JSON.stringify(e).includes("/api/files/"),
      "ห้ามชี้ไปที่ route ไฟล์ที่ไม่มีการ์ด"
    );
  }
  const image = all.find((e) => e.kind === "PRESCRIPTION_IMAGE")!;
  assert.equal(image.fileUrl, `/api/bms/pharmacy/evidence/${image.id}/file`);
  const text = all.find((e) => e.kind === "PRESCRIPTION_REF")!;
  assert.equal(text.fileUrl, null, "รายการที่ไม่ใช่รูปต้องไม่มี fileUrl");
});

test("รูปแบบผิดถูกปฏิเสธ ไม่ใช่บันทึกครึ่ง ๆ", async () => {
  const noFile = await addClinicalEvidence({
    tenantId, assessmentId, kind: "PRESCRIPTION_IMAGE",
    file: null, actorUserId: null, source: "pos",
  });
  assert.equal(noFile.status, "INVALID");

  for (const kind of ["PRESCRIPTION_REF", "COUNSELING_NOTE"] as const) {
    const blank = await addClinicalEvidence({
      tenantId, assessmentId, kind, textValue: "   ", actorUserId: null, source: "queue",
    });
    assert.equal(blank.status, "INVALID", `${kind} ที่เป็นช่องว่างต้องไม่ผ่าน`);
  }

  const tooLong = await addClinicalEvidence({
    tenantId, assessmentId, kind: "COUNSELING_NOTE",
    textValue: "ก".repeat(4001), actorUserId: null, source: "queue",
  });
  assert.equal(tooLong.status, "INVALID");

  // ชั้น DB ต้องกันเองด้วย ไม่ใช่พึ่ง service อย่างเดียว
  await assert.rejects(
    query(
      `INSERT INTO bms_pharmacy_clinical_evidence
         (tenant_id, assessment_id, kind, file_id, text_value)
       VALUES ($1,$2,'COUNSELING_NOTE',$3,'มีทั้งไฟล์และข้อความ')`,
      [tenantId, assessmentId, fileId]
    ),
    /shape_check/,
    "CHECK ที่ตารางต้องกันการมีทั้งไฟล์และข้อความในแถวเดียว"
  );
});

test("แนบข้ามร้านไม่ได้ และสตรีมไฟล์ข้ามร้านไม่ได้", async () => {
  const crossTenant = await addClinicalEvidence({
    tenantId, assessmentId: otherAssessmentId, kind: "COUNSELING_NOTE",
    textValue: "ไม่ควรเข้าไปได้", actorUserId: null, source: "queue",
  });
  assert.equal(crossTenant.status, "CASE_NOT_FOUND", "เคสของร้านอื่นต้องมองไม่เห็น");

  const mine = await getEvidenceFileForStreaming(tenantId, imageEvidenceId);
  assert.ok(mine?.relpath, "ร้านเจ้าของต้องสตรีมได้");
  const theirs = await getEvidenceFileForStreaming(otherTenantId, imageEvidenceId);
  assert.equal(theirs, null, "ร้านอื่นต้องสตรีมไฟล์ของเราไม่ได้แม้รู้ evidence id");

  assert.equal((await listClinicalEvidence(otherTenantId, assessmentId)).length, 0);
});

test("ลบแล้วหายจากรายการ แต่แถวยังอยู่ให้ตรวจย้อนได้", async () => {
  const ok = await deleteClinicalEvidence(tenantId, imageEvidenceId, null);
  assert.equal(ok, true);
  const after = await listClinicalEvidence(tenantId, assessmentId);
  assert.equal(after.length, 2, "รายการที่ลบต้องไม่โผล่");
  assert.ok(!after.some((e) => e.id === imageEvidenceId));

  const row = await query<{ deleted_at: Date | null }>(
    `SELECT deleted_at FROM bms_pharmacy_clinical_evidence WHERE tenant_id = $1 AND id = $2`,
    [tenantId, imageEvidenceId]
  );
  assert.equal(row.rowCount, 1, "soft delete ต้องไม่ลบแถวจริง");
  assert.ok(row.rows[0].deleted_at, "ต้องมีเวลาที่ลบ");

  // ลบแล้วสตรีมไม่ได้อีก
  assert.equal(await getEvidenceFileForStreaming(tenantId, imageEvidenceId), null);
  // ลบซ้ำต้องไม่สำเร็จเงียบ ๆ
  assert.equal(await deleteClinicalEvidence(tenantId, imageEvidenceId, null), false);
});

test("ทุกการเพิ่ม/ลบมีร่องรอย และร่องรอยไม่เก็บเนื้อความ", async () => {
  const events = await query<{ action: string; meta: any }>(
    `SELECT action, meta FROM bms_pharmacy_assessment_events
      WHERE tenant_id = $1 AND assessment_id = $2
        AND action LIKE 'assessment.clinical_evidence%'
      ORDER BY created_at`,
    [tenantId, assessmentId]
  );
  const added = events.rows.filter((e) => e.action === "assessment.clinical_evidence_added");
  const deleted = events.rows.filter((e) => e.action === "assessment.clinical_evidence_deleted");
  assert.equal(added.length, 3, "เพิ่มสำเร็จ 3 ครั้งต้องมี 3 ร่องรอย (ที่ INVALID ไม่นับ)");
  assert.equal(deleted.length, 1);
  for (const row of events.rows) {
    const meta = JSON.stringify(row.meta ?? {});
    assert.ok(!meta.includes("แอลกอฮอล์"), "ร่องรอยห้ามเก็บเนื้อความคำแนะนำ (ข้อมูลสุขภาพ)");
    assert.ok(!meta.includes("RX-2569"), "ร่องรอยห้ามเก็บเลขใบสั่งยา");
  }
});

// ลบไฟล์ทิ้งได้ แต่แถวหลักฐานต้องอยู่เป็นหลักฐานว่าเคยมี (9.28)
//
// 9.25 เขียน constraint สองตัวขัดกันเอง: FK เป็น ON DELETE SET NULL แต่ CHECK
// บังคับว่าแถว PRESCRIPTION_IMAGE ต้องมี file_id → ลบแถวใน files ไม่ได้เลย
// (error เป็น shape_check ที่อ่านไม่รู้เรื่องเพราะพูดถึง UPDATE ที่ไม่มีใครสั่ง)
// สำคัญกับข้อมูลสุขภาพ: คำขอลบตาม PDPA ต้องลบตัวไฟล์ได้ โดยยังเหลือร่องรอยว่า
// เคยมีหลักฐานและใครแนบ
test("ลบไฟล์ได้ และเหลือแถวหลักฐานเป็น tombstone", async () => {
  const f = await query<{ id: number }>(
    `INSERT INTO files (filename, original_name, mimetype, size, relpath, visibility)
     VALUES ($1,$2,'image/png',10,$3,'private') RETURNING id`,
    [`fake-${TAG}-erase.png`, "erase.png", `fake/${TAG}-erase.png`]
  );
  const added = await addClinicalEvidence({
    tenantId, assessmentId, kind: "PRESCRIPTION_IMAGE",
    file: { id: f.rows[0].id, name: "erase.png", mimetype: "image/png", size: 10 },
    actorUserId: null, source: "queue",
  });
  assert.equal(added.status, "ADDED");
  if (added.status !== "ADDED") return;

  // เดิมบรรทัดนี้ throw shape_check
  await query(`DELETE FROM files WHERE id = $1`, [f.rows[0].id]);

  const row = await query<{ kind: string; file_id: number | null }>(
    `SELECT kind, file_id FROM bms_pharmacy_clinical_evidence WHERE tenant_id = $1 AND id = $2`,
    [tenantId, added.evidence.id]
  );
  assert.equal(row.rowCount, 1, "แถวหลักฐานต้องไม่หายไปพร้อมไฟล์");
  assert.equal(row.rows[0].kind, "PRESCRIPTION_IMAGE");
  assert.equal(row.rows[0].file_id, null, "file_id ต้องเป็น NULL = ไฟล์ถูกลบไปแล้ว");

  // ไม่มีไฟล์แล้วก็สตรีมไม่ได้
  assert.equal(await getEvidenceFileForStreaming(tenantId, added.evidence.id), null);
});

// CHECK ที่คลายแล้วต้องยังกันรูปแบบที่ผิดอยู่ครบ
test("คลาย CHECK แล้วยังกันรูปแบบผิดทั้งสามแบบ", async () => {
  const cases: Array<[string, string, any[]]> = [
    [
      "แถวข้อความที่มีไฟล์",
      `INSERT INTO bms_pharmacy_clinical_evidence (tenant_id, assessment_id, kind, file_id, text_value)
       VALUES ($1,$2,'COUNSELING_NOTE',$3,'x')`,
      [tenantId, assessmentId, fileId],
    ],
    [
      "แถวรูปที่มีข้อความ",
      `INSERT INTO bms_pharmacy_clinical_evidence (tenant_id, assessment_id, kind, text_value)
       VALUES ($1,$2,'PRESCRIPTION_IMAGE','x')`,
      [tenantId, assessmentId],
    ],
    [
      "ข้อความว่างเปล่า",
      `INSERT INTO bms_pharmacy_clinical_evidence (tenant_id, assessment_id, kind, text_value)
       VALUES ($1,$2,'COUNSELING_NOTE','   ')`,
      [tenantId, assessmentId],
    ],
  ];
  for (const [label, sql, params] of cases) {
    await assert.rejects(query(sql, params), /shape_check/, label + " ต้องถูกปฏิเสธที่ชั้น DB");
  }
});

test("teardown: drop both throwaway tenants and the stored file row", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`,
    [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, otherTenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length) {
    for (const table of [
      "bms_pharmacy_clinical_evidence",
      "bms_pharmacy_assessment_events",
      "bms_pharmacy_assessments",
      "bms_store_profile",
    ]) {
      await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    }
    await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  }
  // ลบ evidence ก่อน files เสมอ (ลำดับ FK) — ลิสต์ตารางด้านบนทำไปแล้ว
  await query(`DELETE FROM files WHERE relpath LIKE $1`, [`fake/${TAG}%`]);
  const left = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE slug LIKE $1`,
    [`fake-${TAG}-%`]
  );
  assert.equal(Number(left.rows[0].n), 0);
});
