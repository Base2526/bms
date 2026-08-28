// =============================================================
// GraphQL resolver — BMS AI Assistant (staff surface)
// -------------------------------------------------------------
// ผู้ช่วย AI สำหรับแอดมิน: Claude tool-calling ผ่าน staffTools(perms)
// - อ่าน/เขียน non-sensitive (A1/A2) → execute + audit ในตัวทูล
// - sensitive (A3) → คืน proposal (ไม่ execute) ให้ UI กด Confirm ยิง mutation เดิม
// RBAC: ทูลที่ role ไม่มีสิทธิ์จะไม่ถูกเสนอให้ AI เลย (กรองที่ staffTools)
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { audit } from "@/lib/bms/audit";
import { loadPermissions, requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { runToolLoop } from "@/lib/bms/tools/runtime";
import { staffTools } from "@/lib/bms/tools/catalog";
import {
  runPharmacyTestHarness,
  type PharmacyTestPhase,
  type PharmacyTestSession,
} from "@/lib/bms/pharmacy/testHarness";
import { createPharmacyLabOrder } from "@/lib/bms/pharmacy/labCheckout";
import { clarifyAmbiguousStaffRequest } from "@/lib/bms/staffAssistantClarification";
import { searchAssistantKnowledge, type AssistantLocale } from "@/lib/bms/assistantKnowledge";
import { isPlatformAdmin } from "@/lib/bms/platform";

const STAFF_SYSTEM = [
  "คุณเป็นผู้ช่วย AI สำหรับแอดมินร้านค้า ตอบตามภาษาที่ผู้ใช้ถาม (ไทยหรืออังกฤษ) อย่างกระชับ ชัดเจน; ถ้าภาษากำกวมให้ใช้ภาษาไทย",
  "ใช้ 'ทูล' ที่ให้มาเพื่อดึงข้อมูลจริงและดำเนินการหลังบ้าน ห้ามเดา/แต่งตัวเลขเอง — อ้างอิงตัวเลขจากผลของทูลเท่านั้น",
  "งานที่กระทบเงิน/สต็อก/ลบข้อมูล (ยืนยันเงิน/ปฏิเสธ/คืนเงิน/ยกเลิกออร์เดอร์-PO-การจัดส่ง/ปรับสต็อก/ผสานลูกค้า)",
  "จะเป็น 'คำขอ' ที่ต้องให้แอดมินกดยืนยันเองในหน้าจอ — เมื่อเรียกทูลกลุ่มนี้ ให้แจ้งว่าเตรียมคำขอไว้แล้ว รอกดยืนยัน อย่าบอกว่าทำเสร็จ",
  "ถ้าทูลคืน error หรือไม่พบข้อมูล ให้บอกตามจริงและเสนอขั้นตอนถัดไป",
  "ถ้าคำขอกำกวมจนขอบเขตข้อมูล ช่วงเวลา เป้าหมาย หรือการกระทำอาจเปลี่ยน ห้ามเดาหรือเลือกค่า default ให้ถามยืนยันสั้น ๆ ก่อนเรียกทูล โดยเฉพาะคำว่า 'ทั้งหมด' ต้องแยกทุกช่วงเวลาออกจากทุกรายการ และ 'รายการขาย' ต้องแยกสินค้าออกจากออร์เดอร์",
  "เมื่อผู้ใช้ยืนยันว่าต้องการยอดขายหรือสินค้าขายดีตั้งแต่เริ่มขาย/เปิดร้าน/ทุกช่วงเวลา ให้เรียกทูลด้วย scope='all_time' และไม่ส่ง from/to",
  "เมื่อผู้ใช้ถามว่าระบบทำอะไรได้ ให้เรียก search_system_capabilities และแยกสถานะระบบออกจากการตั้งค่าจริงของร้านเสมอ",
  "เมื่อผู้ใช้ถามวิธีใช้หน้า เมนู หรือ workflow ให้เรียก search_system_guides และตอบเฉพาะขั้นตอนที่ทูลยืนยันได้ พร้อมบอก route และสิทธิ์ที่ขาดถ้ามี",
  "คำว่า 'คน' หรือชื่อบุคคลอาจหมายถึงพนักงานหรือลูกค้า ถ้าบริบทไม่ชัดให้ถามแยกก่อน ห้ามค้นทั้งสองกลุ่มหรือเปิดเผยว่าบัญชีมีอยู่หรือไม่โดยไม่มีสิทธิ์",
  "แยกเสมอว่า BMS รองรับสะสมแต้ม ร้านนี้เปิดโปรแกรมหรือยัง และลูกค้าคนหนึ่งมีแต้มเท่าไร: ใช้ capability, get_loyalty_program_status และ get_loyalty_points ตามลำดับ ห้ามแทนกัน",
  "คำถามคูปองต้องแยกคูปองที่ร้านเปิดอยู่จากคูปองที่ลูกค้าคนหนึ่งมีสิทธิ์ใช้จริง; ถ้ายังไม่ระบุลูกค้าหรือยอดตะกร้า ให้บอกข้อจำกัดหรือถามให้ชัดก่อน",
].join("\n");

type Turn = { role?: string; text?: string };

type WorkAssistantInput = {
  message?: string;
  history?: Turn[];
  currentPath?: string | null;
  pageId?: string | null;
  /**
   * UI language for retrieved knowledge. `ctx.admin.language` cannot be used: it is deliberately
   * not signed into the session JWT (see lib/auth/token.ts) and is only rehydrated by
   * /api/auth/me, so it is always undefined here and every actor would be answered in Thai.
   * This is a presentation preference, not an authorization input.
   */
  locale?: string | null;
};

function safeCurrentPath(value?: string | null): string | null {
  const path = String(value ?? "").trim();
  if (!path || path.length > 240 || !/^\/admin(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(path)) return null;
  return path;
}

function safeLocale(value?: string | null): AssistantLocale {
  return String(value ?? "").trim().toLowerCase() === "en" ? "en" : "th";
}

function safeContextId(value?: string | null): string | null {
  const id = String(value ?? "").trim();
  return id && id.length <= 80 && /^[a-z0-9][a-z0-9._-]*$/i.test(id) ? id : null;
}

function deterministicKnowledgeReply(
  knowledge: ReturnType<typeof searchAssistantKnowledge>,
  locale: AssistantLocale,
  matchedQuery: boolean
): string | null {
  if (!knowledge.length) return null;
  const visible = knowledge.filter((entry) => entry.accessible).slice(0, 3);
  const selected = visible.length ? visible : knowledge.slice(0, 3);
  // Page-context entries are labelled as page guidance, never as an answer to the question.
  const heading = matchedQuery
    ? locale === "en"
      ? "Verified system guidance is available even though the AI provider is unavailable:"
      : "ยังใช้ข้อมูลระบบที่ยืนยันแล้วตอบได้ แม้ AI provider จะยังไม่พร้อม:"
    : locale === "en"
      ? "No verified entry matched that question. These guides cover the page you are on:"
      : "ยังไม่พบข้อมูลที่ยืนยันได้ตรงกับคำถามนี้ — คู่มือด้านล่างคือของหน้าที่คุณเปิดอยู่:";
  const lines = selected.map((entry) => {
    const status = entry.capabilityStatus ? ` [${entry.capabilityStatus}]` : "";
    const access = entry.accessible
      ? ""
      : locale === "en" ? " (your account cannot open this page)" : " (บัญชีนี้เปิดหน้านี้ไม่ได้)";
    return `- ${entry.title}${status}: ${entry.summary}${access}`;
  });
  const ending = locale === "en"
    ? "Live shop data and actions still require an available AI provider and the relevant backend tool."
    : "การตรวจข้อมูลร้าน ณ ตอนนี้หรือการสั่งงาน ยังต้องรอ AI provider และทูลหลังบ้านที่เกี่ยวข้องพร้อมใช้งาน";
  return [heading, ...lines, ending].join("\n");
}

async function executeStaffAssistant(input: WorkAssistantInput, ctx: any) {
  requireAuth(ctx);
  const perms = await loadPermissions(ctx);
  const tenantId = getTenantId(ctx);
  const platformAdmin = await isPlatformAdmin(ctx);
  const role = String(ctx?.admin?.role ?? "") || null;
  const message = String(input.message ?? "").trim();
  if (!message) throw new GraphQLError("message ว่าง", { extensions: { code: "BAD_USER_INPUT" } });

  const currentPath = safeCurrentPath(input.currentPath);
  const pageId = safeContextId(input.pageId);
  const locale = safeLocale(input.locale);
  const retrieved = searchAssistantKnowledge(message, {
    locale,
    currentPath,
    pageId,
    permissions: perms,
    role,
    isPlatformAdmin: platformAdmin,
    limit: 5,
  }).filter((entry) => entry.score >= 4);
  /**
   * A citation claims "this verified entry is about what you asked". Standing on a page adds a
   * larger bonus than the relevance floor, so page-context-only hits must not be cited — otherwise
   * every guide on the current page is cited for every message, including "hello".
   */
  const matched = retrieved.filter((entry) => entry.matchedQuery);
  const citations = matched.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    path: entry.route,
    status: entry.capabilityStatus ?? null,
    accessible: entry.accessible,
    missingPermissions: entry.missingPermissions,
    accessRequirement: entry.accessRequirement,
    accessNote: entry.accessNote,
  }));
  const links = matched
    .filter((entry) => entry.accessible && entry.route)
    .map((entry) => ({ label: entry.title, path: entry.route }))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.path === entry.path) === index);

  const clarification = clarifyAmbiguousStaffRequest(message);
  if (clarification) {
    return { reply: clarification, answerType: "CLARIFICATION", citations, links, proposals: [], trace: [] };
  }

  const history = Array.isArray(input.history) ? input.history : [];
  const priorTurns = history
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim())
    .slice(-10)
    .map((turn) => ({ role: turn.role as "user" | "assistant", content: String(turn.text).slice(0, 4000) }));

  const loop = await runToolLoop({
    tenantId,
    system: STAFF_SYSTEM,
    messages: [...priorTurns, { role: "user", content: message.slice(0, 8000) }],
    tools: staffTools(perms),
    execCtx: {
      tenantId,
      surface: "staff",
      actor: ctx?.admin?.email || String(ctx?.admin?.id ?? "admin"),
      ctx,
      permissions: perms,
      role,
      isPlatformAdmin: platformAdmin,
      currentPath,
      pageId,
    },
  });

  if (!loop.usedAi) {
    // With no provider, page-context guidance is still better than nothing — but it is labelled
    // as "guides for this page", never as an answer to the question.
    const fallbackKnowledge = matched.length ? matched : retrieved;
    const deterministicReply = deterministicKnowledgeReply(fallbackKnowledge, locale, matched.length > 0);
    return {
      reply: deterministicReply ?? (locale === "en"
        ? "AI is not configured for this shop or the monthly AI message quota is exhausted. Configure an API key in Settings."
        : "ยังไม่ได้ตั้งค่า AI ให้ร้านนี้ หรือใช้โควตาข้อความ AI ของเดือนนี้หมดแล้ว — ตั้งค่า/ใส่ API key ได้ที่หน้า Settings"),
      answerType: matched[0]?.kind === "guide" ? "GUIDE" : matched[0]?.kind === "capability" ? "CAPABILITY" : "GENERAL",
      citations,
      links,
      proposals: [],
      trace: [],
    };
  }

  const trace = loop.trace.map((entry) => ({ tool: entry.tool, ok: entry.ok, summary: entry.summary }));
  const usedKnowledge = trace.some((entry) => entry.tool === "search_system_guides" || entry.tool === "search_system_capabilities");
  const usedBusiness = trace.some((entry) => !entry.tool.startsWith("search_system_") && entry.tool !== "get_my_access");
  const answerType = usedKnowledge && usedBusiness
    ? "MIXED"
    : usedKnowledge
      ? matched[0]?.kind === "guide" ? "GUIDE" : "CAPABILITY"
      : usedBusiness
        ? "BUSINESS"
        : "GENERAL";

  return {
    reply: loop.reply || "—",
    answerType,
    citations,
    links,
    proposals: loop.proposals,
    trace,
  };
}

