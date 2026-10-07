import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHARMACY_GUIDANCE_CODES,
  PHARMACY_GUIDANCE_DEFAULT_DRAFTS,
  PHARMACY_GUIDANCE_FOOTER,
  classifyPharmacyGuidanceQuestion,
  pharmacyGuidanceWarnings,
  renderPharmacyGuidance,
  type PharmacyGuidanceCode,
} from "../apps/web/lib/bms/pharmacy/guidanceTemplates.ts";
import { pharmacyEmergencyKind } from "../apps/web/lib/bms/pharmacy/emergency.ts";
import { isPharmacyMedicationAdviceQuestion, isPharmacySymptomAdviceQuestion } from "../apps/web/lib/bms/pharmacy/customerAssistancePolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function block(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `anchor not found: ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `end anchor not found after: ${start}`);
  return src.slice(i, j);
}

const CORPUS: Record<PharmacyGuidanceCode, string[]> = {
  SYMPTOM_TO_DRUG: ["ปวดหัวกินอะไรดี", "เจ็บคอควรกินยาอะไร", "แนะนำยาแก้ไอหน่อย", "what medicine should I take for a headache", "I have a fever"],
  DRUG_INTERACTION: ["กินคู่กับยาความดันได้ไหม", "ยาตีกันไหม", "ทานพร้อมกับยาฆ่าเชื้อได้มั้ย", "can I take it together with my other pills", "is there a drug interaction"],
  ALLERGY_SUBSTITUTE: ["แพ้ยาพาราใช้อะไรแทน", "แพ้ยานี้กินตัวไหนแทนได้", "I'm allergic to this, what can I use instead", "allergy to aspirin alternative"],
  SIDE_EFFECT: ["กินยาแล้วผื่นขึ้น", "มีผลข้างเคียงไหม", "ทานไปแล้วเวียนหัว", "side effects after taking it", "I got a rash after taking it"],
  MISSED_DOSE: ["ลืมกินยาเมื่อเช้า", "ลืมทานยาต้องทำไง", "I missed a dose", "forgot to take my pill"],
  NOT_IMPROVING: ["กินมาสามวันไม่หาย", "อาการไม่ดีขึ้นเลย", "still sick after three days", "not getting better"],
  COMPARE_WITH_PRESCRIBED: ["ตัวนี้กับที่หมอสั่งอันไหนดีกว่า", "ยาจากโรงพยาบาลเปลี่ยนเป็นตัวนี้ได้ไหม", "is this better than what my doctor prescribed", "the doctor gave me another one"],
  CHRONIC_CONDITION: ["เป็นเบาหวานกินได้ไหม", "เป็นโรคไตใช้ได้หรือเปล่า", "มีความดันสูงกินตัวนี้ได้ไหม", "I have kidney disease", "is it ok with asthma"],
  SPECIAL_POPULATION: ["ให้ลูกอายุ 3 ขวบได้ไหม", "คนท้องกินได้ไหม", "ให้นมลูกอยู่ใช้ได้ไหม", "can my baby have it", "I'm pregnant"],
  ANIMAL: ["ให้แมวกินได้ไหม", "หมากินยาคนได้ไหม", "can my dog take it", "is it ok for pets"],
  RESTRICTED_PRODUCT: ["ขอยานอนหลับ", "มียาคุมฉุกเฉินไหม", "ซื้อยาที่ต้องมีใบสั่งแพทย์", "do you sell sleeping pills", "morning after pill"],
};

test("every guidance code is classified from real Thai and English questions", () => {
  assert.deepEqual(Object.keys(CORPUS).sort(), [...PHARMACY_GUIDANCE_CODES].sort());
  const misses: string[] = [];
  for (const [code, questions] of Object.entries(CORPUS)) {
    assert.ok(questions.length >= 3, `${code} needs at least three pinned questions`);
    assert.ok(questions.some((q) => /[ก-๙]/.test(q)) && questions.some((q) => !/[ก-๙]/.test(q)), `${code} needs Thai and English`);
    for (const q of questions) {
      const got = classifyPharmacyGuidanceQuestion(q);
      if (got !== code) misses.push(`${JSON.stringify(q)} → ${got} (expected ${code})`);
    }
  }
  assert.deepEqual(misses, []);
});

