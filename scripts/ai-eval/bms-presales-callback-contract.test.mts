import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadWithStubs } from "../testing/webhookHarness.mts";
import {
  composePresalesCallbackReply,
  isExplicitPresalesCallbackRequest,
  isPresalesLineContactQuestion,
} from "../../apps/web/lib/bms/presalesCallbackIntent.ts";

test("callback intent is strong and contact-detail questions remain read-only", () => {
  for (const message of [
    "ให้ sale ติดต่อกลับด้วย", "รบกวนฝ่ายขายโทรกลับ", "ขอคุยกับเซลส์", "อยากให้เจ้าหน้าที่ทักกลับ",
    "Please have Sales contact me", "I want to speak with a sales representative",
    "โทรกลับด้วยครับ", "ช่วยติดต่อกลับหน่อย", "Can you call me back?", "Please contact me",
    "โทรกลับ", "ติดต่อกลับทางไลน์", "รบกวนทีมขายช่วยโทรกลับ", "Can sales contact me?",
  ]) assert.equal(isExplicitPresalesCallbackRequest(message), true, message);
  for (const message of [
    "มี line id ไหม", "ขอเบอร์ฝ่ายขาย", "ฝ่ายขายเปิดกี่โมง", "ระบบมีทีมขายไหม", "ติดต่อทางไหน",
    "ไม่ต้องให้ sales ติดต่อกลับ", "ไม่อยากคุยกับคน", "อย่าให้ฝ่ายขายโทรกลับ", "ยกเลิกคำขอคุยกับเซลส์",
    "ฝ่ายขายติดต่อกลับแล้วหรือยัง", "ถ้าขอคุยกับเจ้าหน้าที่ต้องทำยังไง", "มีเบอร์โทรไหม หรือขอคุยเจ้าหน้าที่ได้ที่ไหน?",
    "ตัวอย่าง ให้ sale ติดต่อกลับด้วย", "ลูกค้าบอกว่าให้ sale ติดต่อกลับ", "ให้ฝ่ายขายไม่ต้องติดต่อกลับ",
    'แปลเป็นอังกฤษ "ให้ sale ติดต่อกลับ"', "Sales ติดต่อกลับแล้ว", "Don't have sales contact me",
    "I do not want to speak with a sales representative", "If I want to speak with sales, what happens?",
    "Has sales contacted me?", "How can I speak to sales?", 'He said "Please have Sales contact me"',
    "เคยขอคุยกับเซลส์ไปแล้ว", "ขอให้เซลส์โทรกลับแล้ว ทำไมเงียบ", "ระบบสามารถให้ sale ติดต่อกลับได้ไหม",
  ]) assert.equal(isExplicitPresalesCallbackRequest(message), false, message);
  assert.equal(isPresalesLineContactQuestion("มี line id ไหม"), true);
  assert.equal(isPresalesLineContactQuestion("ให้ sale ติดต่อกลับด้วย"), false);
});

test("customer wording asks for useful context without re-asking LINE identity", () => {
  const reply = composePresalesCallbackReply({ locale: "th", channel: "line", saved: true, reference: "ABC12345" });
  assert.match(reply, /งานด่วนในคิว Sales/);
  assert.match(reply, /ชื่อบริษัท/);
  assert.match(reply, /ประเภทธุรกิจ/);
  assert.match(reply, /เบอร์(?:กับ|และ)ช่วงเวลาที่สะดวก/);
  assert.match(reply, /ไม่ต้องส่ง LINE ID ซ้ำ/);
  assert.doesNotMatch(reply, /ภายใน\s*\d+|รับรอง|แน่นอน/);
  assert.match(composePresalesCallbackReply({ locale: "th", channel: "line", saved: false }), /ยังไม่ถือว่าส่งเข้าคิว Sales/);
});

