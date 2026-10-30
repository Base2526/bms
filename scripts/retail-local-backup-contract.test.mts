import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { localBackupView } from "../apps/web/lib/bms/localBackupView.ts";
const now = Date.parse("2026-10-30T12:00:00Z");
const sample = (status: string, age = 0) => ({ available: true, heartbeat: new Date(now).toISOString(), backup: { status, at: new Date(now - age).toISOString(), output: "secret-path" } });
test("backup evidence distinguishes failure, stale, missing, unavailable and recent pass", () => {
  assert.equal(localBackupView(null, now).status, "unknown");
  assert.equal(localBackupView(sample("passed"), now).status, "passed");
  assert.equal(localBackupView(sample("passed", 7 * 86400_000 + 1), now).status, "stale");
  assert.equal(localBackupView(sample("failed"), now).status, "failed");
  assert.equal(localBackupView(sample("not_configured"), now).status, "not_configured");
  assert.equal(localBackupView(sample("passed", -120_000), now).status, "unknown");
  assert.equal(localBackupView({ ...sample("passed"), available: false }, now).status, "unknown");
  assert.equal(localBackupView({ ...sample("passed"), heartbeat: "invalid" }, now).status, "unknown");
  assert.equal(localBackupView({ ...sample("passed"), heartbeat: new Date(now - 180_001).toISOString() }, now).status, "unknown");
  assert.doesNotMatch(JSON.stringify(localBackupView(sample("passed"), now)), /secret-path|output/);
});
test("backup alert is local-only, dismissible, permission-gated and mounted in admin", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const alert = read("apps/web/components/retail-local/LocalBackupAlert.tsx");
  assert.match(alert, /local && can\("retail_local.license.view"\)/);
  assert.match(alert, /closable/);
  assert.match(alert, /error \? "unknown"/);
  assert.match(read("apps/web/components/AdminLayoutClient.tsx"), /retailLocal && <LocalBackupAlert/);
});
