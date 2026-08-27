// GraphQL resolvers — ขายเชื่อ / ลูกหนี้การค้า (9.30)
//
// ที่นี่คือ "หลังร้าน": ตั้งวงเงิน ดูอายุหนี้ ตัดหนี้สูญ และรับชำระที่ไม่ใช่เงินสด
// การขายเชื่อจริงและการรับเงินสดไม่ผ่าน GraphQL — เครื่องหน้าร้านยิง
// POST /api/pos/sale และ POST /api/pos/ar/collect ด้วย device token เพราะเงินสด
// ต้องผูกกับลิ้นชักของกะที่เปิดอยู่จริงที่เครื่องนั้น (ดู 9.30)
import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import {
  getArAccountById,
  getArAccountByCustomer,
  getArOutstanding,
  listArAccounts,
  listArInvoices,
  listArLedger,
  recordArReceipt,
  upsertArAccount,
  writeOffArInvoice,
  type ArAccountStatus,
  type ArReceiptMethod,
} from "@/lib/bms/ar";

export const bmsArResolvers = {
  Query: {
    async bmsArAccounts(
      _p: unknown,
      a: { search?: string | null; status?: string | null; withBalanceOnly?: boolean | null; limit?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.view");
      return listArAccounts(getTenantId(ctx), {
        search: a.search ?? null,
        status: (a.status as ArAccountStatus) ?? null,
        withBalanceOnly: a.withBalanceOnly === true,
        limit: a.limit ?? 200,
      });
    },

    async bmsArAccount(_p: unknown, a: { id?: string | null; customerId?: string | null }, ctx: any) {
      await requirePermission(ctx, "ar.view");
      const tenantId = getTenantId(ctx);
      if (a.id) return getArAccountById(tenantId, a.id);
      if (a.customerId) return getArAccountByCustomer(tenantId, a.customerId);
      throw new GraphQLError("ต้องระบุ id หรือ customerId", { extensions: { code: "BAD_USER_INPUT" } });
    },

    async bmsArInvoices(
      _p: unknown,
      a: { accountId?: string | null; openOnly?: boolean | null; overdueOnly?: boolean | null; limit?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.view");
      return listArInvoices(getTenantId(ctx), {
        accountId: a.accountId ?? null,
        openOnly: a.openOnly === true,
        overdueOnly: a.overdueOnly === true,
        limit: a.limit ?? 200,
      });
    },

    async bmsArLedger(
      _p: unknown,
      a: { invoiceId?: string | null; accountId?: string | null; limit?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.view");
      return listArLedger(getTenantId(ctx), {
        invoiceId: a.invoiceId ?? null,
        accountId: a.accountId ?? null,
        limit: a.limit ?? 200,
      });
    },

    // ยอดลูกหนี้คงค้าง = สินทรัพย์ในงบดุล · ตัวเลขที่ส่งบัญชีก่อนปิดงบ
    async bmsArOutstanding(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "ar.view");
      return getArOutstanding(getTenantId(ctx));
    },
  },

  Mutation: {
    async bmsUpsertArAccount(
      _p: unknown,
      a: {
        customerId: string;
        creditLimit: number;
        termsDays: number;
        status?: string | null;
        note?: string | null;
      },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.manage");
      // audit อยู่ในทรานแซกชันเดียวกับการเขียนใน service แล้ว ไม่ยิงซ้ำที่นี่
      const result = await upsertArAccount({
        tenantId: getTenantId(ctx),
        customerId: a.customerId,
        creditLimit: a.creditLimit,
        termsDays: a.termsDays,
        status: (a.status as ArAccountStatus) ?? null,
        note: a.note ?? null,
        actorUserId: ctx.admin.id,
      });
      if (result.status === "INVALID") {
        throw new GraphQLError(result.reason, { extensions: { code: "BAD_USER_INPUT" } });
      }
      return result.account;
    },

    /**
     * รับชำระหนี้จากหลังร้าน — โอน/บัตร/QR เท่านั้น
     *
     * เงินสดรับที่นี่ไม่ได้โดยตั้งใจ: หลังร้านไม่มีลิ้นชัก เงินสดที่บันทึกโดยไม่ผูกกะ
     * คือเงินที่นับปิดกะไม่เจอ · service ปฏิเสธซ้ำอีกชั้นถ้าไม่มี shiftId
     */
    async bmsRecordArReceipt(
      _p: unknown,
      a: {
        accountId: string;
        amount: number;
        method: string;
        reference?: string | null;
        note?: string | null;
        idempotencyKey: string;
      },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.collect");
      if (String(a.method).toUpperCase() === "CASH") {
        throw new GraphQLError(
          "รับเงินสดต้องทำที่เครื่องขายที่เปิดกะอยู่ เพื่อให้เงินเข้าลิ้นชักของกะนั้น",
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      const result = await recordArReceipt({
        tenantId: getTenantId(ctx),
        accountId: a.accountId,
        amount: a.amount,
        method: String(a.method).toUpperCase() as ArReceiptMethod,
        reference: a.reference ?? null,
        note: a.note ?? null,
        receivedBy: ctx.admin.id,
        idempotencyKey: a.idempotencyKey,
      });
      if (result.status === "INVALID") {
        throw new GraphQLError(result.reason, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (result.status === "OVER_PAYMENT") {
        throw new GraphQLError(
          `รับเกินยอดค้าง — ค้างอยู่ ฿${result.outstanding.toFixed(2)} แต่รับมา ฿${result.requested.toFixed(2)}`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      if (result.status === "IDEMPOTENCY_CONFLICT") {
        throw new GraphQLError("idempotencyKey นี้ถูกใช้กับคำขอรับชำระคนละรายการแล้ว", {
          extensions: { code: "CONFLICT" },
        });
      }
      return result;
    },

    async bmsWriteOffArInvoice(
      _p: unknown,
      a: { invoiceId: string; reason: string },
      ctx: any
    ) {
      await requirePermission(ctx, "ar.writeoff");
      const result = await writeOffArInvoice({
        tenantId: getTenantId(ctx),
        invoiceId: a.invoiceId,
        reason: a.reason,
        actorUserId: ctx.admin.id,
      });
      if (result.status === "INVALID") {
        throw new GraphQLError(result.reason, { extensions: { code: "BAD_USER_INPUT" } });
      }
      return result;
    },
  },
};
