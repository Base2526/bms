import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServerUrl, parsePairingInput } from "../src/pairing.mjs";

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
