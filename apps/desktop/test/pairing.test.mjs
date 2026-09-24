import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServerUrl, parsePairingHandoff, parsePairingInput } from "../src/pairing.mjs";

const TOKEN = `pos_${"a".repeat(32)}`;

test("normalizes a production server to its HTTPS origin", () => {
  assert.equal(normalizeServerUrl("shop.example.com/path"), "https://shop.example.com");
});

test("rejects cleartext remote servers but permits localhost development", () => {
  assert.equal(normalizeServerUrl("http://shop.example.com"), null);
  assert.equal(normalizeServerUrl("http://localhost:3000"), "http://localhost:3000");
});

test("parses the full pairing link used by the admin POS device page", () => {
  assert.deepEqual(parsePairingInput({ pairingInput: `https://shop.example.com/pos?t=${TOKEN}` }), {
    ok: true, serverUrl: "https://shop.example.com", token: TOKEN,
  });
});

test("accepts a token with a separately supplied server", () => {
  assert.deepEqual(parsePairingInput({ serverUrl: "shop.example.com", pairingInput: TOKEN }), {
    ok: true, serverUrl: "https://shop.example.com", token: TOKEN,
  });
});

test("does not accept credentials embedded in a server URL", () => {
  assert.equal(normalizeServerUrl("https://operator@shop.example.com"), null);
});

test("rejects malformed device tokens", () => {
  assert.equal(parsePairingInput({ serverUrl: "shop.example.com", pairingInput: "pos_short" }).ok, false);
});

test("accepts only a short-lived exact local-install pairing handoff", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const handoff = {
    version: 1,
    serverUrl: "http://127.0.0.1:3100",
    token: TOKEN,
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
  };
  assert.deepEqual(parsePairingHandoff(handoff, now), {
    ok: true,
    serverUrl: "http://127.0.0.1:3100",
    token: TOKEN,
  });
  assert.equal(parsePairingHandoff({ ...handoff, expiresAt: new Date(now - 1).toISOString() }, now), null);
  assert.equal(parsePairingHandoff({ ...handoff, extra: true }, now), null);
});
