import assert from "node:assert/strict";
import test from "node:test";

import { isRealtimeRedisPong } from "../packages/realtime/src/pubsub.ts";

test("Redis readiness accepts normal and subscriber-mode PING replies", () => {
  assert.equal(isRealtimeRedisPong("PONG"), true);
  assert.equal(isRealtimeRedisPong(["pong", ""]), true);
  assert.equal(isRealtimeRedisPong("LOADING"), false);
  assert.equal(isRealtimeRedisPong(["message", "payload"]), false);
});
