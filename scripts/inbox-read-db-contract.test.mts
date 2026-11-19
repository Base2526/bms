/** Executes Inbox reads against the restored, disposable local PostgreSQL instance. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import { readBoundedWebhookText } from "../apps/web/lib/bms/webhookBody.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
// The repo's `graphql/` directory shadows the npm package under tsx's path resolver.
const { graphql, GraphQLError } = require(join(dirname(fileURLToPath(import.meta.url)),
  "../apps/web/node_modules/graphql/index.js"));
const { makeExecutableSchema } = require("@graphql-tools/schema");

test("disposable DB: Inbox list, detail and nested reads preserve types and tenant/Sales scope", {
  skip: process.env.BMS_INBOX_DISPOSABLE_DB !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "bms_realtime_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 1 });
  const client = await pool.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const owner = randomUUID();
  const helper = randomUUID();
  const outsider = randomUUID();
  const customer = randomUUID();
  const owned = randomUUID();
  const helped = randomUUID();
  const legacy = randomUUID();
  const foreign = randomUUID();
  const query = (sql: string, args?: unknown[]) => client.query(sql, args);
  try {
    await client.query("BEGIN");
    await query("INSERT INTO bms_tenants(id,name,slug) VALUES ($1,'Inbox fixture',$2),($3,'Inbox fixture',$4)",
      [tenantA, `inbox-fixture-${tenantA}`, tenantB, `inbox-fixture-${tenantB}`]);
    await query(`INSERT INTO users(id,name,role,password_hash,tenant_id) VALUES
      ($1,'Owner','Sales','fixture',$4),($2,'Helper','Sales','fixture',$4),
      ($3,'Outsider','Sales','fixture',$4)`, [owner, helper, outsider, tenantA]);
    await query("INSERT INTO bms_customers(id,tenant_id,name) VALUES ($1,$2,'Fixture customer')",
      [customer, tenantA]);
    await query(`INSERT INTO bms_customer_identities(tenant_id,customer_id,channel,external_ref,display_name)
      VALUES ($1,$2,'line','fixture-owned','Fixture identity')`, [tenantA, customer]);
    await query(`INSERT INTO bms_conversations
      (id,tenant_id,channel,customer_ref,customer_id,assigned_to_user_id,unread,last_message,last_message_at)
      VALUES ($1,$5,'line','fixture-owned',$7,$8,2,'latest message',now()),
             ($2,$5,'facebook','fixture-helped',NULL,$9,1,'helped message',now()-interval '1 minute'),
             ($3,$5,'web','fixture-legacy',NULL,NULL,0,'legacy message',now()-interval '2 minutes'),
             ($4,$6,'line','fixture-foreign',NULL,NULL,1,'foreign message',now())`,
      [owned, helped, legacy, foreign, tenantA, tenantB, customer, owner, outsider]);
    await query("INSERT INTO bms_conversation_helpers(tenant_id,conversation_id,user_id) VALUES ($1,$2,$3)",
      [tenantA, helped, helper]);
    await query(`INSERT INTO bms_messages(tenant_id,conversation_id,direction,body,sender,meta,created_at)
      VALUES ($1,$2,'IN','older message','customer','{}',now()-interval '10 minutes'),
             ($1,$2,'IN','latest message','customer',$3::jsonb,now()),
             ($1,$4,'IN','helped message','customer','{}',now()-interval '1 minute'),
             ($5,$6,'IN','foreign message','customer','{}',now())`,
      [tenantA, owned, JSON.stringify({ attachment: { url: "https://example.test/fixture.png", mimeType: "image/png" } }),
        helped, tenantB, foreign]);
    await query("INSERT INTO bms_conversation_notes(tenant_id,conversation_id,author,body) VALUES ($1,$2,'fixture','internal note')",
      [tenantA, owned]);
    await query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES ($1,'system:fixture','inbox.assign',$2,$3::jsonb)`,
      [tenantA, owned, JSON.stringify({ toUserId: owner })]);

    const columnTypes = (await query(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_name IN ('bms_audit_log','bms_conversations','bms_messages')
        AND column_name IN ('target','id','conversation_id','assigned_to_user_id')`)).rows;
    assert.ok(columnTypes.some((r: any) => r.table_name === "bms_audit_log" && r.column_name === "target" && r.data_type === "text"));
    assert.ok(columnTypes.some((r: any) => r.table_name === "bms_conversations" && r.column_name === "id" && r.data_type === "uuid"));
    assert.ok(columnTypes.some((r: any) => r.table_name === "bms_messages" && r.column_name === "id" && r.data_type === "bigint"));

    const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { query },
      "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
      "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "fixture" },
      "@/lib/notifications/service": {}, "./tenant": {}, "./channels": {}, "./channelHealth": {},
      "./coupons": {}, "./aiQuality": {}, "./customers": {}, "./customerAnswerEvidence": {},
      "./answerEvidenceStore": {}, "./failureAlert": {}, "./inboxMedia": {},
    });
    const list = await inbox.listConversations(tenantA, { limit: 2 });
    assert.deepEqual(list.map((row: any) => row.id), [owned, helped]);
    assert.deepEqual((await inbox.listConversations(tenantA, { search: "older message" })).map((r: any) => r.id), [owned]);
    assert.deepEqual((await inbox.listConversations(tenantA, { status: "CLOSED" })).map((r: any) => r.id), []);
    assert.deepEqual((await inbox.listConversations(tenantA, { assignedTo: helper })).map((r: any) => r.id), [helped]);
    assert.equal(await inbox.countUnreadConversations(tenantA), 2);
    assert.equal(await inbox.countUnreadConversations(tenantA, helper), 1);
    assert.equal((await inbox.getConversation(tenantA, owned)).customer_name, "Fixture customer");
    assert.equal((await inbox.getConversation(tenantA, legacy)).customer_name, null);
    assert.equal(await inbox.getConversation(tenantA, foreign), null);
    assert.equal((await inbox.listMessages(tenantA, owned, 1))[0].body, "latest message");
    assert.equal((await inbox.listMessages(tenantA, owned, 1))[0].meta.attachment.url,
      "https://example.test/fixture.png");
    assert.equal((await inbox.listMessages(tenantA, owned, 2))[0].body, "older message");
    assert.equal((await inbox.listNotes(tenantA, owned, 1))[0].body, "internal note");
    assert.equal((await inbox.listConversationHelpers(tenantA, helped))[0].id, helper);
    assert.equal((await inbox.listSystemEvents(tenantA, owned, 10))[0].kind, "assign");
    assert.deepEqual(await inbox.listSystemEvents(tenantA, legacy, 10), []);
    assert.ok((await inbox.getTimeline(tenantA, owned, 10)).some((e: any) => e.type === "MESSAGE_IN"));

    for (const read of [
      () => inbox.getConversation(tenantA, owned, outsider),
      () => inbox.getConversation(tenantA, foreign, owner),
      () => inbox.listMessages(tenantA, owned, 10, outsider),
      () => inbox.listNotes(tenantA, owned, 10, outsider),
      () => inbox.listConversationHelpers(tenantA, helped, owner),
      () => inbox.listSystemEvents(tenantA, owned, 10, outsider),
      () => inbox.getTimeline(tenantA, owned, 10, outsider),
    ]) {
      const value = await read();
      assert.ok(value === null || (Array.isArray(value) && value.length === 0));
    }
    assert.equal((await inbox.getConversation(tenantA, owned, owner)).id, owned);
    assert.equal((await inbox.getConversation(tenantA, helped, helper)).id, helped);
    assert.equal((await inbox.listMessages(tenantA, helped, 10, helper))[0].body, "helped message");
    assert.equal((await inbox.listConversationHelpers(tenantA, helped, helper))[0].id, helper);
    assert.equal((await inbox.listSystemEvents(tenantA, owned, 10, owner))[0].kind, "assign");
    assert.ok((await inbox.getTimeline(tenantA, owned, 10, owner)).length > 0);

    const loaded = loadWithStubs("apps/web/graphql/bmsInbox.ts", {
      "@/lib/bms/inbox": { ...inbox, isImageMime: () => false, channelSupportsPush: () => false,
        outboundStatus: () => "SENT" },
      "@/lib/bms/inboxMedia": { safeInboxAttachmentUrl: (url: unknown) => typeof url === "string" ? url : null },
      "@/lib/bms/permissions": { requirePermission: async (ctx: any, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
      } },
      "@/lib/bms/tenant": { getTenantId: (ctx: any) => ctx.tenantId },
      "@/lib/bms/audit": { audit: async () => undefined },
      "@/lib/auth": { requireAuth: () => ({ scope: "admin" }) },
      "@/lib/bms/platform": { isPlatformAdmin: async () => false },
      "graphql/error": { GraphQLError },
    }).bmsInboxResolvers;
    const typeDefs = `
      type Query {
        bmsConversations(status: String, search: String, assignedTo: ID, limit: Int): [BmsConversation!]!
        bmsConversation(id: ID!): BmsConversation
        bmsConversationTimeline(id: ID!): [BmsConversationTimeline!]!
      }
      type BmsConversation {
        id: ID!, channel: String!, customerRef: String, customerName: String,
        status: String!, unread: Int!, messages(limit: Int): [BmsMessage!]!,
        notes(limit: Int): [BmsConversationNote!]!, helpers: [BmsStaff!]!,
        systemEvents(limit: Int): [BmsSystemEvent!]!
      }
      type BmsMessage { id: ID!, direction: String!, body: String!, createdAt: String!, attachment: BmsAttachment }
      type BmsAttachment { url: String!, mimeType: String }
      type BmsConversationNote { id: ID!, body: String!, createdAt: String! }
      type BmsStaff { id: ID!, name: String }
      type BmsSystemEvent { id: ID!, kind: String!, at: String! }
      type BmsConversationTimeline { type: String!, at: String!, text: String! }
    `;
    const resolvers = {
      Query: { bmsConversations: loaded.Query.bmsConversations, bmsConversation: loaded.Query.bmsConversation,
        bmsConversationTimeline: loaded.Query.bmsConversationTimeline },
      BmsConversation: { customerRef: loaded.BmsConversation.customerRef,
        customerName: loaded.BmsConversation.customerName, messages: loaded.BmsConversation.messages,
        notes: loaded.BmsConversation.notes, helpers: loaded.BmsConversation.helpers,
        systemEvents: loaded.BmsConversation.systemEvents },
    };
    const schema = makeExecutableSchema({ typeDefs, resolvers });
    const source = `query($id: ID!) { bmsConversation(id: $id) {
      id customerName messages(limit: 2) { id body attachment { url } } notes(limit: 2) { id body }
      helpers { id name } systemEvents(limit: 2) { id kind }
    } }`;
    const context = (tenantId: string, role: string, id: string, permissions = ["inbox.view"]) =>
      ({ tenantId, admin: { id, role }, permissions });
    const execute = (schemaToUse: any, id: string, ctx: any) => graphql({ schema: schemaToUse,
      source, variableValues: { id }, contextValue: ctx });
    const executeList = (ctx: any, assignedTo?: string) => graphql({ schema,
      source: `query($assignedTo: ID) { bmsConversations(assignedTo: $assignedTo) { id } }`,
      variableValues: { assignedTo }, contextValue: ctx });
    const adminList = await executeList(context(tenantA, "Administrator", owner));
    assert.equal(adminList.errors, undefined);
    assert.deepEqual(adminList.data.bmsConversations.map((r: any) => r.id), [owned, helped, legacy]);
    const helperList = await executeList(context(tenantA, "Sales", helper), owner);
    assert.equal(helperList.errors, undefined);
    assert.deepEqual(helperList.data.bmsConversations.map((r: any) => r.id), [helped],
      "Sales cannot use assignedTo to read another staff member's queue");
    const ownerList = await executeList(context(tenantA, "Sales", owner));
    assert.deepEqual(ownerList.data.bmsConversations.map((r: any) => r.id), [owned]);
    const foreignList = await executeList(context(tenantB, "Administrator", owner));
    assert.deepEqual(foreignList.data.bmsConversations.map((r: any) => r.id), [foreign]);
    const adminResponse = await execute(schema, owned, context(tenantA, "Administrator", owner));
    assert.equal(adminResponse.errors, undefined);
    assert.equal(adminResponse.data.bmsConversation.messages[1].body, "latest message");
    assert.equal(adminResponse.data.bmsConversation.messages[1].attachment.url,
      "https://example.test/fixture.png");
    assert.equal(adminResponse.data.bmsConversation.systemEvents[0].kind, "assign");
    const ownerResponse = await execute(schema, owned, context(tenantA, "Sales", owner));
    assert.equal(ownerResponse.errors, undefined);
    assert.equal(ownerResponse.data.bmsConversation.id, owned);
    const helperResponse = await execute(schema, helped, context(tenantA, "Sales", helper));
    assert.equal(helperResponse.errors, undefined);
    assert.equal(helperResponse.data.bmsConversation.id, helped);
    const outsiderResponse = await execute(schema, owned, context(tenantA, "Sales", outsider));
    assert.equal(outsiderResponse.errors, undefined);
    assert.equal(outsiderResponse.data.bmsConversation, null);
    const foreignResponse = await execute(schema, foreign, context(tenantA, "Administrator", owner));
    assert.equal(foreignResponse.errors, undefined);
    assert.equal(foreignResponse.data.bmsConversation, null);
    const deniedResponse = await execute(schema, owned, context(tenantA, "Sales", owner, []));
    assert.equal(deniedResponse.errors[0].extensions.code, "FORBIDDEN");
    const failedSchema = makeExecutableSchema({ typeDefs, resolvers: {
      ...resolvers, BmsConversation: { ...resolvers.BmsConversation,
        systemEvents: async () => { throw new Error("fixture nested failure"); } },
    } });
    const failedResponse = await execute(failedSchema, owned, context(tenantA, "Administrator", owner));
    assert.match(failedResponse.errors[0].message, /fixture nested failure/);
    assert.equal(failedResponse.data.bmsConversation, null);

    // Execute the real inbound write SQL inside savepoints of this disposable
    // fixture transaction, so no fixture row survives the test.
    let failMessageInsert = false;
    const writeClient = {
      release() {},
      query: async (sql: string, args?: unknown[]) => {
        if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT inbox_inbound_write");
        if (sql === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT inbox_inbound_write");
        if (failMessageInsert && sql.includes("INSERT INTO bms_messages")) throw new Error("fixture write failure");
        return client.query(sql, args);
      },
    };
    const inbound = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { query, getClient: async () => writeClient },
      "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
      "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "fixture" },
      "@/lib/notifications/service": {},
      "./tenant": { beginTenantTx: async () => { await client.query("SAVEPOINT inbox_inbound_write"); } },
      "./channels": {}, "./channelHealth": {}, "./coupons": {}, "./aiQuality": {},
      "./customers": { ensureCustomerForIdentity: async () => customer },
      "./customerAnswerEvidence": { evidenceForQuality: () => null },
      "./answerEvidenceStore": {}, "./failureAlert": { reportBmsFailure: async () => undefined },
      "./inboxMedia": { safeInboxAttachmentUrl: (url: string) => url },
    });
    const beforeInbound = await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned]);
    assert.equal(await inbound.logInboundMessage(tenantA, "line", "fixture-owned", {
      body: "", attachment: { url: "https://example.test/image.png", mimeType: "image/png" },
    }), owned);
    assert.equal((await inbox.listMessages(tenantA, owned, 1))[0].body, "");
    assert.equal((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread,
      beforeInbound.rows[0].unread + 1);
    failMessageInsert = true;
    assert.equal(await inbound.logInboundMessage(tenantA, "line", "fixture-owned", { body: "lost fixture" }), null);
    failMessageInsert = false;
    assert.equal((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread,
      beforeInbound.rows[0].unread + 1, "a failed message insert cannot increment unread");
    assert.deepEqual((await inbox.listMessages(tenantA, owned, 10)).filter((m: any) => m.body === "lost fixture"), []);

    await query("UPDATE bms_conversations SET assigned_to_user_id=$3 WHERE tenant_id=$1 AND id=$2",
      [tenantA, owned, outsider]);
    assert.equal(await inbox.getConversation(tenantA, owned, owner), null, "reassigned owner loses read access");
    assert.deepEqual(await inbox.listMessages(tenantA, owned, 10, owner), []);
    assert.equal((await inbox.getConversation(tenantA, owned, outsider)).id, owned);

    await client.query("SAVEPOINT inbox_rls_read");
    await client.query("SET LOCAL ROLE bms_app");
    await query("SELECT set_config('bms.tenant_id',$1,true)", [tenantA]);
    assert.deepEqual((await query("SELECT id FROM bms_conversations ORDER BY id")).rows.map((r: any) => r.id).sort(),
      [owned, helped, legacy].sort(), "RLS must hide another tenant's conversation even without an app WHERE clause");
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_messages")).rows[0].n, 4);
    await client.query("ROLLBACK TO SAVEPOINT inbox_rls_read");

    const previouslyVisibleId = String((await inbox.listMessages(tenantA, owned, 1))[0].id);
    assert.equal(await inbound.logInboundMessage(tenantA, "line", "fixture-owned", {
      body: "arrived during read",
    }), owned);
    assert.equal(await inbound.markRead(tenantA, owned,
      { observedLatestMessageId: previouslyVisibleId }), false);
    assert.ok((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread > 0);
    const otherTenantMessageId = String((await query("SELECT id FROM bms_messages WHERE tenant_id=$1 LIMIT 1",
      [tenantB])).rows[0].id);
    assert.equal(await inbound.markRead(tenantA, owned,
      { observedLatestMessageId: otherTenantMessageId }), false);
    assert.equal(await inbound.markRead(tenantA, owned,
      { observedLatestMessageId: "invalid" }), false);
    const nowVisibleId = String((await inbox.listMessages(tenantA, owned, 1))[0].id);
    assert.equal(await inbound.markRead(tenantA, owned,
      { observedLatestMessageId: nowVisibleId }), true);
    assert.equal((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread, 0);
    const aiTurn = await inbound.logConversation(tenantA, "line", "fixture-owned",
      "AI fixture inbound", "AI fixture reply");
    assert.equal(aiTurn?.conversationId, owned);
    assert.deepEqual((await inbox.listMessages(tenantA, owned, 2)).map((m: any) => m.body),
      ["AI fixture inbound", "AI fixture reply"]);
    assert.equal((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread, 1);
    failMessageInsert = true;
    assert.equal(await inbound.logConversation(tenantA, "line", "fixture-owned",
      "AI lost fixture", "AI lost reply"), null);
    failMessageInsert = false;
    assert.equal((await query("SELECT unread FROM bms_conversations WHERE id=$1", [owned])).rows[0].unread, 1);
    assert.deepEqual((await inbox.listMessages(tenantA, owned, 20)).filter((m: any) => m.body === "AI lost fixture"), []);

    const eventClaims = loadWithStubs("apps/web/lib/bms/inboundEvents.ts", {
      "@/lib/db": { getClient: async () => writeClient },
      "./tenant": { beginTenantTx: async () => { await client.query("SAVEPOINT inbox_inbound_write"); } },
    });
    const route = loadWithStubs("apps/web/app/api/bms/tiktok/webhook/[tenantId]/route.ts", {
      "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
        ({ body, status: options?.status ?? 200 }) } },
      "@/lib/bms/channels": { getChannel: async () => ({ active: true, channel_secret: "fixture-secret" }) },
      "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
      "@/lib/bms/webhookBody": { readBoundedWebhookText },
      "crypto": { default: { createHmac } },
      "@/lib/bms/inbox": { logInboundMessage: inbound.logInboundMessage },
      "@/lib/bms/channelHealth": { recordInboundEvent: async () => undefined,
        recordWebhookVerifyFailed: async () => undefined },
      "@/lib/bms/inboundEvents": eventClaims,
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    });
    const postTikTok = (eventId: string, body: string, goodSignature = true) => {
      const raw = JSON.stringify({ messages: [{ id: eventId, user_id: "fixture-tiktok-user",
        content: { text: body } }] });
      const signature = createHmac("sha256", "fixture-secret").update(raw).digest("hex");
      return route.POST(new Request("https://example.test/webhook", { method: "POST", body: raw,
        headers: { "x-tiktok-signature": goodSignature ? signature : "invalid" } }),
      { params: { tenantId: tenantA } });
    };
    assert.equal((await postTikTok("fixture-invalid", "invalid", false)).status, 401);
    assert.equal((await postTikTok("fixture-event-1", "first fixture inbound")).status, 200);
    assert.equal((await postTikTok("fixture-event-1", "duplicate fixture inbound")).status, 200);
    const tikTokConversation = (await inbox.listConversations(tenantA, { search: "first fixture inbound" }))[0];
    assert.equal(tikTokConversation.channel, "tiktok");
    assert.deepEqual((await inbox.listMessages(tenantA, tikTokConversation.id)).map((m: any) => m.body),
      ["first fixture inbound"]);
    failMessageInsert = true;
    await assert.rejects(postTikTok("fixture-event-2", "failure fixture inbound"), /INBOUND_PERSIST_FAILED/);
    failMessageInsert = false;
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_inbound_events WHERE tenant_id=$1 AND external_event_id=$2",
      [tenantA, "fixture-event-2"])).rows[0].n, 0, "failed persistence releases a retryable claim");
    assert.equal((await postTikTok("fixture-event-2", "retry fixture inbound")).status, 200);
    assert.deepEqual((await inbox.listMessages(tenantA, tikTokConversation.id)).map((m: any) => m.body),
      ["first fixture inbound", "retry fixture inbound"]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
