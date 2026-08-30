import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSource = await readFile(
  new URL("../apps/web/lib/bms/orders.ts", import.meta.url),
  "utf8"
);
const ordersPageSource = await readFile(
  new URL("../apps/web/app/(admin)/admin/orders/page.tsx", import.meta.url),
  "utf8"
);

test("deposit close comments are part of the order journey timeline", () => {
  assert.match(serviceSource, /cancel_reason: string \| null/);
  assert.match(serviceSource, /d\.cancelled_at, d\.cancel_reason/);
  assert.match(serviceSource, /kind: "deposit_close"/);
  assert.match(serviceSource, /คืนมัดจำเต็มจำนวน ฿\$\{paid\}/);
  assert.match(serviceSource, /ยึดมัดจำ ฿\$\{paid\}/);
  assert.match(serviceSource, /เหตุผล: \$\{depositRow\.cancel_reason\}/);
});

test("admin order page renders timeline event text without filtering deposit close events", () => {
  assert.match(ordersPageSource, /events \{ kind at text actorName \}/);
  assert.match(ordersPageSource, /const events: JEvent\[\] = j\.events \|\| \[\]/);
  assert.match(ordersPageSource, /items=\{events\.map\(\(e\) =>/);
  assert.match(ordersPageSource, /\{e\.text\}/);
  assert.doesNotMatch(ordersPageSource, /filter\(\(e\).*deposit_close/);
});
