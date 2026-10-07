// Run after gate stops and a backup stash has been applied back. Never checkout/reset files.
// node scripts/testing/board-game-guards-mutations.mjs <backup-stash-sha>
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stash = process.argv[2];
assert.match(stash ?? "", /^[a-f0-9]{40}$/, "Supply the current verified backup stash SHA");
const dir = "apps/web/lib/bms/";
const files = ["boardGameCustomerGuard.ts", "customerReplyPolicy.ts", "pipeline.ts"];
const originals = new Map(files.map(file => [file, readFileSync(path.join(root, dir, file))]));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const eol = text => text.replace(/\r\n/g, "\n");
for (const [file, bytes] of originals) {
  assert.equal(eol(execFileSync("git", ["show", `${stash}:${dir}${file}`], { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })), eol(bytes.toString("utf8")), `${file}: stash must contain current work`);
}
const replace = (from, to) => source => {
  assert.equal(source.split(from).length, 2, `Unique mutation anchor required: ${from}`);
  return source.replace(from, to);
};
const disable = name => source => {
  const pattern = new RegExp(`const ${name} = [^\\r\\n]+;`);
  assert.match(source, pattern);
  return source.replace(pattern, `const ${name} = /a^/;`);
};
const guard = "boardGameCustomerGuard.ts";
const policy = "customerReplyPolicy.ts";
const mutations = [
  ...[
    ["foreignObject", "recheck-emergency-0"], ["medicalIncident", "recheck-emergency-9"],
    ["safetyIncident", "recheck-safety-0"], ["identityRequest", "recheck-identity-0"],
    ["privacyRequest", "recheck-privacy-0"], ["injectedAuthority", "recheck-injection-0"],
    ["staffRequest", "recheck-staff_action-0"],
    ["complaintReport", "recheck-complaint-0"], ["gamblingRequest", "recheck-gambling-0"],
    ["unfairPlayRequest", "recheck-fair_play-0"], ["counterfeitRequest", "recheck-counterfeit-0"],
  ].map(([name, witness]) => ({ name, file: guard, filter: "board-game-guard", witness, mutate: disable(name) })),
  { name: "minor_age", file: guard, filter: "board-game-guard", witness: "recheck-minor_alcohol-0",
    mutate: replace("const underTwenty = declaredAge !== null && Number(declaredAge[1] ?? declaredAge[2]) < 20;", "const underTwenty = false;") },
  ...[
    ["BOARD_GAME_THAI_ACTION", "BG claim golden: รับจองไว้ให้แล้วค่ะ"],
    ["BOARD_GAME_ENGLISH_ACTION", "BG claim golden: Your table is booked"],
  ].map(([name, witness]) => ({ name, file: policy, filter: "customer-policy", witness, mutate: disable(name) })),
  { name: "denial_accepts_all", file: policy, filter: "customer-policy", witness: "BG claim golden: จองโต๊ะให้เรียบร้อยแล้วค่ะ",
    mutate: source => source.replace(/const BOARD_GAME_CLAIM_DENIAL = [^\r\n]+;/, "const BOARD_GAME_CLAIM_DENIAL = /.*/;") },
  { name: "denial_removed", file: policy, filter: "customer-policy", witness: "BG claim refusals cannot hide another affirmative clause",
    mutate: replace("if (BOARD_GAME_CLAIM_DENIAL.test(text)) continue;", "if (false) continue;") },
  { name: "checkout_fallback", file: policy, filter: "customer-policy", witness: "BG created-order checkout fallback cannot reuse an unsupported model claim",
    mutate: replace("return reply && !hasUnsupportedBoardGameActionClaim(reply)", "return reply") },
  { name: "urgent_before_context", file: "pipeline.ts", filter: "board-game-guard", witness: "BG urgent before profile failure",
    mutate: replace("const urgentShopGuard = boardGameUrgentGuard(emergencyMessage, !/[ก-๙]/.test(emergencyMessage));", "const urgentShopGuard = null;") },
];
const output = path.join(root, ".test-output/board-game-mutations");
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const item of mutations) {
    const target = path.join(root, dir, item.file);
    const original = originals.get(item.file);
    try {
      const changed = item.mutate(original.toString("utf8"));
      assert.notEqual(changed, original.toString("utf8"));
      writeFileSync(target, changed);
      const result = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", item.filter], {
        cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 12 * 1024 * 1024,
        env: { ...process.env, BMS_TEST_OUTPUT_DIR: path.join(output, item.name) },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, `${item.name}: must fail assertions, not crash/pass`);
      const tap = readFileSync(path.join(output, item.name, "pure.tap"), "utf8");
      const witness = tap.split("\n").find(line => /not ok \d+ - /.test(line) && line.includes(item.witness));
      assert.ok(witness, `${item.name}: intended golden must fail: ${item.witness}`);
      results.push({ mutation: item.name, killed: true, witness: witness.trim() });
      console.log(`KILLED ${item.name}: ${item.witness}`);
    } finally {
      writeFileSync(target, original);
      assert.equal(hash(readFileSync(target)), hash(original), `Byte-exact restore: ${item.file}`);
    }
  }
} finally {
  const restored = Object.fromEntries([...originals].map(([file, bytes]) => {
    assert.equal(hash(readFileSync(path.join(root, dir, file))), hash(bytes));
    return [file, hash(bytes)];
  }));
  writeFileSync(path.join(output, "summary.json"), JSON.stringify({ stash, results, restored }, null, 2) + "\n");
}
assert.equal(results.length, mutations.length);
console.log(`${results.length}/${mutations.length} killed; all source files restored byte-exact`);
