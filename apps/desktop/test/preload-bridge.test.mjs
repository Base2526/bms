// Loads the real sandboxed preload with stubbed Electron objects. The IPC tests in
// window-lifecycle.test.mjs call main-process handlers directly, so a preload that reshaped or
// truncated arguments before ipcRenderer.invoke() was never exercised.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { MAX_QUEUE_DISPLAYS } from "../src/display-policy.mjs";

async function loadBridge() {
  const source = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const invocations = [];
  let bridge = null;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        assert.equal(name, "bmsDesktop");
        bridge = api;
      },
    },
    ipcRenderer: {
      invoke(channel, payload) {
        invocations.push({ channel, payload });
        return Promise.resolve({ ok: true });
      },
      on() {},
      send() {},
      removeListener() {},
    },
  };
  const require = (specifier) => {
    assert.equal(specifier, "electron/renderer", "the sandboxed preload may only load electron/renderer");
    return electron;
  };
  vm.runInNewContext(source, { require, module: { exports: {} }, exports: {}, console }, { filename: "preload.cjs" });
  assert.ok(bridge, "preload must expose window.bmsDesktop");
  return { bridge, invocations };
}

test("preload forwards every selected queue display up to the main-process cap", async () => {
  const { bridge, invocations } = await loadBridge();
  const ids = Array.from({ length: 6 }, (_value, index) => `display-${index + 1}`);
  await bridge.setQueueDisplaysConfig({ mode: "selected", targetDisplayIds: ids, audioDisplayId: "display-6" });
  const call = invocations.at(-1);
  assert.equal(call.channel, "bms-pos:set-queue-displays-config");
  assert.deepEqual(call.payload.targetDisplayIds, ids,
    "a fifth or sixth selected screen must reach the main process, which validates up to MAX_QUEUE_DISPLAYS");
  assert.equal(call.payload.audioDisplayId, "display-6");
});

test("preload still bounds queue display ids at MAX_QUEUE_DISPLAYS and coerces non-strings", async () => {
  const { bridge, invocations } = await loadBridge();
  const ids = Array.from({ length: MAX_QUEUE_DISPLAYS + 5 }, (_value, index) => index === 0 ? 7 : `d-${index}`);
  await bridge.setQueueDisplaysConfig({ mode: "selected", targetDisplayIds: ids });
  const forwarded = invocations.at(-1).payload.targetDisplayIds;
  assert.equal(forwarded.length, MAX_QUEUE_DISPLAYS);
  assert.equal(forwarded[0], "", "non-string ids are blanked so the main process rejects them");
  assert.equal(forwarded[1], "d-1");
});
