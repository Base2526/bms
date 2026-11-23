import assert from "node:assert/strict";
import test from "node:test";

import { invalidSlackWebhookUrls } from "../apps/web/lib/bms/reportRecipients.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const validUrl = "https://hooks.slack.com/services/T123/B456/secret_789";

test("Slack webhook validation refuses internal hosts, lookalikes and alternate URL components", () => {
  assert.deepEqual(invalidSlackWebhookUrls([validUrl]), []);
  const unsafe = [
    "https://127.0.0.1/services/T123/B456/key",
    "https://169.254.169.254/services/T123/B456/key",
    "https://hooks.slack.com.evil.test/services/T123/B456/key",
    "https://hooks.slack.com@evil.test/services/T123/B456/key",
    "https://user@hooks.slack.com/services/T123/B456/key",
    "https://hooks.slack.com:444/services/T123/B456/key",
    "https://hooks.slack.com/other/T123/B456/key",
    "https://hooks.slack.com/services/T123/B456/key?next=http://127.0.0.1",
    "https://hooks.slack.com/services/T123/B456/key#fragment",
    "https://hooks.slack.com/services/T123/B456/%2e%2e",
    "http://hooks.slack.com/services/T123/B456/key",
  ];
  assert.deepEqual(invalidSlackWebhookUrls(unsafe), unsafe);
});

test("legacy encrypted URL is rechecked before any fetch and valid Slack requests forbid redirect", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const result = loadWithStubs("apps/web/lib/bms/reportDigest.ts", {
    "@/lib/db": { getClient: () => { throw new Error("unexpected DB"); }, query: () => { throw new Error("unexpected DB"); } },
    "./tenant": { beginTenantTx: () => { throw new Error("unexpected DB"); } },
    "./featureAccess": { requirePackageFeature: () => { throw new Error("unexpected DB"); } },
    "./crypto": { encryptSecret: (s: string) => s, decryptSecret: (s: string) => s },
    "@/lib/mailer": { sendEmail: () => { throw new Error("unexpected email"); } },
    "./channels": { getChannel: () => { throw new Error("unexpected channel"); } },
    "./platform": { getTenantName: () => { throw new Error("unexpected DB"); } },
    "./storeProfile": { getStoreProfile: () => { throw new Error("unexpected DB"); }, DEFAULT_EMAIL_THEME_COLOR: "#000" },
    "./reportRecipients": await import("../apps/web/lib/bms/reportRecipients.ts"),
    "./storeLocale": { DEFAULT_STORE_TIMEZONE: "Asia/Bangkok", isValidTimeZone: () => true, resolveStoreTimezone: () => "Asia/Bangkok" },
  }, async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => "ok" };
  });
  const unsafe = await result.sendSlackChannel("https://127.0.0.1/services/T/B/key", { report: "private" });
  assert.equal(unsafe.ok, false);
  assert.equal(calls.length, 0);
  const valid = await result.sendSlackChannel(validUrl, { report: "private" });
  assert.equal(valid.ok, true);
  assert.equal(valid.error?.includes("secret_789"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, validUrl);
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal);
});
