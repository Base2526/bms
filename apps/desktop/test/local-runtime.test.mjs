import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureManagedLocalRuntime,
  isManagedLocalServerUrl,
  managedLocalPosDevicesUrl,
  managedLocalRuntimePlan,
} from "../src/local-runtime.mjs";

const LOCAL_URL = "http://127.0.0.1:3100";

function metadata({ uid, mode }) {
  return {
    uid,
    mode,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

test("recognizes only the managed Retail Local origin", () => {
  assert.equal(isManagedLocalServerUrl(LOCAL_URL), true);
  assert.equal(isManagedLocalServerUrl("http://localhost:3100"), false);
  assert.equal(isManagedLocalServerUrl("https://shop.example.com"), false);
});

test("opens the managed local POS device page without requiring users to know its URL", () => {
  assert.equal(managedLocalPosDevicesUrl(), "http://127.0.0.1:3100/admin/pos-devices");
});

test("builds a macOS launch plan only for the managed local origin", () => {
  assert.deepEqual(managedLocalRuntimePlan({
    serverUrl: LOCAL_URL,
    platform: "darwin",
    homeDirectory: "/Users/operator",
  }), {
    controllerPath: "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local",
    receiptPath: "/Users/operator/Library/Application Support/BMS/RetailLocal/installation.json",
  });
  assert.equal(managedLocalRuntimePlan({
    serverUrl: "https://shop.example.com",
    platform: "darwin",
  }), null);
});

test("never starts a local runtime for a remote pairing", async () => {
  let executed = false;
  const result = await ensureManagedLocalRuntime("https://shop.example.com", {
    platform: "darwin",
    execFile: async () => { executed = true; },
  });
  assert.deepEqual(result, { attempted: false });
  assert.equal(executed, false);
});

test("validates the receipt and root-owned controller before ensuring runtime", async () => {
  const calls = [];
  const result = await ensureManagedLocalRuntime(LOCAL_URL, {
    platform: "darwin",
    homeDirectory: "/Users/operator",
    lstat: async (target) => target === "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local"
      ? metadata({ uid: 0, mode: 0o100755 })
      : metadata({ uid: typeof process.getuid === "function" ? process.getuid() : 501, mode: 0o100600 }),
    readFile: async () => JSON.stringify({ product: "BMS Retail Local", url: LOCAL_URL }),
    execFile: async (...args) => { calls.push(args); },
  });
  assert.deepEqual(result, { attempted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local");
  assert.deepEqual(calls[0][1], ["ensure-running"]);
});

test("rejects a writable controller without executing it", async () => {
  let executed = false;
  await assert.rejects(() => ensureManagedLocalRuntime(LOCAL_URL, {
    platform: "darwin",
    homeDirectory: "/Users/operator",
    lstat: async (target) => target === "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local"
      ? metadata({ uid: 0, mode: 0o100775 })
      : metadata({ uid: typeof process.getuid === "function" ? process.getuid() : 501, mode: 0o100600 }),
    readFile: async () => JSON.stringify({ product: "BMS Retail Local", url: LOCAL_URL }),
    execFile: async () => { executed = true; },
  }), (error) => error?.code === "LOCAL_RUNTIME_UNTRUSTED");
  assert.equal(executed, false);
});
