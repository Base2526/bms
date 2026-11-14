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
  addNote, listNotes, sendStaffMessage, retryMessage, getTimeline,
  listAssignableStaff, addConversationHelper, removeConversationHelper,
  listConversationHelpers, setUserAvailability, listSystemEvents, countUnreadConversations,
  isImageMime, channelSupportsPush, outboundStatus, createDiagnosticInboxMessage, listDiagnosticInboxLatest,
  countUnreadMentions, listMyMentions, markMentionRead, markAllMentionsRead,
  canAccessInboxConversation, canAccessInboxMessage,
  type ConvStatus, type Attachment,
} from "@/lib/bms/inbox";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { requireAuth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/bms/platform";
import { GraphQLError } from "graphql/error";

const staffRef = (r: any) => r && ({
  id: r.id, name: r.name ?? null, email: r.email ?? null, avatar: r.avatar ?? null,
  role: r.role ?? null, isAvailable: r.is_available ?? null, openCount: r.open_count ?? null,
});

const toISO = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const actorOf = (ctx: any) => ctx?.admin?.email || ctx?.admin?.id || "admin";
// Sales เห็นเฉพาะแชทของตัวเอง (หลัก/ช่วยตอบ) — role อื่น (Administrator/Manager/Warehouse) เห็นทั้งร้าน
const isRestrictedToOwn = (ctx: any) => ctx?.admin?.role === "Sales";
const readScope = (ctx: any) => isRestrictedToOwn(ctx) ? String(ctx.admin.id) : undefined;
const DIAGNOSTIC_CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"];

async function requireConversationAccess(ctx: any, conversationId: string) {
  if (!isRestrictedToOwn(ctx)) return;
  if (!await canAccessInboxConversation(getTenantId(ctx), conversationId, String(ctx.admin.id))) {
    throw new GraphQLError("ไม่มีสิทธิ์เข้าถึงแชทนี้", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

async function requireMessageAccess(ctx: any, messageId: string) {
  if (!isRestrictedToOwn(ctx)) return;
  if (!await canAccessInboxMessage(getTenantId(ctx), messageId, String(ctx.admin.id))) {
    throw new GraphQLError("ไม่มีสิทธิ์เข้าถึงข้อความนี้", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

async function requireDiagnosticsAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
  if (ctx?.admin?.role === "Administrator" || await isPlatformAdmin(ctx)) return auth;
  throw new GraphQLError("เฉพาะ Administrator เท่านั้น", {
    extensions: { code: "FORBIDDEN", http: { status: 403 } },
  });
}

export const bmsInboxResolvers = {
  Query: {
    async bmsConversations(
      _p: unknown,
      args: { status?: string; assignedTo?: string; tag?: string; search?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "inbox.view");
      // Sales บังคับเห็นแค่ของตัวเองเสมอ (server-side, ไม่สนใจค่า assignedTo ที่ client ส่งมา)
      const assignedTo = isRestrictedToOwn(ctx) ? String(ctx.admin.id) : (args.assignedTo ?? null);
      return listConversations(getTenantId(ctx), {
        status: args.status ?? null, assignedTo,
        tag: args.tag ?? null, search: args.search ?? null,
        limit: args.limit ?? 50, offset: args.offset ?? 0,
      });
    },

    async bmsConversation(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      const conv = await getConversation(getTenantId(ctx), args.id, readScope(ctx));
      if (conv) await requireConversationAccess(ctx, args.id);
      return conv;
    },

    async bmsConversationTimeline(_p: unknown, args: { id: string; limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      await requireConversationAccess(ctx, args.id);
      return getTimeline(getTenantId(ctx), args.id, args.limit ?? undefined, readScope(ctx));
    },

    async bmsAssignableStaff(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      const rows = await listAssignableStaff(getTenantId(ctx));
      return rows.map(staffRef);
    },

    async bmsInboxUnreadCount(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      const assignedTo = isRestrictedToOwn(ctx) ? String(ctx.admin.id) : null;
      return countUnreadConversations(getTenantId(ctx), assignedTo);
    },

    async bmsInboxDiagnosticLatest(_p: unknown, _a: unknown, ctx: any) {
      await requireDiagnosticsAdmin(ctx);
      return listDiagnosticInboxLatest(getTenantId(ctx));
    },

    async bmsMyMentionsUnreadCount(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return countUnreadMentions(getTenantId(ctx), String(ctx.admin.id));
    },

    async bmsMyMentions(_p: unknown, args: { unreadOnly?: boolean; limit?: number }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      const rows = await listMyMentions(getTenantId(ctx), String(ctx.admin.id), {
        unreadOnly: args.unreadOnly ?? false, limit: args.limit ?? undefined,
      });
      return rows.map((r: any) => ({
        id: String(r.id), conversationId: r.conversation_id, channel: r.channel,
        customerName: r.customer_name ?? null, author: r.author ?? null, body: r.body,
        createdAt: toISO(r.created_at), readAt: toISO(r.read_at),
      }));
    },
  },

  Mutation: {
    async bmsSendMessage(_p: unknown, args: { id: string; body?: string; attachment?: Attachment }, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      await requireConversationAccess(ctx, args.id);
      const res = await sendStaffMessage(getTenantId(ctx), args.id, args.body ?? "", actorOf(ctx), args.attachment ?? null,
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
      if (res.status === "SENT") {
        return {
          status: "SENT",
          delivered: res.delivered,
          message: res.partial ? "ส่งได้บางส่วน กรุณาตรวจในช่องทางก่อนดำเนินการต่อ" :
            res.uncertain ? "ผลการส่งไม่แน่ชัด กรุณาตรวจในช่องทางก่อนตอบใหม่" :
            res.delivered ? "ส่งข้อความแล้ว" : "บันทึกข้อความแล้ว (ยังไม่ได้ส่งออกช่องทาง)",
        };
      }
      const msg: Record<string, string> = { NOT_FOUND: "ไม่พบบทสนทนา", EMPTY: "ข้อความว่าง" };
      return { status: res.status, delivered: false, message: msg[res.status] ?? "ส่งไม่ได้" };
    },

    async bmsRetryMessage(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      await requireMessageAccess(ctx, args.id);
      const res = await retryMessage(getTenantId(ctx), args.id, actorOf(ctx),
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
      if (res.status === "SENT") {
        return {
          status: "SENT", delivered: res.delivered,
          message: res.partial ? "ส่งซ้ำได้บางส่วน กรุณาตรวจในช่องทางก่อนดำเนินการต่อ" :
            res.uncertain ? "ผลการส่งซ้ำไม่แน่ชัด กรุณาตรวจในช่องทางก่อนตอบใหม่" :
            res.delivered ? "ส่งซ้ำสำเร็จ" : "ส่งไม่สำเร็จ ตรวจสถานะข้อความก่อนลองอีกครั้ง",
        };
      }
      return { status: res.status, delivered: false, message: res.status === "NOT_FOUND"
        ? "ไม่พบข้อความ" : "ส่งซ้ำได้เฉพาะข้อความที่ส่งไม่สำเร็จ" };
    },

    async bmsCreateInboxDiagnosticMessage(_p: unknown, args: { channel: string; body?: string | null }, ctx: any) {
      const auth = await requireDiagnosticsAdmin(ctx);
      if (!DIAGNOSTIC_CHANNELS.includes(args.channel)) {
        throw new GraphQLError("channel ไม่ถูกต้อง", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const body = (args.body || "").trim();
      if (body.length > 1000) {
        throw new GraphQLError("ข้อความทดสอบยาวเกินไป", { extensions: { code: "BAD_USER_INPUT" } });
      }

      const result = await createDiagnosticInboxMessage(
        getTenantId(ctx),
        args.channel,
        String(auth.author_id),
        body || null
      );

      return {
        ok: true,
        message: "สร้างข้อความทดสอบใน Inbox แล้ว",
        ...result,
      };
    },

    async bmsAssignConversation(_p: unknown, args: { id: string; userId: string }, ctx: any) {
      // แยกจาก inbox.manage — Sales ต้องโอนแชทของตัวเองให้เพื่อนได้ โดยไม่ต้องได้สิทธิ์แก้ status/tags/notes เต็ม
      await requirePermission(ctx, "inbox.assign");
      await requireConversationAccess(ctx, args.id);
      return assignConversation(getTenantId(ctx), args.id, args.userId, {
        actor: actorOf(ctx),
        ...(isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {}),
      });
    },

    async bmsAddConversationHelper(_p: unknown, args: { id: string; userId: string }, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      await requireConversationAccess(ctx, args.id);
      return addConversationHelper(getTenantId(ctx), args.id, args.userId, actorOf(ctx),
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
    },

    async bmsRemoveConversationHelper(_p: unknown, args: { id: string; userId: string }, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      await requireConversationAccess(ctx, args.id);
      return removeConversationHelper(getTenantId(ctx), args.id, args.userId, actorOf(ctx),
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
    },

    async bmsSetMyAvailability(_p: unknown, args: { available: boolean }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      const auth = requireAuth(ctx);
      return setUserAvailability(getTenantId(ctx), String(auth.author_id), args.available);
    },

    async bmsSetConversationStatus(_p: unknown, args: { id: string; status: ConvStatus }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      await requireConversationAccess(ctx, args.id);
      return setConversationStatus(getTenantId(ctx), args.id, args.status, {
        actor: actorOf(ctx),
        ...(isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {}),
      });
    },

    async bmsSetConversationTags(_p: unknown, args: { id: string; tags: string[] }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      await requireConversationAccess(ctx, args.id);
      return setConversationTags(getTenantId(ctx), args.id, args.tags ?? [], {
        actor: actorOf(ctx),
        ...(isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {}),
      });
    },

    async bmsMarkConversationRead(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      await requireConversationAccess(ctx, args.id);
      return markRead(getTenantId(ctx), args.id,
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
    },

    async bmsAddConversationNote(_p: unknown, args: { id: string; body: string; mentionedUserIds?: string[] }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      await requireConversationAccess(ctx, args.id);
      return addNote(getTenantId(ctx), args.id, actorOf(ctx), args.body, args.mentionedUserIds,
        isRestrictedToOwn(ctx) ? { restrictedUserId: String(ctx.admin.id) } : {});
    },

    async bmsMarkMentionRead(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return markMentionRead(getTenantId(ctx), String(ctx.admin.id), args.id);
    },

    async bmsMarkAllMentionsRead(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      await markAllMentionsRead(getTenantId(ctx), String(ctx.admin.id));
      return true;
    },
  },

  // field resolvers
  BmsConversation: {
    customerRef: (p: any) => p.customer_ref ?? null,
    customerId: (p: any) => p.customer_id ?? null,
    customerName: (p: any) => p.customer_name ?? null,
    customerAvatar: (p: any) => p.customer_avatar ?? null,
    sourceDisplayName: (p: any) => p.source_display_name ?? null,
    sourceHandle: (p: any) => p.source_handle ?? null,
    sourceAvatar: (p: any) => p.source_avatar ?? null,
    assignedStaff: (p: any) => (p.assigned_to_user_id
      ? { id: p.assigned_to_user_id, name: p.assigned_name ?? null, avatar: p.assigned_avatar ?? null, email: p.assigned_email ?? null }
      : null),
    async helpers(p: any, _a: unknown, ctx: any) {
      const rows = await listConversationHelpers(getTenantId(ctx), p.id, readScope(ctx));
      return rows.map(staffRef);
    },
    async systemEvents(p: any, args: { limit?: number | null }, ctx: any) {
      return listSystemEvents(getTenantId(ctx), p.id, args.limit ?? undefined, readScope(ctx));
    },
    lastMessage: (p: any) => p.last_message ?? null,
    lastMessageAt: (p: any) => toISO(p.last_message_at),
    createdAt: (p: any) => toISO(p.created_at),
    updatedAt: (p: any) => toISO(p.updated_at),
    async messages(p: any, args: { limit?: number | null }, ctx: any) {
      const rows = await listMessages(getTenantId(ctx), p.id, args.limit ?? 80, readScope(ctx));
      const channel = p.channel;
      return rows.map((m: any) => {
        const att = m.meta?.attachment;
        // Staff history uses the session-protected route even after an external
        // provider's 30-day media capability expires.
        const privateMedia = typeof att?.url === "string"
          ? /^\/api\/bms\/inbox\/media\/([1-9][0-9]*)\?token=/.exec(att.url)
          : null;
        // status เฉพาะ OUT · msg เก่า (ไม่มี meta.status) → derive จาก delivered
        const status = m.direction === "OUT"
          ? (m.meta?.status ?? (typeof m.meta?.delivered === "boolean" ? outboundStatus(channel, m.meta.delivered) : null))
          : null;
        return {
          id: String(m.id), direction: m.direction, body: m.body,
          sender: m.sender ?? null, createdAt: toISO(m.created_at),
          attachment: att?.url
            ? { url: privateMedia ? `/api/files/${privateMedia[1]}` : att.url,
                name: att.name ?? null, mimeType: att.mimeType ?? null, isImage: isImageMime(att.mimeType) }
            : null,
          status,
          canReportDelivery: channelSupportsPush(channel),
        };
      });
    },
    async notes(p: any, args: { limit?: number | null }, ctx: any) {
      const rows = await listNotes(getTenantId(ctx), p.id, args.limit ?? undefined, readScope(ctx));
      return rows.map((n: any) => ({
        id: String(n.id), author: n.author ?? null, body: n.body, createdAt: toISO(n.created_at),
        mentionedUserIds: (n.mentioned_user_ids || []).map(String),
      }));
    },
  },

  BmsConversationNote: {
    createdAt: (p: any) => toISO(p.createdAt ?? p.created_at),
    mentionedUserIds: (p: any) => (p.mentionedUserIds || []).map(String),
  },
};
