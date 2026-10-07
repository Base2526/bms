// Mechanical, reversible mutation checks. Refuse uncommitted target files; restore original bytes.
// Run only after committing: node scripts/testing/emergency-facilities-mutations.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composer = "apps/web/lib/bms/pharmacy/emergency.ts", service = "apps/web/lib/bms/emergencyFacilities.ts";
const replace = (source, from, to) => { assert.ok(source.includes(from), `Missing mutation anchor: ${from}`); return source.replace(from, to); };
const cases = [
  ["1669 no longer first", composer, (s) => replace(s, "const lines = [english", 'const lines = ["FAKE introduction before urgent instructions", english')],
  ["poison center omitted", composer, (s) => s.replaceAll("1367", "0000")],
  ["non-24h entry displayed", composer, (s) => replace(s, "f.has24hEmergency === true && f.active !== false", "f.active !== false")],
  ["response timeout removed", service, (s) => {
    const start = s.indexOf("return await Promise.race([safeRead");
    const end = s.indexOf("})]);", start);
    assert.ok(start >= 0 && end > start);
    return s.slice(0, start) + "return await safeRead;" + s.slice(end + 5);
  }],
  ["database error rethrown", service, (s) => s.replaceAll("return [];", "throw error;")],
];
const targets = [...new Set(cases.map(([, file]) => file))];
const git = spawnSync("git", ["status", "--porcelain", "--", ...targets], { cwd: root, encoding: "utf8" });
assert.equal(git.status, 0); assert.equal(git.stdout.trim(), "", "Commit target files before mutations");
let killed = 0;
for (const [name, file, mutate] of cases) {
  const absolute = path.join(root, file), original = readFileSync(absolute);
  try {
    const changed = mutate(original.toString("utf8"));
    assert.notEqual(changed, original.toString("utf8"));
    writeFileSync(absolute, changed);
    const run = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", "emergency-facilities"],
      { cwd: root, encoding: "utf8", timeout: 45_000, maxBuffer: 4_000_000 });
    if (run.error) throw run.error;
    assert.notEqual(run.status, 0, `SURVIVED: ${name}`);
    assert.match(run.stdout + run.stderr, /AssertionError|ERR_ASSERTION/, "A compile/import crash is not a killed behavior mutation");
    console.log(`KILLED: ${name}`); killed++;
  } finally {
    writeFileSync(absolute, original);
    assert.ok(readFileSync(absolute).equals(original), "Restore must be byte-exact");
  }
}
console.log(`${killed}/${cases.length} killed; original bytes restored.`);
const final = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", "emergency-facilities"], { cwd: root, encoding: "utf8", timeout: 45_000 });
assert.equal(final.status, 0, final.stdout + final.stderr);
console.log("Restored baseline: PASS");
