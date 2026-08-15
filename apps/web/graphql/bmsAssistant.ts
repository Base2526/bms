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

const STAFF_SYSTEM = [
  "คุณเป็นผู้ช่วย AI สำหรับแอดมินร้านค้า ตอบเป็นภาษาไทย กระชับ ชัดเจน",
  "ใช้ 'ทูล' ที่ให้มาเพื่อดึงข้อมูลจริงและดำเนินการหลังบ้าน ห้ามเดา/แต่งตัวเลขเอง — อ้างอิงตัวเลขจากผลของทูลเท่านั้น",
  "งานที่กระทบเงิน/สต็อก/ลบข้อมูล (ยืนยันเงิน/ปฏิเสธ/คืนเงิน/ยกเลิกออร์เดอร์-PO-การจัดส่ง/ปรับสต็อก/ผสานลูกค้า)",
  "จะเป็น 'คำขอ' ที่ต้องให้แอดมินกดยืนยันเองในหน้าจอ — เมื่อเรียกทูลกลุ่มนี้ ให้แจ้งว่าเตรียมคำขอไว้แล้ว รอกดยืนยัน อย่าบอกว่าทำเสร็จ",
  "ถ้าทูลคืน error หรือไม่พบข้อมูล ให้บอกตามจริงและเสนอขั้นตอนถัดไป",
  "ถ้าคำขอกำกวมจนขอบเขตข้อมูล ช่วงเวลา เป้าหมาย หรือการกระทำอาจเปลี่ยน ห้ามเดาหรือเลือกค่า default ให้ถามยืนยันสั้น ๆ ก่อนเรียกทูล โดยเฉพาะคำว่า 'ทั้งหมด' ต้องแยกทุกช่วงเวลาออกจากทุกรายการ และ 'รายการขาย' ต้องแยกสินค้าออกจากออร์เดอร์",
  "เมื่อผู้ใช้ยืนยันว่าต้องการยอดขายหรือสินค้าขายดีตั้งแต่เริ่มขาย/เปิดร้าน/ทุกช่วงเวลา ให้เรียกทูลด้วย scope='all_time' และไม่ส่ง from/to",
].join("\n");

type Turn = { role?: string; text?: string };

export const bmsAssistantResolvers = {
  Mutation: {
    async bmsAssistant(
      _p: unknown,
      args: { message: string; history?: Turn[] },
      ctx: any
    ) {
      requireAuth(ctx);
      // loadPermissions โยน FORBIDDEN ถ้าไม่ใช่ admin-capable + คืนสิทธิ์ตาม role/tenant
      const perms = await loadPermissions(ctx);
      const tenantId = getTenantId(ctx);

      const message = String(args.message ?? "").trim();
      if (!message) throw new GraphQLError("message ว่าง", { extensions: { code: "BAD_USER_INPUT" } });

      const clarification = clarifyAmbiguousStaffRequest(message);
      if (clarification) {
        return { reply: clarification, proposals: [], trace: [] };
      }

      const history = Array.isArray(args.history) ? args.history : [];
      const priorTurns = history
        .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string" && h.text.trim())
        .slice(-10) // จำกัดความยาว context (bounded)
        .map((h) => ({ role: h.role as "user" | "assistant", content: String(h.text) }));

      const loop = await runToolLoop({
        tenantId,
        system: STAFF_SYSTEM,
        messages: [...priorTurns, { role: "user", content: message }],
        tools: staffTools(perms),
        execCtx: { tenantId, surface: "staff", actor: ctx?.admin?.email || String(ctx?.admin?.id ?? "admin"), ctx },
      });

      if (!loop.usedAi) {
        return {
          reply:
            "ยังไม่ได้ตั้งค่า AI ให้ร้านนี้ หรือใช้โควตาข้อความ AI ของเดือนนี้หมดแล้ว — ตั้งค่า/ใส่ API key ได้ที่หน้า Settings",
          proposals: [],
          trace: [],
        };
      }

      return {
        reply: loop.reply || "—",
        proposals: loop.proposals,
        trace: loop.trace.map((t) => ({ tool: t.tool, ok: t.ok, summary: t.summary })),
      };
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