function serviceHarness(repeated = false, options: {
  existing?: string | null; eligible?: boolean; noStaff?: boolean; owners?: string[];
  inactive?: boolean; failSql?: string; deliveryFails?: boolean;
} = {}) {
  const calls = { sql: [] as Array<{ text: string; params: any[] }>, notifications: [] as any[], realtime: [] as any[], assignments: [] as any[], tenants: [] as string[], released: 0 };
  const conversationId = "12345678-1234-1234-1234-123456789abc";
  const staffId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const client = {
    async query(text: string, params: any[] = []) {
      calls.sql.push({ text, params });
      if (options.failSql && text.includes(options.failSql)) throw new Error("FAKE-write-failure");
      if (text.includes("SELECT customer_id FROM bms_customer_identities")) return { rows: [{ customer_id: "FAKE-customer-id" }] };
      if (text.includes("INSERT INTO bms_conversations")) return { rows: [{ id: conversationId, assigned_to_user_id: options.existing ?? (repeated ? staffId : null), tags: options.inactive ? [] : ["sales-callback"] }] };
      if (text.includes("SELECT EXISTS") && text.includes("presales.callback_request")) return { rows: [{ recent: repeated }] };
      if (text.includes("SELECT u.id") && text.includes("u.id = $2")) return { rows: params[1] && options.eligible !== false ? [{ id: params[1] }] : [] };
      if (text.includes("SELECT u.id")) return { rows: (options.owners ?? []).map(id => ({ id })) };
      if (text.includes("UPDATE bms_conversations")) return { rows: [{ assigned_to_user_id: params[2] }] };
      if (text.includes("INSERT INTO bms_conversation_notes")) return { rows: [{ id: 88 }] };
      return { rows: [], rowCount: 1 };
    },
    release() { calls.released++; },
  };
  const api = loadWithStubs("apps/web/lib/bms/presalesCallback.ts", {
    "@/lib/db": { getClient: async () => client },
    "@/lib/notifications/service": { createNotification: async (input: any) => { calls.notifications.push(input); if (options.deliveryFails) throw new Error("FAKE-notification-outage"); } },
    "./tenant": { beginTenantTx: async (_client: unknown, tenant: string) => { calls.tenants.push(tenant); } },
    "./inbox": {
      pickAutoAssignee: async (...args: any[]) => { calls.assignments.push(args); return options.noStaff ? null : staffId; },
      notifyInboxConversationChanged: (...args: any[]) => { calls.realtime.push(args); if (options.deliveryFails) throw new Error("FAKE-realtime-outage"); },
    },
  });
  return { api, calls, conversationId, staffId };
}

test("callback service commits priority, assignment, note, mention and PII-minimized notification", async () => {
  const h = serviceHarness();
  const raw = "ให้ sale โทรกลับ 0812345678";
  const result = await h.api.recordPresalesCallbackRequest({ tenantId: "FAKE-tenant", channel: "line", customerRef: "FAKE-ref", incoming: raw });
  assert.equal(result.conversationId, h.conversationId);
  assert.equal(result.reference, "12345678");
  assert.equal(result.assignedUserId, h.staffId);
  assert.ok(h.calls.sql.some(call => call.text.includes("'sales-callback' = ANY") === false && call.text.includes("tags || ARRAY")));
  assert.ok(h.calls.sql.some(call => call.text.includes("bms_conversation_note_mentions")));
  assert.ok(h.calls.sql.some(call => call.text.includes("presales.callback_request")));
  assert.equal(h.calls.sql.at(-1)?.text, "COMMIT");
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.realtime.length, 1);
  assert.deepEqual(h.calls.tenants, ["FAKE-tenant"]);
  assert.deepEqual(h.calls.assignments[0][3], ["inbox.view", "inbox.reply"]);
  assert.doesNotMatch(JSON.stringify(h.calls.notifications), /0812345678|FAKE-ref/);
  const audit = h.calls.sql.find(call => call.text.includes("INSERT INTO bms_audit_log"));
  assert.doesNotMatch(JSON.stringify(audit?.params), /0812345678|FAKE-ref/);
});

test("repeat requests within the dedupe window stay urgent without notification spam", async () => {
  const h = serviceHarness(true);
  const result = await h.api.recordPresalesCallbackRequest({ tenantId: "FAKE-tenant", channel: "line", customerRef: "FAKE-ref", incoming: "ให้ Sales ติดต่อกลับ" });
  assert.equal(result.repeated, true);
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.assignments.length, 0, "retain existing owner on repeats");
  assert.match(h.calls.sql.find(call => call.text.includes("SELECT EXISTS"))!.text, /meta->>'repeated' = 'false'/, "suppressed repeats cannot extend the notification window forever");
  assert.equal(h.calls.sql.some(call => call.text.includes("INSERT INTO bms_conversation_notes")), false);
  assert.ok(h.calls.sql.some(call => call.text.includes("tags || ARRAY")));
});

const request = { tenantId: "FAKE-tenant", channel: "line", customerRef: "FAKE-ref", incoming: "ให้ Sales ติดต่อกลับ" };

test("offline administrators receive durable mentions even with no available assignee", async () => {
  const h = serviceHarness(false, { noStaff: true, owners: ["FAKE-owner"] });
  const result = await h.api.recordPresalesCallbackRequest(request);
  assert.equal(result.assignedUserId, null);
  assert.equal(h.calls.notifications[0].user_id, "FAKE-owner");
  assert.ok(h.calls.sql.some(call => call.text.includes("note_mentions") && call.params[3] === "FAKE-owner"));
  assert.match(h.calls.sql.find(call => call.text.includes("INSERT INTO bms_conversations"))!.text, /GREATEST\(bms_conversations.unread, 1\)/);
});

