import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

class FakeGraphQLError extends Error {
  extensions: unknown;
  constructor(message: string, options: { extensions?: unknown } = {}) {
    super(message);
    this.extensions = options.extensions;
  }
}

function graphqlHarness(allowed: boolean, role = "Sales") {
  const calls: string[] = [];
  const assignmentScopes: Array<string | undefined> = [];
  const helperScopes: Array<string | undefined> = [];
  const stateScopes: Array<string | undefined> = [];
  const readScopes: Array<string | undefined> = [];
  const inbox = {
    canAccessInboxConversation: async () => allowed,
    canAccessInboxMessage: async () => allowed,
    getConversation: async (_tenant: string, _id: string, restrictedUserId?: string) => {
      readScopes.push(restrictedUserId);
      return { id: "chat-1", assigned_to_user_id: "other-user" };
    },
    getTimeline: async (_tenant: string, _id: string, _limit: number,
      restrictedUserId?: string) => { readScopes.push(restrictedUserId); calls.push("timeline"); return []; },
    listMessages: async (_tenant: string, _id: string, _limit: number,
      restrictedUserId?: string) => { readScopes.push(restrictedUserId); return []; },
    listNotes: async (_tenant: string, _id: string, _limit: number,
      restrictedUserId?: string) => { readScopes.push(restrictedUserId); return []; },
    listConversationHelpers: async (_tenant: string, _id: string,
      restrictedUserId?: string) => { readScopes.push(restrictedUserId); return []; },
    listSystemEvents: async (_tenant: string, _id: string, _limit: number,
      restrictedUserId?: string) => { readScopes.push(restrictedUserId); return []; },
    sendStaffMessage: async () => { calls.push("send"); return { status: "SENT", delivered: true }; },
    retryMessage: async () => { calls.push("retry"); return { status: "SENT", delivered: true }; },
    assignConversation: async (_tenant: string, _id: string, _user: string,
      options: { restrictedUserId?: string }) => {
      assignmentScopes.push(options.restrictedUserId); calls.push("assign"); return true;
    },
    addConversationHelper: async (_tenant: string, _id: string, _user: string, _actor: string,
      options: { restrictedUserId?: string }) => {
      helperScopes.push(options.restrictedUserId); calls.push("helper-add"); return true;
    },
    removeConversationHelper: async (_tenant: string, _id: string, _user: string, _actor: string,
      options: { restrictedUserId?: string }) => {
      helperScopes.push(options.restrictedUserId); calls.push("helper-remove"); return true;
    },
    setConversationStatus: async (_tenant: string, _id: string, _status: string,
      options: { restrictedUserId?: string }) => {
      stateScopes.push(options.restrictedUserId); calls.push("status"); return true;
    },
    setConversationTags: async (_tenant: string, _id: string, _tags: string[],
      options: { restrictedUserId?: string }) => {
      stateScopes.push(options.restrictedUserId); calls.push("tags"); return true;
    },
    markRead: async (_tenant: string, _id: string, options: { restrictedUserId?: string }) => {
      stateScopes.push(options.restrictedUserId); calls.push("read"); return true;
    },
    addNote: async (_tenant: string, _id: string, _actor: string, _body: string, _mentions: string[],
      options: { restrictedUserId?: string }) => {
      stateScopes.push(options.restrictedUserId); calls.push("note"); return { id: "FAKE-note" };
    },
  };
  const loaded = loadWithStubs("apps/web/graphql/bmsInbox.ts", {
    "@/lib/bms/inbox": inbox,
    "@/lib/bms/permissions": { requirePermission: async () => {} },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-1" },
    "@/lib/bms/audit": { audit: async () => {} },
    "@/lib/auth": { requireAuth: () => ({ scope: "admin" }) },
    "@/lib/bms/platform": { isPlatformAdmin: async () => false },
    "graphql/error": { GraphQLError: FakeGraphQLError },
  });
  return { resolvers: loaded.bmsInboxResolvers, calls, assignmentScopes, helperScopes, stateScopes, readScopes,
    ctx: { admin: { id: "sales-1", role } } };
}

test("Sales cannot read another conversation timeline or send, retry, assign or clear its unread state", async () => {
  const h = graphqlHarness(false);
  const q = h.resolvers.Query;
  const m = h.resolvers.Mutation;
  const operations = [
    () => q.bmsConversation(null, { id: "chat-1" }, h.ctx),
    () => q.bmsConversationTimeline(null, { id: "chat-1" }, h.ctx),
    () => m.bmsSendMessage(null, { id: "chat-1", body: "hello" }, h.ctx),
    () => m.bmsRetryMessage(null, { id: "message-1" }, h.ctx),
    () => m.bmsAssignConversation(null, { id: "chat-1", userId: "sales-2" }, h.ctx),
    () => m.bmsMarkConversationRead(null, { id: "chat-1" }, h.ctx),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, (error: any) => error.extensions?.code === "FORBIDDEN");
  }
  assert.deepEqual(h.calls, []);
});