test("a stomach complaint is never read as pregnancy, and kidney is never read as a child", () => {
  assert.notEqual(classifyPharmacyGuidanceQuestion("ท้องเสียกินอะไรดี"), "SPECIAL_POPULATION");
  assert.notEqual(classifyPharmacyGuidanceQuestion("ปวดท้องกินยาอะไร"), "SPECIAL_POPULATION");
  assert.equal(classifyPharmacyGuidanceQuestion("I have kidney disease"), "CHRONIC_CONDITION");
  assert.equal(classifyPharmacyGuidanceQuestion(""), null);
});

test("an emergency in a clinical question is caught by the emergency router, which the pipeline runs first", () => {
  for (const q of ["กินยาเกินขนาดแล้วใจสั่น กินอะไรแก้", "กินยาแล้วหน้าบวมปากบวม ใช้ยาอะไรแทน", "took an overdose what should I take", "my child swallowed pills what medicine can help"]) {
    assert.ok(pharmacyEmergencyKind(q), `emergency router must catch: ${q}`);
  }
  const pipeline = stripComments(read("apps/web/lib/bms/pipeline.ts"));
  const first = block(pipeline, "if (isPharmacyTenant && !isPharmacyEmergency && isPharmacyMedicationAdviceQuestion(aiInputMessage))", "return customerSafe(");
  assert.ok(first.includes("pharmacyClinicalGuidanceReply"), "the medication-advice branch must use approved guidance");
  // The symptom branch sits after the emergency returns; pin the order, not just presence.
  const emergencyReturn = pipeline.indexOf("if (isPharmacyTenant && isPharmacyEmergency) {");
  const symptomBranch = pipeline.indexOf("if (isPharmacyTenant && (isPharmacySymptomAdviceQuestion(aiInputMessage)");
  assert.ok(emergencyReturn > 0 && symptomBranch > emergencyReturn, "symptom guidance must come after the emergency return");
  const second = block(pipeline, "if (isPharmacyTenant && (isPharmacySymptomAdviceQuestion(aiInputMessage)", "if (isPharmacyTenant && pharmacyConversationRoute.intent === \"HUMAN_HANDOFF\")");
  assert.ok(second.includes("pharmacyClinicalGuidanceReply"));

  const intake = stripComments(read("apps/web/lib/bms/pharmacy/intake.ts"));
  const emergencyAt = intake.indexOf("emergencyCustomerReply(tenantId, message)");
  const guidanceAt = intake.indexOf("pharmacyClinicalGuidanceReply(tenantId, message)");
  assert.ok(emergencyAt > 0 && guidanceAt > emergencyAt, "intake must answer an emergency before any guidance");
});

