// =============================================================
// GraphQL resolvers — BMS Omnichannel Inbox (admin panel)
// -------------------------------------------------------------
// อ่านกล่องข้อความรวมทุกช่องทาง + ตอบเอง + assign/tags/notes/timeline
// ใช้ service เดียวกับ webhook/REST (lib/bms/inbox) — ตรรกะไม่ซ้ำ
// permission: inbox.view (อ่าน) / inbox.reply (ตอบ) / inbox.manage (จัดการ)
// =============================================================

import {
  listConversations, getConversation, listMessages,
  assignConversation, setConversationStatus, setConversationTags, markRead,
  addNote, listNotes, sendStaffMessage, getTimeline,
  type ConvStatus,
} from "@/lib/bms/inbox";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

const toISO = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const actorOf = (ctx: any) => ctx?.admin?.email || ctx?.admin?.id || "admin";

export const bmsInboxResolvers = {
  Query: {
    async bmsConversations(
      _p: unknown,
      args: { status?: string; assignedTo?: string; tag?: string; search?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "inbox.view");
      return listConversations(getTenantId(ctx), {
        status: args.status ?? null, assignedTo: args.assignedTo ?? null,
        tag: args.tag ?? null, search: args.search ?? null,
        limit: args.limit ?? 50, offset: args.offset ?? 0,
      });
    },

    async bmsConversation(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return getConversation(getTenantId(ctx), args.id);
    },

    async bmsConversationTimeline(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return getTimeline(getTenantId(ctx), args.id);
    },
  },

  Mutation: {
    async bmsSendMessage(_p: unknown, args: { id: string; body: string }, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      const res = await sendStaffMessage(getTenantId(ctx), args.id, args.body, actorOf(ctx));
      if (res.status === "SENT") {
        await audit(ctx, "inbox.reply", args.id, { delivered: res.delivered });
        return {
          status: "SENT",
          delivered: res.delivered,
          message: res.delivered ? "ส่งข้อความแล้ว" : "บันทึกข้อความแล้ว (ยังไม่ได้ส่งออกช่องทาง)",
        };
      }
      const msg: Record<string, string> = { NOT_FOUND: "ไม่พบบทสนทนา", EMPTY: "ข้อความว่าง" };
      return { status: res.status, delivered: false, message: msg[res.status] ?? "ส่งไม่ได้" };
    },

    async bmsAssignConversation(_p: unknown, args: { id: string; assignedTo?: string }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      const ok = await assignConversation(getTenantId(ctx), args.id, args.assignedTo ?? null);
      if (ok) await audit(ctx, "inbox.assign", args.id, { assignedTo: args.assignedTo });
      return ok;
    },

    async bmsSetConversationStatus(_p: unknown, args: { id: string; status: ConvStatus }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      const ok = await setConversationStatus(getTenantId(ctx), args.id, args.status);
      if (ok) await audit(ctx, "inbox.status", args.id, { status: args.status });
      return ok;
    },

    async bmsSetConversationTags(_p: unknown, args: { id: string; tags: string[] }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      const ok = await setConversationTags(getTenantId(ctx), args.id, args.tags ?? []);
      if (ok) await audit(ctx, "inbox.tags", args.id);
      return ok;
    },

    async bmsMarkConversationRead(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return markRead(getTenantId(ctx), args.id);
    },

    async bmsAddConversationNote(_p: unknown, args: { id: string; body: string }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      const note = await addNote(getTenantId(ctx), args.id, actorOf(ctx), args.body);
      if (note) await audit(ctx, "inbox.note", args.id);
      return note;
    },
  },

  // field resolvers
  BmsConversation: {
    customerRef: (p: any) => p.customer_ref ?? null,
    customerId: (p: any) => p.customer_id ?? null,
    customerName: (p: any) => p.customer_name ?? null,
    assignedTo: (p: any) => p.assigned_to ?? null,
    lastMessage: (p: any) => p.last_message ?? null,
    lastMessageAt: (p: any) => toISO(p.last_message_at),
    createdAt: (p: any) => toISO(p.created_at),
    updatedAt: (p: any) => toISO(p.updated_at),
    async messages(p: any, _a: unknown, ctx: any) {
      const rows = await listMessages(getTenantId(ctx), p.id);
      return rows.map((m: any) => ({
        id: String(m.id), direction: m.direction, body: m.body,
        sender: m.sender ?? null, createdAt: toISO(m.created_at),
      }));
    },
    async notes(p: any, _a: unknown, ctx: any) {
      const rows = await listNotes(getTenantId(ctx), p.id);
      return rows.map((n: any) => ({
        id: String(n.id), author: n.author ?? null, body: n.body, createdAt: toISO(n.created_at),
      }));
    },
  },

  BmsConversationNote: {
    createdAt: (p: any) => toISO(p.createdAt ?? p.created_at),
  },
};
