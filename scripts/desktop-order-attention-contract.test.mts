// Desktop incoming-order attention — source contract
//
// The shell may attract attention, but every authoritative order action must stay on the existing
// device/PIN/RBAC/idempotent web path. These assertions keep the visible bell from drifting into a
// second native order workflow or leaking order data into an OS notification.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("restaurant shell keeps incoming orders visible across operational screens", async () => {
  const [restaurant, workspace, context] = await Promise.all([
    read("apps/web/app/(pos)/pos/restaurant/page.tsx"),
    read("apps/web/app/(pos)/pos/page.tsx"),
    read("apps/web/components/pos/PosWorkspaceContext.tsx"),
  ]);

  assert.match(restaurant, /key: "INCOMING"[\s\S]{0,300}badge: incomingActionOrders\.length/);
  assert.match(restaurant, /incomingActionOrders\.length > 0 && screen !== "INCOMING"/);
  assert.match(restaurant, /initialTab: "incoming"/);
  assert.match(restaurant, /json\("\/api\/pos\/restaurant\/incoming", \{ signal \}\)/);
  assert.match(restaurant, /useRealtimeInvalidation\(\{[\s\S]{0,300}INCOMING_ORDER_REALTIME_EVENTS/);
  assert.match(restaurant, /requestDesktopOperationalAttention\(\)/);

  assert.match(context, /onIncomingOrdersChange\?:/);
  assert.match(workspace, /onIncomingOrdersChange\?\.\(\{/);
  assert.match(workspace, /action: "pause", paused: !restaurantOrdersPaused/);
  assert.match(workspace, /action: "delivery_pause"/);
  assert.match(workspace, /incomingOrderOperationalState\(order\)/);
  assert.match(workspace, /PLATFORM_CANCELLED/);
  assert.match(workspace, /ยกเลิกยอดคงเหลือ \/ เปิดคืนเงิน/);
  assert.match(workspace, /deliveryPauseControlledElsewhere/);
  assert.match(workspace, /requestDesktopOperationalAttention\(\)/);
  assert.match(workspace, /enabled: Boolean\(token\) && session\?\.businessArchetype === "restaurant"/);
  assert.doesNotMatch(workspace, /enabled: Boolean\(token\) && Boolean\(session\?\.shift\)[\s\S]{0,120}businessArchetype/);
});

test("incoming order actions retain device, PIN, permission and idempotency guards", async () => {
  const route = await read("apps/web/app/api/pos/restaurant/incoming/route.ts");

  assert.match(route, /authenticateRestaurantRead\(req\)/);
  assert.match(route, /authenticateRestaurantMutation\(req, body, permission\)/);
  assert.match(route, /action === "pause" \? "restaurant\.floor\.manage"/);
  assert.match(route, /action === "delivery_pause" \? "restaurant\.order_intake\.manage"/);
  assert.match(route, /action === "delivery_handoff" \? "restaurant\.delivery\.handoff"/);
  assert.match(route, /action === "delivery_ready" \? "restaurant\.kitchen\.update"/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /tenantId: auth\.device\.tenantId/);
  assert.match(route, /locationId: auth\.device\.locationId/);
});

test("native attention accepts no renderer-supplied order payload", async () => {
  const [main, preload] = await Promise.all([
    read("apps/desktop/src/main.mjs"),
    read("apps/desktop/src/preload.cjs"),
  ]);

  assert.match(preload, /requestOperationalAttention: \(\) => ipcRenderer\.invoke/);
  assert.match(main, /request-operational-attention[\s\S]{0,200}isPairedCashierFrame\(event\)/);
  assert.match(main, /OPERATIONAL_ATTENTION_COOLDOWN_MS = 5_000/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /mainWindow\.flashFrame\(true\)/);
  assert.doesNotMatch(main, /new Notification\(\{[\s\S]{0,300}(customer|provider|orderId)/i);
});
