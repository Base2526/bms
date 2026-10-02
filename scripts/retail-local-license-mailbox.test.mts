import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdminRouteCtx } from "../apps/web/lib/bms/adminRouteAuth.ts";

test("local activation mailbox validates tenant, confirmation and runtime; exact retries never overwrite pending requests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bms-license-mailbox-"));
  const savedMode = process.env.BMS_DEPLOYMENT_MODE;
  const savedRoot = process.env.BMS_LOCAL_LICENSE_UI_DIR;
  const savedNode = process.env.NODE_ENV;
  const global = globalThis as typeof globalThis & { __bmsPostgresPool?: unknown };
  const savedPool = global.__bmsPostgresPool;
  const tenantId = "11111111-1111-4111-8111-111111111111";
  let checkedOut = false;
  const audits: unknown[] = [];
  global.__bmsPostgresPool = {
    query: async (sql: string, params: unknown[]) => {
      assert.equal(checkedOut, false, "must not acquire a second pooled connection while holding the lock");
      if (sql.includes("bms_local_installation")) return { rows: params[0] === tenantId ? [{ tenant_id: tenantId }] : [] };
      assert.match(sql, /INSERT INTO bms_audit_log/); audits.push(params); return { rows: [] };
    },
    connect: async () => {
      checkedOut = true;
      return { query: async () => ({ rows: [] }), release: () => { checkedOut = false; } };
    },
  };
  process.env.NODE_ENV = "test";
  process.env.BMS_DEPLOYMENT_MODE = "retail-local";
  process.env.BMS_LOCAL_LICENSE_UI_DIR = root;
  try {
    const { getLocalLicense, requestLocalLicenseActivation } = await import("../apps/web/lib/bms/localLicense.ts");
    const ctx = { scope: "admin", admin: { id: "test", tenant_id: tenantId } } as AdminRouteCtx;
    const code = "bmsla_" + "x".repeat(43);
    const requestId = "01234567-1234-4234-8234-123456789abc";
    const input = { activationCode: code, requestId, confirmation: "REGISTER-LOCAL-LICENSE", tenantId: "ignored-client-tenant" };
    const errorStatus = (status: number) => (error: unknown) => (error as { status: number }).status === status;
    assert.equal((await getLocalLicense(tenantId)).available, false);
    await assert.rejects(getLocalLicense("other-tenant"), errorStatus(404));
    await assert.rejects(requestLocalLicenseActivation(ctx, null), errorStatus(400));
    await assert.rejects(requestLocalLicenseActivation(ctx, { ...input, confirmation: "yes" }), errorStatus(400));
    await assert.rejects(requestLocalLicenseActivation(ctx, { ...input, activationCode: "LIC-reference" }), errorStatus(400));
    await assert.rejects(requestLocalLicenseActivation(ctx, input), errorStatus(503));
    await mkdir(path.join(root, "status")); await mkdir(path.join(root, "requests"));
    const snapshot = { tenantId, heartbeat: new Date().toISOString(), available: true, registered: false, activationCode: "SECRET", evidenceToken: "SECRET" };
    await writeFile(path.join(root, "status/view.json"), JSON.stringify(snapshot));
    assert.deepEqual(await requestLocalLicenseActivation(ctx, input), { requestId });
    const destination = path.join(root, "requests/activation.json");
    const raw = await readFile(destination, "utf8");
    assert.equal(JSON.parse(raw).tenantId, tenantId);
    assert.deepEqual(await requestLocalLicenseActivation(ctx, input), { requestId });
    assert.equal(await readFile(destination, "utf8"), raw);
    await assert.rejects(requestLocalLicenseActivation(ctx, { ...input, requestId: "01234567-1234-4234-8234-123456789def" }), errorStatus(409));
    const view = await getLocalLicense(tenantId);
    assert.equal(view.requestStatus, "PENDING");
    assert.doesNotMatch(JSON.stringify(view), /SECRET|bmsla_|ignored-client-tenant/);
    assert.equal(audits.length, 1);
    assert.doesNotMatch(JSON.stringify(audits), /bmsla_/);
    process.env.BMS_DEPLOYMENT_MODE = "cloud";
    await assert.rejects(getLocalLicense(tenantId), errorStatus(404));
    await assert.rejects(requestLocalLicenseActivation(ctx, input), errorStatus(404));
  } finally {
    for (const [key, value] of [["BMS_DEPLOYMENT_MODE", savedMode], ["BMS_LOCAL_LICENSE_UI_DIR", savedRoot], ["NODE_ENV", savedNode]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    global.__bmsPostgresPool = savedPool;
    await rm(root, { recursive: true, force: true });
  }
});
