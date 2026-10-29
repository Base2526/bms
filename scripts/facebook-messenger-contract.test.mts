import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { verifyMetaSignature } from "../apps/web/lib/bms/crypto.ts";
import { metaChallenge, metaEnvelopeMatches, parseMetaEvents } from "../apps/web/lib/bms/meta.ts";

const repo = path.resolve(import.meta.dirname, "..");

const config = {
  channel: "facebook",
  active: true,
  access_token: "page-token",
  channel_secret: "app-secret",
  webhook_verify_token: "separate-verify-token-012345678901",
  external_account_id: "123456789012345",
  extra: {},
};

test("Meta webhook challenge uses a separate verify token and fails closed", () => {
  const ok = new URL("https://example.test/webhook?hub.mode=subscribe&hub.verify_token=separate-verify-token-012345678901&hub.challenge=42");
  const appSecret = new URL("https://example.test/webhook?hub.mode=subscribe&hub.verify_token=app-secret&hub.challenge=42");
  assert.equal(metaChallenge(ok, config), "42");
  assert.equal(metaChallenge(appSecret, config), null);
  assert.equal(metaChallenge(ok, null), null);
});

test("Meta signature covers the exact raw body", () => {
  const raw = JSON.stringify({ object: "page", entry: [] });
  const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature("app-secret", raw, signature), true);
  assert.equal(verifyMetaSignature("app-secret", `${raw}\n`, signature), false);
});

test("Facebook parser binds Page ID, ignores echo and requires a durable mid", () => {
  const body = {
    object: "page",
    entry: [{
      id: "123456789012345",
      messaging: [
        { sender: { id: "998877665544" }, message: { mid: "m-1", text: " hello " } },
        { sender: { id: "998877665544" }, message: { mid: "m-2", text: "echo", is_echo: true } },
        { sender: { id: "998877665544" }, message: { text: "missing mid" } },
      ],
    }],
  };
  assert.deepEqual(parseMetaEvents(body, "123456789012345"), [{
    externalAccountId: "123456789012345",
    senderId: "998877665544",
    text: "hello",
    eventId: "m-1",
    attachments: [],
  }]);
  assert.deepEqual(parseMetaEvents(body, "different-page"), []);
  assert.equal(metaEnvelopeMatches(body, "different-page"), false);
  assert.equal(metaEnvelopeMatches(body, "123456789012345"), true);
  assert.deepEqual(parseMetaEvents({ ...body, object: "instagram" }, "123456789012345"), []);
});

test("Facebook route durably enqueues before running the AI worker", () => {
  const route = readFileSync(path.join(repo, "apps/web/app/api/bms/facebook/webhook/[tenantId]/route.ts"), "utf8");
  const enqueueAt = route.indexOf("enqueueMetaInboundEvents");
  const processAt = route.indexOf("runMetaInboundBatch", enqueueAt);
  assert.ok(route.includes("verifyMetaSignature"));
  assert.ok(route.includes("cfg.external_account_id"));
  assert.ok(enqueueAt >= 0 && processAt > enqueueAt);
});

test("Meta credentials, Page binding and queue are represented in the migration", () => {
  const migration = readFileSync(path.join(repo, "db/migrations/10.104__bms_meta_messenger_hardening.sql"), "utf8");
  assert.match(migration, /webhook_verify_token TEXT/);
  assert.match(migration, /external_account_id TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_channel_inbound_jobs/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_channel_inbound_jobs TO bms_app/);
});

test("Facebook outbound replies are Page-bound and stay inside the response window", () => {
  const inbox = readFileSync(path.join(repo, "apps/web/lib/bms/inbox.ts"), "utf8");
  const health = readFileSync(path.join(repo, "apps/web/lib/bms/channelHealth.ts"), "utf8");
  assert.match(inbox, /interval '24 hours'/);
  assert.match(inbox, /cfg\.external_account_id/);
  assert.match(inbox, /encodeURIComponent\(cfg\.external_account_id\).*\/messages/);
  assert.match(health, /String\(accountId \?\? ""\) !== cfg\.external_account_id/);
});