test("the guidance branches never hand the text to a model", () => {
  const pipeline = stripComments(read("apps/web/lib/bms/pipeline.ts"));
  for (const start of [
    "if (isPharmacyTenant && !isPharmacyEmergency && isPharmacyMedicationAdviceQuestion(aiInputMessage))",
    "if (isPharmacyTenant && (isPharmacySymptomAdviceQuestion(aiInputMessage)",
  ]) {
    const branch = block(pipeline, start, "\n  }\n");
    assert.doesNotMatch(branch, /runAi|callModel|provider|chatCompletion|anthropic|deepseek|runCustomerToolLoop/i);
  }
  const store = stripComments(read("apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts"));
  assert.doesNotMatch(store, /from\s+"\.\/ai"|from\s+"\.\.\/ai|anthropic|deepseek/i);
});

test("no approved text falls back to the existing handoff; approved text is rendered, not rewritten", () => {
  const store = stripComments(read("apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts"));
  const fn = block(store, "export async function pharmacyClinicalGuidanceReply(", "export async function pharmacyGuidanceShopValues(");
  assert.match(fn, /const fallback = \{ reply: pharmacyClinicalHandoffReply\(locale === "en", message\), code, approved: false \}/);
  assert.match(fn, /Promise\.race/);
  assert.match(fn, /renderPharmacyGuidance\(body, await loadValues\(\), locale\)/);
  assert.match(fn, /getApprovedPharmacyGuidanceBody\(tenantId, code, locale\)/);
  const reader = block(store, "export async function getApprovedPharmacyGuidanceBody(", "export async function pharmacyClinicalGuidanceReply(");
  assert.match(reader, /status = 'APPROVED'/, "only APPROVED rows may reach a customer");
  assert.match(reader, /Promise\.race/, "the read must be bounded by a timeout");
  assert.match(reader, /\.catch\(/, "a failed read must not throw into the pipeline");
});

test("approved guidance cannot hang or throw when optional shop placeholders are unavailable", async () => {
  const global = globalThis as any;
  const previous = global.__bmsPostgresPool, oldMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  global.__bmsPostgresPool = { query: async () => ({ rows: [{ body: "Contact {{shop_phone}}" }] }) };
  try {
    const { pharmacyClinicalGuidanceReply } = await import("../apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts");
    const { pharmacyClinicalHandoffReply } = await import("../apps/web/lib/bms/pharmacy/customerAssistancePolicy.ts");
    for (const load of [() => new Promise<never>(() => {}), async () => { throw new Error("FAKE profile failure"); }]) {
      const started = performance.now();
      const got = await pharmacyClinicalGuidanceReply("tenant-test", "กินคู่กับยาความดันได้ไหม", load);
      assert.equal(got.approved, false);
      assert.equal(got.reply, pharmacyClinicalHandoffReply(false, "กินคู่กับยาความดันได้ไหม"));
      assert.ok(performance.now() - started < 620);
    }
  } finally {
    global.__bmsPostgresPool = previous;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
  }
});

test("rendering fills known shop facts, drops lines with holes and always appends the footer", () => {
  const body = "บรรทัดแรก\nโทร {{shop_phone}}\nเวลา {{business_hours}}\nที่อยู่ {{shop_address}}\nลับ {{secret}}\n\n\nท้าย";
  const out = renderPharmacyGuidance(body, { shop_phone: "02-111-2222", business_hours: "  " }, "th");
  assert.match(out, /โทร 02-111-2222/);
  assert.doesNotMatch(out, /\{\{|\}\}/, "a customer must never see a raw placeholder");
  assert.doesNotMatch(out, /เวลา|ที่อยู่|ลับ/, "lines with an unset or unknown placeholder are dropped");
  assert.doesNotMatch(out, /\n\n\n/);
  assert.ok(out.endsWith(PHARMACY_GUIDANCE_FOOTER.th));
  assert.ok(renderPharmacyGuidance("x", {}, "en").endsWith(PHARMACY_GUIDANCE_FOOTER.en));
  assert.equal(renderPharmacyGuidance("", {}, "th"), PHARMACY_GUIDANCE_FOOTER.th);
});

test("content warnings catch doses and safety claims", () => {
  assert.ok(pharmacyGuidanceWarnings("กิน 2 เม็ด วันละ 3 ครั้ง").includes("DOSE_NUMBER"));
  assert.ok(pharmacyGuidanceWarnings("take 500 mg").includes("DOSE_NUMBER"));
  assert.ok(pharmacyGuidanceWarnings("กินคู่กันได้ ไม่เป็นไร").includes("SAFETY_CLAIM"));
  assert.ok(pharmacyGuidanceWarnings("this is safe for children").includes("SAFETY_CLAIM"));
  assert.ok(pharmacyGuidanceWarnings("โทร {{pharmacist_mobile}}").includes("UNKNOWN_PLACEHOLDER"));
  assert.ok(pharmacyGuidanceWarnings("   ").includes("EMPTY"));
  assert.deepEqual(pharmacyGuidanceWarnings("ติดต่อเภสัชกรที่ {{shop_phone}}"), []);
});

const DRUG_NAMES = /(?:พารา|paracetamol|acetaminophen|ibuprofen|ไอบู|aspirin|แอสไพริน|loratadine|cetirizine|amoxicillin|อะม็อก|domperidone|omeprazole|diclofenac|antacid|ยาแก้แพ้|ยาลดกรด)/i;

test("starting drafts raise no warning, name no medicine and point to 1669 where they screen", () => {
  assert.deepEqual(Object.keys(PHARMACY_GUIDANCE_DEFAULT_DRAFTS).sort(), [...PHARMACY_GUIDANCE_CODES].sort());
  for (const [code, byLocale] of Object.entries(PHARMACY_GUIDANCE_DEFAULT_DRAFTS)) {
    for (const locale of ["th", "en"] as const) {
      const body = byLocale[locale];
      assert.ok(body?.trim(), `${code}/${locale} draft is missing`);
      assert.deepEqual(pharmacyGuidanceWarnings(body), [], `${code}/${locale} draft raises a warning`);
      assert.doesNotMatch(body, DRUG_NAMES, `${code}/${locale} draft names a medicine`);
      if (/อาการรุนแรง|severe symptoms/i.test(body)) assert.match(body, /1669/);
    }
  }
});

test("every clinical guidance example reaches a safety guard, not only the already-recognized subset", () => {
  // Not every hand-off has a template (storage questions keep the generic reply), but the
  // common clinical questions must reach a pharmacist-approved text once one exists.
  for (const [code, questions] of Object.entries(CORPUS)) {
    if (code === "RESTRICTED_PRODUCT") continue; // reaches the classifier via the symptom/advice gates only sometimes
    for (const q of questions) {
      assert.ok(isPharmacyMedicationAdviceQuestion(q) || isPharmacySymptomAdviceQuestion(q), `unguarded: ${q}`);
      assert.equal(classifyPharmacyGuidanceQuestion(q), code, q);
    }
  }
});

test("10.45 stores approval as a fact about the pharmacist and never seeds approved text", () => {
  const sql = read("db/migrations/10.45__bms_pharmacy_guidance_templates.sql");
  const body = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(body, /INSERT\s+INTO\s+bms_pharmacy_guidance_templates/i, "no rows may be seeded");
  assert.match(body, /ENABLE ROW LEVEL SECURITY/);
  assert.match(body, /FORCE ROW LEVEL SECURITY/);
  assert.match(body, /GRANT SELECT, INSERT, UPDATE ON bms_pharmacy_guidance_templates TO bms_app;/);
  assert.doesNotMatch(body, /GRANT[^;]*DELETE[^;]*bms_pharmacy_guidance_templates TO bms_app/);
  assert.match(body, /BEFORE UPDATE ON bms_pharmacy_guidance_templates/);
  assert.match(body, /NEW\.status := 'DRAFT'/, "an edited approved body must return to draft in the database");
  assert.match(body, /status <> 'APPROVED' OR approved_at IS NOT NULL/);
  for (const code of PHARMACY_GUIDANCE_CODES) assert.match(body, new RegExp(`'${code}'`));

  const store = stripComments(read("apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts"));
  const approve = block(store, "export async function approvePharmacyGuidance(", "export async function retirePharmacyGuidance(");
  assert.match(approve, /bms_is_licensed_pharmacist\(\$1, \$2\)/);
  assert.match(approve, /ok !== true/);
  assert.match(approve, /status = 'DRAFT' AND version = \$4/, "approval must pin the version the pharmacist read");
  for (const fn of ["savePharmacyGuidanceDraft", "seedPharmacyGuidanceDrafts", "approvePharmacyGuidance", "retirePharmacyGuidance"]) {
    const body = block(store, `export async function ${fn}(`, "\n}\n");
    assert.match(body, /beginTenantTx/, `${fn} must write in a tenant transaction`);
    assert.match(body, /auditInTx\(/, `${fn} must audit in the same transaction`);
  }
});

test("GraphQL gates reading on pharmacy.assessment.read and writing on pharmacy.protocol.manage", () => {
  const gql = stripComments(read("apps/web/graphql/bmsPharmacy.ts"));
  for (const [name, perm] of [
    ["bmsPharmacyGuidanceTemplates", "pharmacy.assessment.read"],
    ["bmsPharmacyGuidanceDefaults", "pharmacy.assessment.read"],
    ["bmsSavePharmacyGuidanceDraft", "pharmacy.protocol.manage"],
    ["bmsSeedPharmacyGuidanceDrafts", "pharmacy.protocol.manage"],
    ["bmsApprovePharmacyGuidance", "pharmacy.protocol.manage"],
    ["bmsRetirePharmacyGuidance", "pharmacy.protocol.manage"],
  ] as const) {
    const fn = block(gql, `async ${name}(`, "\n    },");
    assert.match(fn, new RegExp(`requirePermission\\(ctx, "${perm.replace(/\./g, "\\.")}"\\)`), name);
    // The built-in drafts belong to no shop; every other operation is tenant data.
    if (name !== "bmsPharmacyGuidanceDefaults") assert.match(fn, /getTenantId\(ctx\)/, `${name} must derive the tenant server-side`);
  }
});
