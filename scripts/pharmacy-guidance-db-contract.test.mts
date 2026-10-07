// =============================================================
// Pharmacist-approved customer guidance (10.45)
// -------------------------------------------------------------
// What this pins against a real database:
//   * a customer only ever reads APPROVED text; no text = the existing handoff
//   * approval is a fact about the person (licensed pharmacist), not a role
//   * approval pins the version the pharmacist read
//   * editing approved text returns it to draft — in the service AND in the DB trigger
//   * one shop never serves another shop's text
//
// Creates its own throwaway tenants and deletes them. Dev only — writes to the database.
// Run: node scripts/run-contract-tests.mjs db pharmacy-guidance
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  PharmacyGuidanceError,
  approvePharmacyGuidance,
  getApprovedPharmacyGuidanceBody,
  listPharmacyGuidanceTemplates,
  pharmacyClinicalGuidanceReply,
  retirePharmacyGuidance,
  savePharmacyGuidanceDraft,
  seedPharmacyGuidanceDrafts,
} from "../apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts";
import { PHARMACY_GUIDANCE_CODES, PHARMACY_GUIDANCE_FOOTER } from "../apps/web/lib/bms/pharmacy/guidanceTemplates.ts";
import { pharmacyClinicalHandoffReply } from "../apps/web/lib/bms/pharmacy/customerAssistancePolicy.ts";

const TAG = "rxguidance-test";
const INTERACTION_TH = "กินคู่กับยาความดันได้ไหม";

let tenantId = "";
let otherTenantId = "";
let adminId = "";
let pharmacistId = "";
let otherPharmacistId = "";

const newTenant = async (suffix: string) => {
  const t = await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG} ${suffix}`, `fake-${TAG}-${suffix}-${Date.now()}`]
  );
  const id = t.rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype, phone, business_hours)
     VALUES ($1,'pharmacy','02-555-0101','09:00-20:00')`,
    [id]
  );
  return id;
};

const newUser = async (tid: string, label: string, licensed: boolean) => (await query<{ id: string }>(
  `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test,
                      is_licensed_pharmacist, pharmacist_license_no)
   SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE, $4, $5
     FROM roles r WHERE r.name = 'Administrator' LIMIT 1
   RETURNING id`,
  [tid, `FAKE ${TAG} ${label}`, `fake-${TAG}-${label}-${Date.now()}@example.invalid`, licensed, licensed ? `ภ.${label}-001` : null]
)).rows[0].id;

const row = async (tid: string, code: string, locale: string) =>
  (await listPharmacyGuidanceTemplates(tid)).find((r) => r.code === code && r.locale === locale);

test("setup: two pharmacy tenants, an unlicensed Administrator and licensed pharmacists", async () => {
  tenantId = await newTenant("main");
  otherTenantId = await newTenant("other");
  adminId = await newUser(tenantId, "admin", false);
  pharmacistId = await newUser(tenantId, "rx", true);
  otherPharmacistId = await newUser(otherTenantId, "rx2", true);
});

test("no shop text means the existing handoff, byte for byte", async () => {
  const got = await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH);
  assert.equal(got.approved, false);
  assert.equal(got.code, "DRUG_INTERACTION");
  assert.equal(got.reply, pharmacyClinicalHandoffReply(false, INTERACTION_TH));
});

test("seeding creates every draft once and serves none of them", async () => {
  const created = await seedPharmacyGuidanceDrafts(tenantId, adminId);
  assert.equal(created, PHARMACY_GUIDANCE_CODES.length * 2);
  assert.equal(await seedPharmacyGuidanceDrafts(tenantId, adminId), 0, "seeding twice must not duplicate or overwrite");
  const rows = await listPharmacyGuidanceTemplates(tenantId);
  assert.ok(rows.every((r) => r.status === "DRAFT"));
  const got = await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH);
  assert.equal(got.approved, false, "a draft must never reach a customer");
});

test("an Administrator without a pharmacist licence cannot approve", async () => {
  const draft = await row(tenantId, "DRUG_INTERACTION", "th");
  assert.ok(draft);
  await assert.rejects(
    () => approvePharmacyGuidance(tenantId, adminId, draft!.id, draft!.version),
    (err: unknown) => err instanceof PharmacyGuidanceError
  );
  assert.equal((await row(tenantId, "DRUG_INTERACTION", "th"))?.status, "DRAFT");
});

test("a pharmacist of another shop cannot approve this shop's text", async () => {
  const draft = await row(tenantId, "DRUG_INTERACTION", "th");
  await assert.rejects(
    () => approvePharmacyGuidance(tenantId, otherPharmacistId, draft!.id, draft!.version),
    (err: unknown) => err instanceof PharmacyGuidanceError
  );
});

