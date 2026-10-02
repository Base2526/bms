import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

test("activation rejects a different license before consuming and recovers case-normalized exact retries", async () => {
  const state = globalThis as typeof globalThis & { __bmsPostgresPool?: unknown };
  const previousPool = state.__bmsPostgresPool;
  const previousMode = process.env.NODE_ENV;
  const previousKey = process.env.BMS_SECRET_KEY;
  process.env.NODE_ENV = "test";
  process.env.BMS_SECRET_KEY = "ab".repeat(32); // Test-only key, no external database/network.
  const bootstrap = { bootstrap_id: "fixture", license_id: "fixture-license", license_code: "LIC-fixture",
    commercial_status: "TRIAL_ACTIVE", expires_at: new Date(Date.now() + 86400000),
    consumed_at: null as Date | null, revoked_at: null as Date | null, redemption_request_id: null as string | null };
  let inserts = 0;
  let tokenHash: string | null = null;
  state.__bmsPostgresPool = {
    connect: async () => ({ release() {}, async query(sql: string, params: unknown[] = []) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("FOR UPDATE OF b, l")) return { rows: [{ ...bootstrap }] };
      if (sql.includes("INSERT INTO bms_retail_local_license_tokens")) { inserts++; tokenHash = String(params[1]); return { rows: [] }; }
      if (sql.includes("UPDATE bms_retail_local_license_bootstrap_tokens")) {
        bootstrap.consumed_at = new Date(); bootstrap.redemption_request_id = String(params[1]); return { rows: [] };
      }
      if (sql.includes("SELECT id FROM bms_retail_local_license_tokens")) return { rows: params[1] === tokenHash ? [{ id: "fixture-token" }] : [] };
      throw new Error("unexpected query in activation test");
    } }),
  };
  try {
    const { redeemRetailLocalActivationCode } = await import("../apps/web/lib/bms/retailLocalLicensing.ts");
    const code = "bmsla_" + "x".repeat(43);
    const requestId = "abcdef01-abcd-4abc-8abc-abcdef123456";
    await assert.rejects(redeemRetailLocalActivationCode(code, requestId, "LIC-another"), /license_mismatch/);
    assert.equal(inserts, 0);
    assert.equal(bootstrap.consumed_at, null);
    const activation = await redeemRetailLocalActivationCode(code, requestId.toUpperCase(), "LIC-fixture");
    assert.equal(inserts, 1);
    assert.equal(bootstrap.redemption_request_id, requestId);
    assert.equal(tokenHash, crypto.createHash("sha256").update(activation.ingestionToken).digest("hex"));
    assert.deepEqual(await redeemRetailLocalActivationCode(code, requestId, "LIC-fixture"), activation);
    assert.equal(inserts, 1);
    await assert.rejects(redeemRetailLocalActivationCode(code, crypto.randomUUID()), /ถูกใช้แล้ว/);
    await assert.rejects(redeemRetailLocalActivationCode(code, [requestId] as unknown as string), /request id/);
    tokenHash = null; // Simulates revocation: exact replay cannot recover a revoked bearer.
    await assert.rejects(redeemRetailLocalActivationCode(code, requestId), /ถูกใช้แล้ว/);
  } finally {
    state.__bmsPostgresPool = previousPool;
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.BMS_SECRET_KEY; else process.env.BMS_SECRET_KEY = previousKey;
  }
});