test("an assigned Sales helper and a Manager retain the existing conversation actions", async () => {
  for (const [allowed, role] of [[true, "Sales"], [false, "Manager"]] as const) {
    const h = graphqlHarness(allowed, role);
    await h.resolvers.Query.bmsConversationTimeline(null, { id: "chat-1" }, h.ctx);
    await h.resolvers.Mutation.bmsSendMessage(null, { id: "chat-1", body: "hello" }, h.ctx);
    assert.deepEqual(h.calls, ["timeline", "send"]);
  }
});

test("GraphQL passes current Sales scope to every conversation and nested read", async () => {
  for (const role of ["Sales", "Manager"]) {
    const h = graphqlHarness(true, role);
    const parent = await h.resolvers.Query.bmsConversation(null, { id: "chat-1" }, h.ctx);
    await h.resolvers.Query.bmsConversationTimeline(null, { id: "chat-1" }, h.ctx);
    await h.resolvers.BmsConversation.messages(parent, { limit: 5 }, h.ctx);
    await h.resolvers.BmsConversation.notes(parent, { limit: 5 }, h.ctx);
    await h.resolvers.BmsConversation.helpers(parent, {}, h.ctx);
    await h.resolvers.BmsConversation.systemEvents(parent, { limit: 5 }, h.ctx);
    assert.deepEqual(h.readScopes, Array(6).fill(role === "Sales" ? "sales-1" : undefined));
  }
});

test("GraphQL passes Sales scope into Inbox mutation transactions", async () => {
  for (const role of ["Sales", "Manager"]) {
    const h = graphqlHarness(true, role);
    await h.resolvers.Mutation.bmsAssignConversation(null, { id: "chat-1", userId: "sales-2" }, h.ctx);
    await h.resolvers.Mutation.bmsAddConversationHelper(null, { id: "chat-1", userId: "sales-2" }, h.ctx);
    await h.resolvers.Mutation.bmsRemoveConversationHelper(null, { id: "chat-1", userId: "sales-2" }, h.ctx);
    await h.resolvers.Mutation.bmsSetConversationStatus(null, { id: "chat-1", status: "CLOSED" }, h.ctx);
    await h.resolvers.Mutation.bmsSetConversationTags(null, { id: "chat-1", tags: ["VIP"] }, h.ctx);
    await h.resolvers.Mutation.bmsMarkConversationRead(null, { id: "chat-1" }, h.ctx);
    await h.resolvers.Mutation.bmsAddConversationNote(null, { id: "chat-1", body: "hello",
      mentionedUserIds: [] }, h.ctx);
    assert.deepEqual(h.assignmentScopes, [role === "Sales" ? "sales-1" : undefined]);
    assert.deepEqual(h.helperScopes, [role === "Sales" ? "sales-1" : undefined,
      role === "Sales" ? "sales-1" : undefined]);
    assert.deepEqual(h.stateScopes, Array(4).fill(role === "Sales" ? "sales-1" : undefined));
  }
});

test("REST reply applies the same Sales conversation scope before delivery", async () => {
  for (const allowed of [false, true]) {
    let sends = 0;
    const route = loadWithStubs("apps/web/app/api/bms/inbox/[id]/reply/route.ts", {
      "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
      "@/lib/bms/inbox": {
        canAccessInboxConversation: async () => allowed,
        sendStaffMessage: async () => { sends++; return { status: "SENT", delivered: true }; },
      },
      "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant-1", adminId: "sales-1", admin: { role: "Sales" } }) },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    });
    const result = await route.POST({ json: async () => ({ body: "hello" }) }, { params: { id: "chat-1" } });
    assert.equal(result.status, allowed ? 200 : 403);
    assert.equal(sends, allowed ? 1 : 0);
  }
});

test("REST Inbox list ignores a Sales caller's requested assignee and keeps Manager filtering", async () => {
  for (const role of ["Sales", "Manager"]) {
    let assignedTo: string | null = null;
    const route = loadWithStubs("apps/web/app/api/bms/inbox/route.ts", {
      "next/server": { NextResponse: { json: (body: unknown) => body } },
      "@/lib/bms/inbox": { listConversations: async (_tenantId: string, filters: { assignedTo: string | null }) => {
        assignedTo = filters.assignedTo;
        return [];
      } },
      "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant-1", adminId: "sales-1", admin: { role } }) },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    });
    await route.GET({ url: "https://example.invalid/api/bms/inbox?assignedTo=other-user" });
    assert.equal(assignedTo, role === "Sales" ? "sales-1" : "other-user");
  }
});