test("approval pins the version the pharmacist read", async () => {
  const draft = await row(tenantId, "DRUG_INTERACTION", "th");
  await savePharmacyGuidanceDraft(tenantId, adminId, {
    code: "DRUG_INTERACTION", locale: "th",
    body: "ข้อความทดสอบที่ร้านแก้แล้ว\nติดต่อเภสัชกรที่ {{shop_phone}}\nที่อยู่ {{shop_address}}",
  });
  await assert.rejects(
    () => approvePharmacyGuidance(tenantId, pharmacistId, draft!.id, draft!.version),
    (err: unknown) => err instanceof PharmacyGuidanceError,
    "approving a stale version must fail"
  );
  const current = await row(tenantId, "DRUG_INTERACTION", "th");
  assert.equal(current!.version, draft!.version + 1);
  const approved = await approvePharmacyGuidance(tenantId, pharmacistId, current!.id, current!.version);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedLicenseNo, "ภ.rx-001");
  assert.ok(approved.approvedAt);
});

test("approved text is served rendered: shop facts filled, holes dropped, footer appended", async () => {
  const got = await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH);
  assert.equal(got.approved, true);
  assert.match(got.reply, /^ข้อความทดสอบที่ร้านแก้แล้ว/);
  assert.match(got.reply, /02-555-0101/);
  assert.doesNotMatch(got.reply, /ที่อยู่|\{\{/, "the shop has no address, so that line is dropped");
  assert.ok(got.reply.endsWith(PHARMACY_GUIDANCE_FOOTER.th));
  // The English question has no approved text yet.
  const en = await pharmacyClinicalGuidanceReply(tenantId, "can I take it together with my other pills");
  assert.equal(en.approved, false);
});

test("another shop never reads this shop's approved text", async () => {
  assert.equal(await getApprovedPharmacyGuidanceBody(otherTenantId, "DRUG_INTERACTION", "th"), null);
  const got = await pharmacyClinicalGuidanceReply(otherTenantId, INTERACTION_TH);
  assert.equal(got.approved, false);
});

test("editing approved text returns it to draft through the service", async () => {
  await savePharmacyGuidanceDraft(tenantId, adminId, { code: "DRUG_INTERACTION", locale: "th", body: "ข้อความใหม่ที่ยังไม่มีใครอนุมัติ" });
  const r = await row(tenantId, "DRUG_INTERACTION", "th");
  assert.equal(r!.status, "DRAFT");
  assert.equal(r!.approvedAt, null);
  assert.equal(r!.approvedLicenseNo, null);
  assert.equal((await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH)).approved, false);
});

test("the database trigger returns an edited approved body to draft even outside the service", async () => {
  const r = await row(tenantId, "DRUG_INTERACTION", "th");
  await approvePharmacyGuidance(tenantId, pharmacistId, r!.id, r!.version);
  await query(`UPDATE bms_pharmacy_guidance_templates SET body = body || ' แก้ตรง' WHERE id = $1`, [r!.id]);
  const after = await row(tenantId, "DRUG_INTERACTION", "th");
  assert.equal(after!.status, "DRAFT");
  assert.equal(after!.version, r!.version + 1);
  assert.equal(after!.approvedAt, null);
});

test("retiring approved text sends customers back to the handoff", async () => {
  const r = await row(tenantId, "DRUG_INTERACTION", "th");
  await approvePharmacyGuidance(tenantId, pharmacistId, r!.id, r!.version);
  assert.equal((await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH)).approved, true);
  await retirePharmacyGuidance(tenantId, adminId, r!.id);
  assert.equal((await pharmacyClinicalGuidanceReply(tenantId, INTERACTION_TH)).approved, false);
});

test("a read that cannot finish in time is treated as no text", async () => {
  assert.equal(await getApprovedPharmacyGuidanceBody(tenantId, "DRUG_INTERACTION", "th", 0), null);
});

test("every write left an audit row", async () => {
  const res = await query<{ action: string }>(
    `SELECT DISTINCT action FROM bms_audit_log WHERE tenant_id = $1 AND action LIKE 'pharmacy.guidance.%'`,
    [tenantId]
  );
  const actions = res.rows.map((r) => r.action).sort();
  assert.deepEqual(actions, [
    "pharmacy.guidance.approved", "pharmacy.guidance.draft_saved",
    "pharmacy.guidance.drafts_seeded", "pharmacy.guidance.retired",
  ]);
});

test("teardown: drop the throwaway tenants", async () => {
  const stale = await query<{ id: string }>(`SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]);
  const ids = [...new Set([tenantId, otherTenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length) {
    for (const table of [
      "bms_pharmacy_guidance_templates_revisions",
      "bms_pharmacy_guidance_templates",
      "bms_audit_log",
      "bms_store_profile",
    ]) {
      await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    }
    await query(`DELETE FROM users WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  }
  const left = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]);
  assert.equal(left.rows[0].n, "0");
});
