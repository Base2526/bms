import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PHARMACY_GUIDANCE_FOOTER, PHARMACY_GUIDANCE_DEFAULT_DRAFTS } from "../apps/web/lib/bms/pharmacy/guidanceTemplates.ts";
import { pharmacyClinicalHandoffReply } from "../apps/web/lib/bms/pharmacy/customerAssistancePolicy.ts";
import { composeEmergencyReply, pharmacyEmergencyKind, pharmacyEmergencyReply, type EmergencyKind } from "../apps/web/lib/bms/pharmacy/emergency.ts";
import { routePharmacyConversationMessage } from "../apps/web/lib/bms/pharmacy/conversationRouter.ts";
import { PHARMACY_GUARD_EMERGENCY_GOLDENS, PHARMACY_GUARD_COMMERCE_GOLDENS, PHARMACY_GUARD_BITE_GOLDENS } from "./ai-eval/pharmacy-customer-corpus.mjs";
import { isPharmacyMedicationAdviceQuestion, isPharmacySymptomAdviceQuestion, pharmacyCustomerReadIntent } from "../apps/web/lib/bms/pharmacy/customerAssistancePolicy.ts";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("customer response copy stays byte-exact against the pre-guard-change baseline", () => {
  const copy = [
    ...(["SELF_HARM", "POISONING", "MEDICAL"] as const).flatMap(kind => [true, false].map(english => composeEmergencyReply({ kind, english, facilities: [] }))),
    ...[true, false].flatMap(en => [pharmacyClinicalHandoffReply(en), pharmacyClinicalHandoffReply(en, en ? "Can my dog take it?" : "ให้แมวกินได้ไหม")]),
    PHARMACY_GUIDANCE_FOOTER, PHARMACY_GUIDANCE_DEFAULT_DRAFTS,
  ];
  assert.equal(createHash("sha256").update(JSON.stringify(copy)).digest("hex"), "a9a22c4a17dfa526189644a9ac5678360e30774bdc4410bebe7f90f5226a4f04");
});
const corpus: Array<[string, EmergencyKind | null]> = [
  ...PHARMACY_GUARD_BITE_GOLDENS.map((q): [string, EmergencyKind] => [q, "MEDICAL"]),
  ...PHARMACY_GUARD_EMERGENCY_GOLDENS as Array<[string, EmergencyKind]>,
  ["ลูกกินยาพาราไป 10 เม็ด", "POISONING"], ["กินยาเกินขนาด", "POISONING"], ["เด็กกลืนน้ำยาล้างห้องน้ำ", "POISONING"],
  ["ลูกแอบกินยา", "POISONING"], ["I took an overdose", "POISONING"], ["My toddler swallowed tablets", "POISONING"],
  ["I drank bleach", "POISONING"], ["เจ็บหน้าอกมาก", "MEDICAL"], ["หายใจไม่ออก", "MEDICAL"], ["หมดสติ", "MEDICAL"],
  ["ชัก", "MEDICAL"], ["แพ้ยา ปากบวม", "MEDICAL"], ["I can't breathe", "MEDICAL"], ["I have chest pain", "MEDICAL"],
  ["ไม่อยากอยู่แล้ว", "SELF_HARM"], ["มีความคิดทำร้ายตัวเอง", "SELF_HARM"], ["I want to kill myself", "SELF_HARM"],
  ["I don't want to live", "SELF_HARM"], ["ปวดหัวนิดหน่อย", null], ["มียาคุมฉุกเฉินไหม", null], ["เด็กกินยาอะไรดี", null],
  ["I took too many pills", "POISONING"], ["My child drank medicine", "POISONING"],
  ["My lips are swelling", "MEDICAL"], ["I have shortness of breath", "MEDICAL"],
  ["หายใจไม่\u200bออก", "MEDICAL"], ["หายใจ**ไม่**ออก", "MEDICAL"], ["หายใจไม่ ออก", "MEDICAL"],
  ["ลูกกินยาพาราไป ๑๐ เม็ด", "POISONING"], ["I don’t want to live", "SELF_HARM"],
  ["มีน้ำยาล้างห้องน้ำไหม", null], ["Do you sell pill containers?", null],
  ["took 20 mg paracetamol", null], ["took 20 minutes to arrive", null],
  ["อาการไม่หาย", null], ["ยาแก้ปวดหัว", null], ["ลูกไอมา 2 วัน", null], ["ลูก 12 เดือน ไข้สูง", null],
  ["กินไฮเตอร์", "POISONING"], ["ดื่มโซดาไฟ", "POISONING"], ["กลืนน้ำมันก๊าด", "POISONING"],
  ["อยากตาย กินยาไปทั้งแผง หายใจลำบาก", "SELF_HARM"], ["กินยาฆ่าหญ้า หายใจลำบาก", "POISONING"],
];
for (const message of PHARMACY_GUARD_COMMERCE_GOLDENS) test(`guard negative: ${message}`, () => {
  assert.equal(pharmacyEmergencyKind(message), null);
  assert.equal(isPharmacyMedicationAdviceQuestion(message), false);
  assert.equal(isPharmacySymptomAdviceQuestion(message), false);
  assert.equal(pharmacyCustomerReadIntent(message), message === "เภสัชกรอยู่ไหม" ? "service" : message.startsWith("เคส") ? "case" : null);
});
for (const [text, expected] of corpus) test(`emergency kind: ${text}`, () => {
  assert.equal(pharmacyEmergencyKind(text), expected);
  assert.equal(routePharmacyConversationMessage(text).intent === "EMERGENCY", expected !== null);
});
const facilities = Array.from({ length: 5 }, (_, i) => ({ name: `FAKE hospital ${i}`, emergencyPhone: "02-555-0101",
  mapUrl: "https://example.invalid/map", has24hEmergency: true }));
