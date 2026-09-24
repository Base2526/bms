import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("operational attention is cashier-frame only, throttled, and carries no renderer PII", async () => {
  const [main, preload] = await Promise.all([
    read("src/main.mjs"),
    read("src/preload.cjs"),
  ]);
  assert.match(preload, /requestOperationalAttention: \(\) => ipcRenderer\.invoke\("bms-pos:request-operational-attention"\)/);
  assert.doesNotMatch(preload, /requestOperationalAttention: \([^)]*[a-zA-Z]/);
  assert.match(main, /request-operational-attention[\s\S]+isPairedCashierFrame\(event\)/);
  assert.match(main, /OPERATIONAL_ATTENTION_COOLDOWN_MS = 5_000/);
  assert.ok(
    main.indexOf("if (mainWindow.isFocused())") < main.indexOf("now - lastOperationalAttentionAt"),
    "foreground events must not consume the background notification cooldown",
  );
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /mainWindow\.flashFrame\(true\)/);
  assert.match(main, /body: "มีงานออร์เดอร์รอดำเนินการ"/);
  assert.doesNotMatch(main, /new Notification\(\{[\s\S]{0,300}(customer|provider|orderId)/i);
});
