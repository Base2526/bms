// Real local HTTP + PostgreSQL Inbox smoke, using the labelled disposable
// commercial test stack. The diagnostic mutation never calls AI or a provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { localState, localClient } from "./testing/retail-local-commercial-local.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = "http://localhost:3011";
const state = await localState();
assert.equal(state.database, "bms_retail_local_commercial_test");
const db = localClient(state);
await db.connect();
const user = (await db.query("SELECT tenant_id FROM users WHERE id=$1", [state.adminId])).rows[0];
assert.ok(user?.tenant_id, "The local test Administrator must exist");
const customerRef = `diagnostic:line:${state.adminId}`;
assert.equal((await db.query("SELECT count(*)::int AS n FROM bms_conversations WHERE tenant_id=$1 AND customer_ref=$2",
  [user.tenant_id, customerRef])).rows[0].n, 0, "Refusing to change an existing diagnostic conversation");
const marker = `FAKE-inbox-real-${randomUUID()}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
let conversationId = null;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "lang", value: "en", url: origin }]);
    const login = await context.request.post(`${origin}/api/graphql`, { data: {
      query: "mutation Login($input: LoginInput!) { loginAdmin(input: $input) { ok } }",
      variables: { input: { email: "retail-commercial-platform@example.invalid",
        password: state.userPassword } },
    } });
    const loginBody = await login.json();
    assert.equal(loginBody.data?.loginAdmin?.ok, true, JSON.stringify(loginBody.errors));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(`${origin}/admin/inbox`);
    if (!conversationId) {
      const created = await context.request.post(`${origin}/api/graphql`, { headers: { "x-scope": "admin" }, data: {
        query: "mutation($body: String) { bmsCreateInboxDiagnosticMessage(channel: \"line\", body: $body) { ok conversationId messageId } }",
        variables: { body: marker },
      } });
      const createdBody = await created.json();
      assert.equal(createdBody.data?.bmsCreateInboxDiagnosticMessage?.ok, true,
        JSON.stringify(createdBody.errors));
      conversationId = createdBody.data.bmsCreateInboxDiagnosticMessage.conversationId;
      assert.ok((await db.query("SELECT 1 FROM bms_messages WHERE tenant_id=$1 AND conversation_id=$2 AND body=$3",
        [user.tenant_id, conversationId, marker])).rowCount === 1);
    }
    // Wait for realtime or the list poll. The server returns actual GraphQL rows.
    await page.getByText(marker).first().waitFor();
    await page.getByText(marker).first().click();
    await page.waitForFunction(id => new URL(location.href).searchParams.get("c") === id,
      conversationId);
    await page.getByText(marker).last().waitFor();
    await page.reload();
    await page.getByText(marker).last().waitFor();
    console.log(`PASS real Inbox diagnostic persistence, detail and reload at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
  if (conversationId) {
    await db.query("BEGIN");
    try {
      await db.query("DELETE FROM bms_messages WHERE tenant_id=$1 AND conversation_id=$2 AND body=$3",
        [user.tenant_id, conversationId, marker]);
      await db.query("DELETE FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action IN ('inbox.diagnostic_message','inbox.assign')",
        [user.tenant_id, conversationId]);
      await db.query("DELETE FROM bms_conversations WHERE tenant_id=$1 AND id=$2 AND customer_ref=$3",
        [user.tenant_id, conversationId, customerRef]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  }
  await db.end();
}
