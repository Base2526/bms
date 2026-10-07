// Usage: node scripts/testing/board-game-chat-booking-mutations.mjs <backup-stash-sha>
// Run only after gate has stopped. The supplied stash must contain every current source byte.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stash = process.argv[2];
assert.match(stash ?? "", /^[a-f0-9]{40}$/);
const policy = "apps/web/lib/bms/boardGameReservationPolicy.ts";
const service = "apps/web/lib/bms/boardGameWaitlist.ts";
const reply = "apps/web/lib/bms/customerReplyPolicy.ts";
const cases = [
  { name: "bypass-customer-confirmation", file: policy, filter: "board-game-customer",
    from: "if (!confirmed || confirmed.fingerprint !== fingerprint || confirmed.expiresAt <= Date.now()) {", to: "if (false) {",
    witness: "booking first call previews without a write" },
  { name: "insert-confirmed", file: service, filter: "board-game-waitlist",
    from: "INTERVAL '4 hours')::date, 'REQUESTED', $6", to: "INTERVAL '4 hours')::date, 'CONFIRMED', $6",
    witness: "CHAT write inserts only REQUESTED" },
  { name: "remove-pending-cap", file: service, filter: "board-game-waitlist",
    from: "if (Number(pending.rows[0].count) >= 3)", to: "if (false)",
    witness: "CHAT pending cap and transaction failures" },
  { name: "cross-customer-status", file: service, filter: "board-game-waitlist",
    from: "WHERE w.tenant_id = $1 AND w.customer_id = $2 AND w.source = 'CHAT'", to: "WHERE w.tenant_id = $1 AND w.source = 'CHAT'",
    witness: "CHAT status is always customer AND tenant scoped" },
  { name: "accept-fake-confirmed-claim", file: reply, filter: "customer-policy",
    from: "export function hasUnsupportedBoardGameActionClaim(reply: string): boolean {",
    to: 'export function hasUnsupportedBoardGameActionClaim(reply: string): boolean { if (reply === "ยืนยันการจองแล้ว") return false;',
    witness: "reservation requests are not confirmed bookings: phase zero bilingual goldens" },
  { name: "reuse-stale-summary", file: policy, filter: "board-game-customer",
    from: "return [false, true].some(english => boardGameReservationSummary(quote, english).trim() === lastAssistant.trim());", to: "return true;",
    witness: "booking verified flow TH" },
];
const originals = new Map();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const normalize = text => text.replace(/\r\n/g, "\n");
for (const file of new Set(cases.map(c => c.file))) {
  const original = readFileSync(path.join(root, file));
  originals.set(file, original);
  let backup;
  for (const ref of [stash, `${stash}^3`]) {
    try { backup = execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, maxBuffer: 4*1024*1024, stdio: ["ignore", "pipe", "ignore"] }); break; } catch {}
  }
  assert.ok(backup, `missing backup: ${file}`);
  assert.equal(normalize(backup.toString("utf8")), normalize(original.toString("utf8")), `stale backup: ${file}`);
}
const out = path.join(root, ".test-output/bg-booking-mutations");
mkdirSync(out, { recursive: true });
const results = [];
for (const item of cases) {
  const target = path.join(root, item.file);
  const original = originals.get(item.file);
  try {
    const source = original.toString("utf8");
    assert.equal(source.split(item.from).length, 2, `unique anchor: ${item.name}`);
    writeFileSync(target, source.replace(item.from, item.to));
    const run = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", item.filter], {
      cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 12*1024*1024,
      env: { ...process.env, BMS_TEST_OUTPUT_DIR: path.join(out, item.name) },
    });
    assert.ifError(run.error);
    assert.equal(run.status, 1, "must fail an assertion, not crash or pass");
    const tap = readFileSync(path.join(out, item.name, "pure.tap"), "utf8");
    assert.ok(tap.split("\n").some(line => /not ok \d+ - /.test(line) && line.includes(item.witness)), item.witness);
    results.push({ mutation: item.name, killed: true, witness: item.witness });
    console.log(`KILLED ${item.name}: ${item.witness}`);
  } finally {
    writeFileSync(target, original);
    assert.equal(digest(readFileSync(target)), digest(original), `byte-exact restore: ${item.file}`);
  }
}
const restored = Object.fromEntries([...originals].map(([file, original]) => {
  assert.equal(digest(readFileSync(path.join(root,file))),digest(original));
  return [file,digest(original)];
}));
writeFileSync(path.join(out,"summary.json"),JSON.stringify({ stash, results, restored },null,2)+"\n");
console.log(`${results.length}/${cases.length} mutations killed; SHA-256 byte-exact restore verified`);
