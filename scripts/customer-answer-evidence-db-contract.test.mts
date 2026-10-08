/** Dedicated disposable PostgreSQL only. Never points at the normal application database. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { captureCustomerAnswer, evidenceForQuality, recordCustomerToolEvidence } from "../apps/web/lib/bms/customerAnswerEvidence.ts";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");

test("disposable DB: evidence tenancy, atomic messages, savepoint isolation, exact pairing, expiry and cascade", {
  skip: process.env.BMS_EVIDENCE_DISPOSABLE_DB !== "1",
}, async () => {
  const pool = new Pool({ host: "127.0.0.1", port: 55453, database: "evidence_test", user: "postgres", password: "FAKE-evidence-test-only", max: 3 });
  const a = randomUUID(), b = randomUUID(), ca = randomUUID(), cb = randomUUID();
  try {
    // This file refuses an existing schema, so reruns require a fresh disposable container.
    assert.equal((await pool.query("SELECT to_regclass('bms_messages') AS tbl")).rows[0].tbl, null);
    await pool.query(`CREATE ROLE bms_app;
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY);
      CREATE TABLE bms_customer_identities(tenant_id uuid,channel text,external_ref text,customer_id uuid);
      CREATE TABLE bms_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,channel text,customer_ref text,
        customer_id uuid,status text,unread int,last_message text,last_message_at timestamptz,last_sender_type text,updated_at timestamptz,
        UNIQUE(tenant_id,channel,customer_ref));
      CREATE TABLE bms_messages(id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,conversation_id uuid NOT NULL REFERENCES bms_conversations(id),
        direction text,body text,sender text,meta jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
      GRANT ALL ON ALL TABLES IN SCHEMA public TO bms_app;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;`);
    const migration = readFileSync(new URL("../db/migrations/10.53__bms_customer_answer_evidence.sql", import.meta.url), "utf8");
    await pool.query(migration); await pool.query(migration); // idempotent migration
    await pool.query("INSERT INTO bms_tenants VALUES ($1),($2)", [a,b]);
    await pool.query("INSERT INTO bms_conversations(id,tenant_id,channel,customer_ref,status,unread) VALUES ($1,$2,'web','FAKE-A','OPEN',0),($3,$4,'web','FAKE-B','OPEN',0)", [ca,a,cb,b]);
    const store = loadWithStubs("apps/web/lib/bms/answerEvidenceStore.ts", {
      "@/lib/db": { query: (sql: string, values: any[]) => pool.query(sql, values), getClient: () => pool.connect() },
      "./tenant": { beginTenantTx }, "./aiQuality": { redactQualityText: (text: string) => text },
      "./customerAnswerEvidence": await import("../apps/web/lib/bms/customerAnswerEvidence.ts"),
    });
    let failEvidence = false;
    const incidents: any[] = [];
    const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { query: (sql: string, values: any[]) => pool.query(sql, values), getClient: () => pool.connect() },
      "@/lib/pubsub": { pubsub: { publish: async () => {} } },
      "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE" },
      "./channels": {}, "./channelHealth": {}, "@/lib/notifications/service": {}, "./coupons": {},
      "./tenant": { beginTenantTx }, "./aiQuality": { enqueueAiQualityReview: async () => {} },
      "./customers": { ensureCustomerForIdentity: async () => null },
      "./failureAlert": { reportBmsFailure: async (v: any) => incidents.push(v) },
      "./customerAnswerEvidence": { evidenceForQuality },
      "./answerEvidenceStore": { persistAnswerEvidence: async (...args: any[]) => {
        if (failEvidence) await args[0].query("SELECT 1/0");
        else await store.persistAnswerEvidence(...args);
      } },
    });
    const turn = () => captureCustomerAnswer(a, "web", async () => {
      recordCustomerToolEvidence({ tenantId: a, surface: "customer", tool: "get_restaurant_availability", input: {},
        output: { status: "OK", tableDetails: [{ area: "FAKE ชั้น 2", seats: 6, availableTables: 2 }] },
        outcome: "ok", source: "SERVER_SELECTED", startedAt: new Date().toISOString() });
      return { reply: "FAKE reply", quality: { outcome: "SUCCESS", reasonCodes: [], successfulToolCalls: 1, failedToolCalls: 0 } };
    });
    const first = await turn();
    await Promise.all([1,2].map(() => inbox.logConversation(a,"web","FAKE-A","FAKE question",first.reply,first.quality)));
    assert.equal(incidents.length, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bms_messages")).rows[0].n, 2, "turn retry deduplicates exact message pair");
    const header = (await pool.query("SELECT * FROM bms_ai_turn_evidence")).rows[0];
    const read = await store.getAnswerEvidence(a, String(header.output_message_id));
    assert.equal(read.question, "FAKE question"); assert.equal(read.replyMatches, true);
    assert.equal(read.calls.length, 1);
    assert.equal(read.calls[0].safe_output.tableDetails[0].seats, 6);
    assert.equal(await store.getAnswerEvidence(b, String(header.output_message_id)), null);
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE bms_app");
      assert.equal((await client.query("SELECT * FROM bms_ai_turn_evidence")).rows.length, 0, "missing tenant fails closed");
      await client.query("ROLLBACK");
      await beginTenantTx(client,b);
      assert.equal((await client.query("SELECT * FROM bms_ai_turn_evidence")).rows.length, 0, "RLS hides another tenant");
      await assert.rejects(client.query("UPDATE bms_ai_turn_evidence SET tenant_id=$1 WHERE tenant_id=$2",[b,a]).then(async () => {
        await store.persistAnswerEvidence(client, b, cb, header.input_message_id, header.output_message_id, "FAKE", { ...evidenceForQuality(first.quality), tenantId:b, id:randomUUID() });
      }), /foreign key/);
      await client.query("ROLLBACK");
    } finally { client.release(); }
    failEvidence = true;
    const second = await turn();
    await inbox.logConversation(a,"web","FAKE-A","FAKE second",second.reply,second.quality);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].code, "ai.evidence_persist_failed");
    const failed = (await pool.query("SELECT meta FROM bms_messages WHERE direction='OUT' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(failed.meta.aiEvidence.status, "FAILED");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bms_messages")).rows[0].n, 4);
    await pool.query("ALTER TABLE bms_ai_turn_evidence RENAME TO fake_missing_evidence");
    assert.equal((await store.getAnswerEvidence(a,String(header.output_message_id))).status,"FAILED");
    await pool.query("ALTER TABLE fake_missing_evidence RENAME TO bms_ai_turn_evidence");
    await pool.query("UPDATE bms_ai_turn_evidence SET snapshot_expires_at=now()-interval '1 day'");
    assert.equal((await store.getAnswerEvidence(a,String(header.output_message_id))).status,"EXPIRED");
    const purged = await store.purgeAnswerEvidence(); assert.equal(purged.expired,1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bms_ai_tool_evidence")).rows[0].n,0);
    await pool.query("DELETE FROM bms_messages WHERE id=$1",[header.input_message_id]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bms_ai_turn_evidence")).rows[0].n,0,"source deletion cascades evidence");
  } finally { await pool.end(); }
});