for (const kind of ["MEDICAL", "POISONING", "SELF_HARM"] as const) for (const english of [false, true]) {
  test(`1669 is first, static contacts and bounded facilities: ${kind}/${english}`, () => {
    const reply = composeEmergencyReply({ kind, english, facilities: [{ ...facilities[0], name: "NOT24", has24hEmergency: false },
      { ...facilities[0], name: "INACTIVE", active: false }, ...facilities] });
    assert.match(reply.split("\n")[0], /1669/);
    assert.match(reply.split("\n")[0], english ? /immediately.*Do not wait/ : /ทันที.*ไม่ต้องรอ/);
    assert.equal((reply.match(/FAKE hospital/g) ?? []).length, 3);
    assert.doesNotMatch(reply, /NOT24|INACTIVE/);
    assert.equal(reply.includes("1367"), kind === "POISONING");
    assert.equal(reply.includes("1323"), kind === "SELF_HARM");
    assert.equal(reply.includes("1155"), english);
    if (english) assert.match(reply.split("\n").at(-1)!, /1155/);
    if (kind === "POISONING") assert.match(reply, english ? /Do not induce vomiting/ : /ห้ามทำให้อาเจียน/);
  });
}
test("empty facilities exactly match the canonical standard fallback in every language/kind", () => {
  for (const [message, kind] of corpus.filter(([, kind]) => kind !== null)) assert.equal(
    composeEmergencyReply({ kind: kind!, english: !/[ก-๙]/.test(message), facilities: [] }), pharmacyEmergencyReply(message));
  assert.equal(pharmacyEmergencyReply("chest pain"), [
    "In Thailand, call 1669 or go to the nearest emergency department immediately. Do not wait for a pharmacist or this chat.",
    "Do not drive yourself. Ask someone to stay with you.",
    "Outside Thailand, call your local emergency or crisis service.",
    "For tourist assistance in Thailand, Tourist Police: 1155 (supplemental support, not a replacement for 1669).",
  ].join("\n"));
});
test("composer has no imports and settings have no geolocation or AI dependency", () => {
  assert.doesNotMatch(read("apps/web/lib/bms/pharmacy/emergency.ts"), /^\s*import\s/m);
  assert.doesNotMatch(read("apps/web/app/(admin)/admin/settings/EmergencyFacilitiesCard.tsx"), /navigator\.geolocation|\bfetch\(/);
  const pipeline = read("apps/web/lib/bms/pipeline.ts").split("export async function runPipeline(")[1];
  const fast = pipeline.slice(0, pipeline.indexOf("let convId:"));
  assert.match(fast, /if \(pharmacyEmergencyKind\(emergencyMessage\)\)/);
  assert.match(fast, /void \(async \(\) =>/);
  assert.match(fast, /reply: await emergencyCustomerReply/);
  assert.doesNotMatch(fast, /getStoreProfile|runToolLoop|ensureCustomerForIdentity/);
  const service = read("apps/web/lib/bms/emergencyFacilities.ts");
  assert.match(service, /Promise\.race/);
  assert.match(service, /setTimeout\(\(\) => resolve\(\[\]\), 500\)/);
  assert.doesNotMatch(read("scripts/schemaReadiness.mts"), /bms_emergency_facilities/);
});
test("migration and adapters keep tenant, branch, audit and human confirmation boundaries", () => {
  const sql = read("db/migrations/10.46__bms_emergency_facilities.sql");
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id\) REFERENCES bms_locations\(tenant_id, id\)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON bms_emergency_facilities TO bms_app/);
  assert.match(sql, /create_revision_trigger/);
  const adapter = read("apps/web/graphql/bmsStoreProfile.ts");
  assert.match(adapter, /requireTenantAdmin\(ctx\)/);
  assert.match(adapter, /args.confirmed !== true/);
  assert.match(adapter, /upsertEmergencyFacility\(getTenantId\(ctx\), actorId, args.input\)/);
});
test("runtime: DB error, saturation, query timeout and raw pipeline emergency use the fixed fallback", async (t) => {
  const state = globalThis as any;
  const previous = state.__bmsPostgresPool;
  const oldMode = process.env.NODE_ENV;
  const oldFlag = process.env.PHARMACY_INTAKE_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.PHARMACY_INTAKE_ENABLED = "false";
  const calls: string[] = [];
  let mode: "ok" | "error" | "slow" | "pool" = "ok";
  let releases = 0;
  state.__bmsPostgresPool = { connect: async () => {
    if (mode === "pool") return new Promise(() => {});
    return { release: () => releases++, query: async (sql: string, params: unknown[]) => {
      calls.push(sql);
      if (sql.includes("SELECT f.*")) {
        assert.equal(params[0], "tenant-test");
        assert.match(sql, /f.tenant_id=\$1 AND f.active/);
        assert.match(sql, /f.location_id IS NULL/);
        if (mode === "error") throw Object.assign(new Error("fake missing table"), { code: "42P01" });
        if (mode === "slow") await new Promise((r) => setTimeout(r, 650));
      }
      return { rows: [], rowCount: 0 };
    } };
  }, query: () => { throw new Error("Emergency must not load general context"); } };
  try {
    const service = await import("../apps/web/lib/bms/emergencyFacilities.ts");
    await t.test("missing table/error is caught, rolled back, and released", async () => {
      mode = "error"; calls.length = 0;
      let result: unknown;
      await assert.doesNotReject(async () => { result = await service.listEmergencyFacilitiesForReply("tenant-test"); });
      assert.deepEqual(result, []);
      assert.ok(calls.includes("ROLLBACK")); assert.equal(releases, 1);
      assert.equal(await service.emergencyCustomerReply("tenant-test", "กินยาเกินขนาด"), pharmacyEmergencyReply("กินยาเกินขนาด"));
    });
    for (const slowMode of ["slow", "pool"] as const) await t.test(`${slowMode} is bounded including acquisition`, async () => {
      mode = slowMode;
      const started = performance.now();
      assert.deepEqual(await service.listEmergencyFacilitiesForReply("tenant-test"), []);
      assert.ok(performance.now() - started < 620, "500ms budget with scheduling tolerance");
    });
    await t.test("pipeline returns before context reads, intake flags and any provider", async (sub) => {
      mode = "error";
      let generalReads = 0;
      sub.mock.method(state.__bmsPostgresPool, "query", () => { generalReads++; throw new Error("No general DB reads"); });
      const provider = sub.mock.method(globalThis, "fetch", async () => { throw new Error("No provider/network calls"); });
      const { runPipeline } = await import("../apps/web/lib/bms/pipeline.ts");
      for (const message of ["ลูกกินยาพาราไป 10 เม็ด", "เจ็บหน้าอกมาก", "I want to kill myself", ...PHARMACY_GUARD_EMERGENCY_GOLDENS.map(([text]) => text), ...PHARMACY_GUARD_BITE_GOLDENS]) {
        const result = await runPipeline(message, "test", "tenant-test");
        assert.equal(result.reply, pharmacyEmergencyReply(message));
        assert.equal(result.tool, "pharmacy:emergency:router");
      }
      assert.equal(generalReads, 0);
      assert.equal(provider.mock.callCount(), 0);
    });
  } finally { state.__bmsPostgresPool = previous;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldFlag === undefined) delete process.env.PHARMACY_INTAKE_ENABLED; else process.env.PHARMACY_INTAKE_ENABLED = oldFlag; }
});