export const bmsAssistantResolvers = {
  Mutation: {
    async bmsAssistant(
      _p: unknown,
      args: { message: string; history?: Turn[] },
      ctx: any
    ) {
      return executeStaffAssistant(args, ctx);
    },
    async bmsWorkAssistant(
      _p: unknown,
      args: { input: WorkAssistantInput },
      ctx: any
    ) {
      return executeStaffAssistant(args.input ?? {}, ctx);
    },
    async bmsPharmacyAssistantTest(
      _p: unknown,
      args: { message: string; session?: { protocolKey?: string | null; phase?: string | null; protocolId?: string | null; answers?: Record<string, string | number>; currentQuestionKey?: string | null; currentFieldKey?: string | null } },
      ctx: any
    ) {
      requireAuth(ctx);
      const tenantId = getTenantId(ctx);
      const message = String(args.message ?? "").trim();
      if (!message) throw new GraphQLError("message ว่าง", { extensions: { code: "BAD_USER_INPUT" } });
      const validPhases = new Set<PharmacyTestPhase>([
        "NONE",
        "AWAITING_INTENT_CLARIFICATION",
        "PRODUCT_PURCHASE",
        "AWAITING_CONSENT",
        "ASKING",
        "PENDING_CONFIRMATION",
        "WAITING",
      ]);
      const requestedPhase = args.session?.phase;
      const session: PharmacyTestSession | null = args.session
        ? {
            protocolKey: args.session.protocolKey ?? undefined,
            phase: requestedPhase && validPhases.has(requestedPhase as PharmacyTestPhase)
              ? (requestedPhase as PharmacyTestPhase)
              : undefined,
            protocolId: args.session.protocolId ?? undefined,
            answers: args.session.answers ?? undefined,
            currentQuestionKey: args.session.currentQuestionKey ?? undefined,
            currentFieldKey: args.session.currentFieldKey ?? undefined,
          }
        : null;
      const result = await runPharmacyTestHarness(tenantId, message, session);
      return { reply: result.reply, session: result.session };
    },
    async bmsCreatePharmacyLabOrder(
      _p: unknown,
      args: { items: Array<{ sku: string; qty: number; size?: string | null }> },
      ctx: any
    ) {
      requireAuth(ctx);
      await requirePermission(ctx, "order.create");
      const tenantId = getTenantId(ctx);
      const result = await createPharmacyLabOrder(tenantId, args.items ?? [], ctx?.admin?.id ?? null);
      if (result.status === "CREATED") {
        await audit(ctx, "order.create", result.orderId, {
          itemCount: Array.isArray(args.items) ? args.items.length : 0,
          total: result.total,
          source: "pharmacy-intake-lab",
          customerRef: "customerRef" in result ? result.customerRef ?? null : null,
        });
        return {
          status: result.status,
          orderId: result.orderId,
          total: result.total,
          message: `สร้างออร์เดอร์แล้ว ยอดรวม ${result.total.toLocaleString()} ฿`,
        };
      }
      const messages: Record<string, string> = {
        EMPTY: "ไม่มีรายการสินค้าในตะกร้า",
        INVALID_ITEM: result.status === "INVALID_ITEM" ? `รายการที่ ${result.index + 1}: ${result.reason}` : "รายการสินค้าไม่ถูกต้อง",
        NOT_FOUND: `ไม่พบสินค้า ${"sku" in result ? result.sku : ""} หรือไม่มีสต็อกแล้ว`,
        INSUFFICIENT: result.status === "INSUFFICIENT"
          ? `${result.sku} (${result.size}) เหลือ ${result.available} ไม่พอสั่ง ${result.requested}`
          : "สต็อกไม่พอ",
        PHARMACY_POLICY_UNKNOWN: "สินค้านี้ยังไม่มีการอนุมัติให้ขายในระบบ",
        PHARMACY_SAFETY_CHECK_REQUIRED: "สินค้านี้ต้องเก็บข้อมูลความปลอดภัยก่อน จึงยังสร้างออเดอร์ไม่ได้",
        PHARMACY_REVIEW_REQUIRED: "สินค้านี้ต้องให้เภสัชกรตรวจสอบก่อน จึงยังสร้างออเดอร์ไม่ได้",
        PHARMACY_PRESCRIPTION_REQUIRED: "สินค้านี้ต้องมีใบสั่งและผ่านการตรวจโดยเภสัชกรก่อน",
        PHARMACY_ONLINE_SALE_PROHIBITED: "สินค้านี้ไม่อนุญาตให้สร้างออเดอร์ออนไลน์",
        PHARMACY_QUANTITY_LIMIT_EXCEEDED: result.status === "PHARMACY_QUANTITY_LIMIT_EXCEEDED"
          ? `สินค้านี้สั่งได้ไม่เกิน ${result.maxQuantity} ชิ้นต่อครั้ง`
          : "จำนวนเกินข้อกำหนด",
        SIZE_REQUIRED: result.status === "SIZE_REQUIRED"
          ? `${result.name} (${result.sku}) มีหลายขนาดในสต็อก: ${result.availableSizes.join(", ")} กรุณาระบุขนาดก่อนสร้างออเดอร์`
          : "กรุณาระบุขนาดสินค้า",
      };
      return {
        status: result.status,
        orderId: null,
        total: null,
        message: messages[result.status] ?? "สร้างออร์เดอร์จาก Lab ไม่สำเร็จ",
      };
    },
  },
};
