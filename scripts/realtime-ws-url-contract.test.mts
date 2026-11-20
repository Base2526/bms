import assert from "node:assert/strict";
import test from "node:test";
import { configuredRealtimeWsUrl } from "../apps/web/lib/realtimeWsUrl.ts";

test("browser realtime URL accepts only absolute WS endpoints without embedded credentials", () => {
  assert.equal(configuredRealtimeWsUrl("ws://localhost:4000/graphql"), "ws://localhost:4000/graphql");
  assert.equal(configuredRealtimeWsUrl(" wss://example.test/graphql "), "wss://example.test/graphql");
  for (const value of [undefined, "", "undefined", "/graphql", "https://example.test/graphql",
    "wss://user:secret@example.test/graphql", "wss://example.test/graphql#fragment", "ws://"]) {
    assert.equal(configuredRealtimeWsUrl(value), null);
  }
});
