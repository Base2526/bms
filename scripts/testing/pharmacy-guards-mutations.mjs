// Run only after gate has stopped and an explicit backup stash has been applied back.
// node scripts/testing/pharmacy-guards-mutations.mjs <backup-stash-sha>
// No checkout/reset: every mutation is restored from its original Buffer in finally.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stash = process.argv[2];
assert.match(stash ?? "", /^[a-f0-9]{40}$/, "Supply the verified backup stash SHA before mutating");
const dir = "apps/web/lib/bms/pharmacy/";
const targets = ["emergency.ts", "customerAssistancePolicy.ts", "guidanceTemplates.ts", "conversationRouter.ts"];
const originals = new Map(targets.map(name => [name, readFileSync(path.join(root, dir, name))]));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const normalizeEol = text => text.replace(/\r\n/g, "\n");
for (const [name, bytes] of originals) {
  const saved = execFileSync("git", ["show", `${stash}:${dir}${name}`], { cwd: root, encoding: "utf8" });
  assert.equal(normalizeEol(saved), normalizeEol(bytes.toString("utf8")), `${name}: stash must contain current work`);
}
const disable = name => src => {
  const pattern = new RegExp(`const ${name} = [^\\r\\n]+;`);
  assert.match(src, pattern, `Missing mutation anchor ${name}`);
  return src.replace(pattern, `const ${name} = /a^/;`);
};
const replaceExactly = (from, to) => src => {
  assert.equal(src.split(from).length, 2, `Mutation anchor must be unique: ${from}`);
  return src.replace(from, to);
};
const replaceRule = (code, replacement) => src => {
  const pattern = new RegExp(`\\["${code}", [^\\r\\n]+\\],`);
  assert.match(src, pattern);
  return src.replace(pattern, `["${code}", ${replacement}],`);
};
const mutations = [
  ...[
    ["SELF_HARM_ADDITIONAL", "i want to die"],
    ["LARGE_INGESTION", "took 20 paracetamol"],
    ["TOXIN_INGESTION", "กินยาฆ่าหญ้า"],
    ["MEDICAL_ADDITIONAL", "ปากเขียว"],
    ["YOUNG_INFANT_FEVER", "ลูก 2 เดือน ไข้สูง"],
  ].map(([name, witness]) => ({ name, file: "emergency.ts", filter: "emergency-facilities", witness, mutate: disable(name) })),
  ...[
    ["DOSAGE_QUESTION", "พาราวันละกี่เม็ด"],
    ["ALTERNATING_MEDICINES", "ไอบูกับพาราสลับกันได้ไหม"],
    ["TABLET_MANIPULATION", "บดยาได้ไหม"],
    ["PERSISTENT_PAIN", "กินยาแล้วยังปวดอยู่"],
    ["SYMPTOM_DISCLOSURE", "my son has a fever"],
    ["SHORT_SYMPTOM", "ปวดฟัน"],
  ].map(([name, witness]) => ({ name, file: "customerAssistancePolicy.ts", filter: "pharmacy-customer-assistance", witness, mutate: disable(name) })),
  ...[
    ["C_ANIMAL", "โดนสุนัขกัด", replaceRule("ANIMAL", "/สุนัข|หมา|แมว/")],
    ["C_ALLERGY", "แพ้อากาศ กินยาอะไรดี", replaceExactly("(?!อากาศ|ฝุ่น|อาหาร|เกสร)", "")],
    ["C_PREGNANCY", "แอสไพรินกินตอนท้องว่างได้ไหม", replaceExactly("(?!ว่าง|อืด|ผูก|เสีย)", "")],
    ["C_INTERACTION", "ไอบูกับพาราสลับกันได้ไหม", replaceRule("DRUG_INTERACTION", "/a^/")],
    ["C_NOT_IMPROVING", "ไม่หายใจ", replaceExactly("(?!ใจ)", "")],
    ["C_PRODUCT_NAMES", "ไอบูโพรเฟน", replaceRule("SYMPTOM_TO_DRUG", "/ไอ|ไข้/")],
    ["C_NORMALIZER", "ไอบูกับพารา**สลับ**กันได้ไหม", replaceExactly("const text = normalizePharmacySafetyText(message);", "const text = String(message).trim();")],
  ].map(([name, witness, mutate]) => ({ name, file: "guidanceTemplates.ts", filter: "pharmacy-guidance", witness, mutate })),
  { name: "A_TIME_UNIT", file: "emergency.ts", filter: "emergency-facilities", witness: "took 20 minutes to arrive",
    mutate: replaceExactly("|minutes?\\b|hours?\\b|seconds?\\b|days?\\b", "") },
  { name: "B_PACK_SIZE", file: "customerAssistancePolicy.ts", filter: "pharmacy-customer-assistance", witness: "explicit commerce and label questions",
    mutate: replaceExactly("(?:(?!แผงละ|กล่องละ|ขวดละ|บรรจุ).){0,20}", ".{0,20}") },
  { name: "D_BITE", file: "emergency.ts", filter: "emergency-facilities", witness: "โดนสุนัขกัด",
    mutate: replaceExactly('if (isPharmacyAnimalBiteMessage(text)) return "MEDICAL";', 'if (false) return "MEDICAL";') },
  { name: "D_HANDOFF", file: "customerAssistancePolicy.ts", filter: "pharmacy-customer-assistance", witness: "guard D human injury: โดนสุนัขกัด",
    mutate: replaceExactly("if (isPharmacyAnimalMedicationQuestion(message)) {", "if (/สุนัข|หมา|แมว|dog|cat/i.test(message)) {") },
  { name: "D_HUMAN", file: "conversationRouter.ts", filter: "pharmacy-customer-assistance", witness: "guard D human: talk to a human",
    mutate: replaceExactly("(?:pharmacist|human)", "pharmacist") },
];
const output = path.join(root, ".test-output/guards-mutations");
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const item of mutations) {
    const target = path.join(root, dir, item.file);
    const original = originals.get(item.file);
    try {
      const changed = item.mutate(original.toString("utf8"));
      assert.notEqual(changed, original.toString("utf8"), `No-op mutation: ${item.name}`);
      writeFileSync(target, changed);
      const result = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", item.filter], {
        cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 12 * 1024 * 1024,
        env: { ...process.env, BMS_TEST_OUTPUT_DIR: path.join(output, item.name) },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, `${item.name}: the mutated suite must fail, not crash or pass`);
      const tap = readFileSync(path.join(output, item.name, "pure.tap"), "utf8");
      const witness = tap.split("\n").find(line => /not ok \d+ - /.test(line) && line.includes(item.witness));
      assert.ok(witness, `${item.name}: must fail the intended golden ${item.witness}`);
      results.push({ mutation: item.name, killed: true, witness: witness.trim() });
      console.log(`KILLED ${item.name}: ${item.witness}`);
    } finally {
      writeFileSync(target, original);
      assert.equal(hash(readFileSync(target)), hash(original), `Restore failed: ${item.file}`);
    }
  }
} finally {
  const restored = Object.fromEntries([...originals].map(([name, bytes]) => {
    const current = readFileSync(path.join(root, dir, name));
    assert.equal(hash(current), hash(bytes), `${name} must be byte-exact after mutations`);
    return [name, hash(current)];
  }));
  writeFileSync(path.join(output, "summary.json"), JSON.stringify({ stash, results, restored }, null, 2) + "\n");
}
assert.equal(results.length, mutations.length);
console.log(`${results.length}/${mutations.length} killed; all four source files restored byte-exact`);
