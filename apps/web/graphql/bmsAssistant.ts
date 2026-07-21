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
import { loadPermissions } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { runToolLoop } from "@/lib/bms/tools/runtime";
import { staffTools } from "@/lib/bms/tools/catalog";

const STAFF_SYSTEM = [
  "คุณเป็นผู้ช่วย AI สำหรับแอดมินร้านค้า ตอบเป็นภาษาไทย กระชับ ชัดเจน",
  "ใช้ 'ทูล' ที่ให้มาเพื่อดึงข้อมูลจริงและดำเนินการหลังบ้าน ห้ามเดา/แต่งตัวเลขเอง — อ้างอิงตัวเลขจากผลของทูลเท่านั้น",
  "งานที่กระทบเงิน/สต็อก/ลบข้อมูล (ยืนยันเงิน/ปฏิเสธ/คืนเงิน/ยกเลิกออร์เดอร์-PO-การจัดส่ง/ปรับสต็อก/ผสานลูกค้า)",
  "จะเป็น 'คำขอ' ที่ต้องให้แอดมินกดยืนยันเองในหน้าจอ — เมื่อเรียกทูลกลุ่มนี้ ให้แจ้งว่าเตรียมคำขอไว้แล้ว รอกดยืนยัน อย่าบอกว่าทำเสร็จ",
  "ถ้าทูลคืน error หรือไม่พบข้อมูล ให้บอกตามจริงและเสนอขั้นตอนถัดไป",
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
  },
};
