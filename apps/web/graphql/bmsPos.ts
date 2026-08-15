// GraphQL resolvers — BMS POS (เครื่องขายหน้าร้าน, กะ/ลิ้นชักเงินสด, lot)
//
// ที่นี่คือ "หลังร้าน": ตั้งค่าเครื่อง เปิด/ปิดกะ ดูสาขา ดู lot ใกล้หมดอายุ
// การขายจริงไม่ผ่าน GraphQL — เครื่องหน้าร้านยิง POST /api/pos/sale ด้วย
// device token เพราะเปิดค้างทั้งวันและใช้ session cookie ของ admin ไม่ได้
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { listLocations } from "@/lib/bms/locations";
import {
  closePosShift,
  getOpenPosShift,
  issuePosDeviceToken,
  listPosDevices,
  openPosShift,
  upsertPosDevice,
} from "@/lib/bms/pos";
import { listExpiringLots, listLots, listOrdersForLot, reconcileLotTotals } from "@/lib/bms/lots";
import { issueFullTaxInvoice, listTaxDocumentsForOrder } from "@/lib/bms/taxDocuments";
import {
  getPharmacyPolicyReadiness,
  listProductsNeedingPolicyReview,
} from "@/lib/bms/pharmacy/policyReadiness";

type ID_ = string;

export const bmsPosResolvers = {
  Query: {
    async bmsLocations(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listLocations(getTenantId(ctx));
    },

    async bmsPosDevices(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "pos.device.manage");
      return listPosDevices(getTenantId(ctx));
    },

    async bmsPosOpenShift(_p: unknown, args: { deviceId: string }, ctx: any) {
      await requirePermission(ctx, "pos.sell");
      return getOpenPosShift(getTenantId(ctx), args.deviceId);
    },

    async bmsInventoryLots(
      _p: unknown,
      args: { productSku?: string | null; size?: string | null; locationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      return listLots(getTenantId(ctx), {
        productSku: args.productSku ?? null,
        size: args.size ?? null,
        locationId: args.locationId ?? null,
      });
    },

    async bmsExpiringLots(_p: unknown, args: { withinDays?: number | null }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listExpiringLots(getTenantId(ctx), args.withinDays ?? 90);
    },

    /** เรียกคืน: lot นี้ออกไปในบิลไหนบ้าง — ลูกค้าเดินเข้าที่ไม่ผูกตัวตนจะไม่มีชื่อ */
    async bmsLotRecall(_p: unknown, args: { lotId: string }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listOrdersForLot(getTenantId(ctx), args.lotId);
    },

    /** ตรวจ invariant lot vs ยอดสรุป — ควรได้ผลว่างหลัง backfill ครบ */
    async bmsLotReconcile(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "stock.adjust");
      return reconcileLotTotals(getTenantId(ctx));
    },

    async bmsTaxDocuments(_p: unknown, args: { orderId: ID_ }, ctx: any) {
      await requirePermission(ctx, "tax.document.view");
      return listTaxDocumentsForOrder(getTenantId(ctx), args.orderId);
    },

    async bmsPharmacyPolicyReadiness(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "pharmacy.policy.read");
      return getPharmacyPolicyReadiness(getTenantId(ctx));
    },

    async bmsProductsNeedingPolicyReview(
      _p: unknown,
      args: { limit?: number | null; offset?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.policy.read");
      return listProductsNeedingPolicyReview(getTenantId(ctx), {
        limit: args.limit ?? 100,
        offset: args.offset ?? 0,
      });
    },
  },

  Mutation: {
    async bmsUpsertPosDevice(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "pos.device.manage");
      try {
        const device = await upsertPosDevice(getTenantId(ctx), args.input);
        await audit(ctx, "pos.device.upsert", device.id, { code: device.code });
        return device;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกเครื่องขายไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },

    /** คืนค่า token จริงครั้งเดียว — ฐานข้อมูลเก็บแต่ hash */
    async bmsIssuePosDeviceToken(_p: unknown, args: { deviceId: string }, ctx: any) {
      await requirePermission(ctx, "pos.device.manage");
      const issued = await issuePosDeviceToken(getTenantId(ctx), args.deviceId);
      if (!issued) {
        throw new GraphQLError("ไม่พบเครื่องขายนี้", { extensions: { code: "NOT_FOUND" } });
      }
      // ไม่บันทึกค่า token ลง audit — บันทึกแค่ว่าออกให้เครื่องไหน เมื่อไหร่
      await audit(ctx, "pos.device.token.issue", args.deviceId);
      return issued;
    },

    /**
     * ลูกค้าขอใบกำกับเต็มรูป — ยกเลิกใบย่อแล้วออกใบใหม่ที่อ้างอิงเลขเดิม
     * ตามที่ใบกำกับจริงทุกใบทำ ("เป็นการยกเลิกใบกำกับภาษีอย่างย่อเลขที่ ...")
     */
    async bmsIssueFullTaxInvoice(
      _p: unknown,
      args: { orderId: ID_; buyer: any },
      ctx: any
    ) {
      await requirePermission(ctx, "tax.document.issue");
      const result = await issueFullTaxInvoice({
        tenantId: getTenantId(ctx),
        orderId: args.orderId,
        buyer: args.buyer,
        issuedBy: String(requireAuth(ctx).author_id),
      });
      if (result.status === "ISSUED") {
        await audit(ctx, "tax.document.issue_full", result.document.id, {
          orderId: args.orderId,
          docNo: result.document.docNo,
          replaces: result.cancelledAbbreviated?.docNo ?? null,
        });
      }
      return result;
    },

    async bmsOpenPosShift(
      _p: unknown,
      args: { deviceId: string; openingFloat?: number | null; pharmacistUserId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "pos.shift.open");
      const result = await openPosShift({
        tenantId: getTenantId(ctx),
        deviceId: args.deviceId,
        openedBy: String(requireAuth(ctx).author_id),
        openingFloat: args.openingFloat ?? 0,
        pharmacistUserId: args.pharmacistUserId ?? null,
      });
      if (result.status === "OPENED") {
        await audit(ctx, "pos.shift.open", result.shift.id, { deviceId: args.deviceId });
      }
      return result;
    },

    async bmsClosePosShift(
      _p: unknown,
      args: { shiftId: string; countedCash: number; note?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "pos.shift.close");
      const result = await closePosShift({
        tenantId: getTenantId(ctx),
        shiftId: args.shiftId,
        closedBy: String(requireAuth(ctx).author_id),
        countedCash: args.countedCash,
        note: args.note ?? null,
      });
      if (result.status === "CLOSED") {
        // ส่วนต่างเงินสดคือสิ่งที่ต้องตามได้ย้อนหลัง — เก็บลง audit เสมอ
        await audit(ctx, "pos.shift.close", result.shift.id, {
          expectedCash: result.shift.expectedCash,
          countedCash: result.shift.countedCash,
          cashVariance: result.shift.cashVariance,
        });
      }
      return result;
    },
  },
};