test("assignee and owner notifications are deduplicated; reassignment or completed work notifies again", async () => {
  const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const h = serviceHarness(false, { existing: owner, owners: [owner] });
  await h.api.recordPresalesCallbackRequest(request);
  assert.equal(h.calls.notifications.length, 1);
  for (const options of [{ eligible: false, existing: "FAKE-old" }, { inactive: true }]) {
    const changed = serviceHarness(true, options);
    assert.equal((await changed.api.recordPresalesCallbackRequest(request)).repeated, false);
    assert.equal(changed.calls.notifications.length, 1);
  }
});

test("failed delivery cannot report a committed callback as failed or lose its durable mentions", async () => {
  const h = serviceHarness(false, { owners: ["FAKE-owner"], deliveryFails: true });
  const result = await h.api.recordPresalesCallbackRequest(request);
  assert.equal(result.conversationId, h.conversationId);
  assert.equal(h.calls.notifications.length, 2, "one failed delivery does not skip the other recipient");
  assert.equal(h.calls.sql.filter(call => call.text.includes("INSERT INTO bms_conversation_note_mentions")).length, 2);
  assert.equal(h.calls.sql.at(-1)?.text, "COMMIT");
});

test("audit or mention failure rolls back with no notifications; invalid context never opens a transaction", async () => {
  for (const failSql of ["INSERT INTO bms_audit_log", "INSERT INTO bms_conversation_note_mentions"]) {
    const h = serviceHarness(false, { failSql });
    await assert.rejects(h.api.recordPresalesCallbackRequest(request), /FAKE-write-failure/);
    assert.equal(h.calls.sql.at(-1)?.text, "ROLLBACK");
    assert.equal(h.calls.released, 1);
    assert.equal(h.calls.notifications.length, 0);
    assert.equal(h.calls.realtime.length, 0);
  }
  for (const override of [{ customerRef: null }, { customerRef: " " }, { channel: "test" }, { channel: "web" }, { incoming: " " }]) {
    const h = serviceHarness();
    await assert.rejects(h.api.recordPresalesCallbackRequest({ ...request, ...override }), /PERSISTED_CUSTOMER_CONTEXT_REQUIRED/);
    assert.equal(h.calls.tenants.length, 0);
  }
});

test("Inbox source keeps active callback chats above ordinary recency and labels them urgent", () => {
  const inbox = readFileSync(new URL("../../apps/web/lib/bms/inbox.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../apps/web/app/(admin)/admin/inbox/page.tsx", import.meta.url), "utf8");
  assert.match(inbox, /'sales-callback' = ANY\(c\.tags\)\) DESC/);
  assert.match(page, /priority_sales_callback/);
  assert.match(page, /includes\("sales-callback"\)/);
  assert.match(inbox, /array_remove\(tags, 'sales-callback'\)/);
});

test("closing callback work uses a tenant transaction and publishes only after commit", async () => {
  for (const failWrite of [false, true]) {
    const calls: string[] = [];
    const client = {
      async query(sql: string, params: any[] = []) {
        calls.push(sql);
        if (sql.includes("UPDATE bms_conversations")) {
          assert.deepEqual(params, ["FAKE-tenant", "FAKE-conversation", "CLOSED"]);
          assert.match(sql, /CASE WHEN \$3 = 'CLOSED' THEN array_remove\(tags, 'sales-callback'\) ELSE tags END/);
          if (failWrite) throw new Error("FAKE-status-failure");
        }
        return { rows: [], rowCount: 1 };
      },
      release() { calls.push("RELEASE"); },
    };
    const api = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { getClient: async () => client },
      "@/lib/pubsub": { pubsub: { publish: async () => { calls.push("PUBLISH"); } } },
      "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
      "./channels": {}, "./channelHealth": {}, "@/lib/notifications/service": {},
      "./coupons": {}, "./aiQuality": {}, "./customers": {}, "./failureAlert": {},
      "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
      "./tenant": { beginTenantTx: async (_client: unknown, tenant: string) => {
        assert.equal(tenant, "FAKE-tenant"); calls.push("BEGIN_TENANT");
      } },
    });
    if (failWrite) {
      await assert.rejects(api.setConversationStatus("FAKE-tenant", "FAKE-conversation", "CLOSED"), /FAKE-status-failure/);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "RELEASE"]);
      assert.ok(!calls.includes("PUBLISH"));
    } else {
      assert.equal(await api.setConversationStatus("FAKE-tenant", "FAKE-conversation", "CLOSED"), true);
      assert.deepEqual(calls.slice(-3), ["COMMIT", "RELEASE", "PUBLISH"]);
    }
  }
});
