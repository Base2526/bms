// =============================================================
// Webhook signatures and handshake tokens are compared in constant time.
// -------------------------------------------------------------
// LINE and Meta already used crypto.timingSafeEqual. The Lazada, Shopee and TikTok tenant webhooks
// compared the computed HMAC with `sig !== mac`, and the Meta GET handshake compared the verify
// token with `!==`. Found 2026-11-24 (REST sweep); inventory-tenant-scope-contract only checks that
// a signature *exists*, not how it is compared.
// =============================================================
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { constantTimeTextEqual, verifyHexHmacSignature } from "../apps/web/lib/bms/crypto.ts";

const read = (path: string) => readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");

// String-aware comment stripper: a comment that quotes the old `!==` must not pass or fail the scan.
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i += 1; out += "\n"; continue; }
    if (ch === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end === -1 ? source.length : end + 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

test("hex HMAC verification accepts only the exact signature", () => {
  const body = JSON.stringify({ event: "FAKE-order", id: 1 });
  const mac = createHmac("sha256", "FAKE-secret").update(body).digest("hex");
  assert.equal(verifyHexHmacSignature("FAKE-secret", body, mac), true);
  assert.equal(verifyHexHmacSignature("FAKE-secret", body, mac.toUpperCase()), false, "case is part of the signature");
  assert.equal(verifyHexHmacSignature("FAKE-secret", body, mac.slice(0, -1)), false, "length mismatch must not throw");
  assert.equal(verifyHexHmacSignature("FAKE-secret", body + " ", mac), false);
  assert.equal(verifyHexHmacSignature("other", body, mac), false);
  assert.equal(verifyHexHmacSignature("FAKE-secret", body, null), false);
  assert.equal(verifyHexHmacSignature("FAKE-secret", body, ""), false);
});

test("constant-time text comparison", () => {
  assert.equal(constantTimeTextEqual("FAKE-token", "FAKE-token"), true);
  assert.equal(constantTimeTextEqual("FAKE-token", "FAKE-tokem"), false);
  assert.equal(constantTimeTextEqual("FAKE-token", "FAKE-toke"), false);
  assert.equal(constantTimeTextEqual("ไทย", "ไทย"), true, "multi-byte text compares by bytes");
});

test("tenant webhooks verify through the shared constant-time helpers", () => {
  for (const provider of ["lazada", "shopee", "tiktok"]) {
    const source = stripComments(read(`app/api/bms/${provider}/webhook/[tenantId]/route.ts`));
    assert.match(source, /verifyHexHmacSignature\(\s*cfg\.channel_secret\s*,\s*raw\s*,\s*sig\s*\)/, provider);
    assert.doesNotMatch(source, /sig\s*!==\s*mac|mac\s*!==\s*sig|createHmac\(/, `${provider} must not hand-roll the compare`);
  }
  const meta = stripComments(read("lib/bms/meta.ts"));
  assert.match(meta, /constantTimeTextEqual\(\s*token\s*\?\?\s*""\s*,\s*cfg\.webhook_verify_token\s*\)/);
  assert.doesNotMatch(meta, /token\s*!==\s*cfg\.webhook_verify_token/);
});
