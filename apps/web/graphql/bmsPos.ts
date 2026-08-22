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
import { listLocations, upsertLocation } from "@/lib/bms/locations";
import {
  clearCashierPin,
  closePosShift,
  getOpenPosShift,
  getPosOperationalReadiness,
  issuePosDeviceToken,
  listPosCashiers,
  listTenantStaff,
  listPosDevices,
  openPosShift,
  setCashierAccountMode,
  setCashierPin,
  upsertPosDevice,
} from "@/lib/bms/pos";
import { listExpiringLots, listLots, listOrdersForLot, reconcileLotTotals } from "@/lib/bms/lots";
import { setVatCategoryForUnknown } from "@/lib/bms/products";
import {
  getVatSettings,
  issueFullTaxInvoice,
  listTaxDocumentsForOrder,
  updateVatSettings,
} from "@/lib/bms/taxDocuments";
import { backfillEtaxQueue, getEtaxSummary, listEtaxSubmissions, processEtaxQueue } from "@/lib/bms/etax/queue";
import {
  deleteProductPack,
  listProductPacks,
  listProductsNeedingBarcodes,
  listSizesForProduct,
  upsertProductPack,
  type UpsertPackInput,
} from "@/lib/bms/productPacks";
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

    /** พนักงานในร้าน + สถานะ PIN — ใช้ในหน้าตั้งค่า POS ฝั่งแอดมิน */
    /** พนักงานทุกคนในร้าน — สำหรับหน้าจัดการ ไม่ใช่ dropdown ที่เคาน์เตอร์ */
    async bmsPosStaff(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "pos.staff.manage");
      return listTenantStaff(getTenantId(ctx));
    },

    /** หน่วยขายของสินค้า 1 ตัว — ไซซ์ / บาร์โค้ด / ราคาต่อหน่วย */
    async bmsProductPacks(_p: unknown, args: { productSku: string }, ctx: any) {
      await requirePermission(ctx, "product.view");
      const tenantId = getTenantId(ctx);
      const [packs, sizes] = await Promise.all([
        listProductPacks(tenantId, args.productSku),
        listSizesForProduct(tenantId, args.productSku),
      ]);
      return { packs, sizes };
    },

    /** สินค้าหลายไซซ์ที่ยังมีบาร์โค้ดไม่ครบ — ยิงไม่เจอ ต้องค้นชื่อเอา */
    async bmsProductsNeedingBarcodes(_p: unknown, args: { limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listProductsNeedingBarcodes(getTenantId(ctx), args.limit ?? 200);
    },

    async bmsEtaxSummary(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "etax.view");
      return getEtaxSummary(getTenantId(ctx));
    },

    async bmsEtaxSubmissions(_p: unknown, args: { status?: string | null; limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "etax.view");
      return listEtaxSubmissions(getTenantId(ctx), { status: args.status ?? null, limit: args.limit ?? 100 });
    },

    async bmsPosCashiers(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "pos.pin.manage");
      return listPosCashiers(getTenantId(ctx));
    },

    async bmsPosOpenShift(_p: unknown, args: { deviceId: string }, ctx: any) {
      await requirePermission(ctx, "pos.sell");
      return getOpenPosShift(getTenantId(ctx), args.deviceId);
    },

    async bmsPosOperationalReadiness(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "pos.device.manage");
      return getPosOperationalReadiness(getTenantId(ctx));
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

    /** ค่าตั้งภาษีของร้าน — เดิมแก้ได้ทาง SQL อย่างเดียว */
    async bmsTaxSettings(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "tax.setting.manage");
      return getVatSettings(getTenantId(ctx));
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
    async bmsUpsertLocation(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "location.manage");
      try {
        const location = await upsertLocation(getTenantId(ctx), args.input);
        await audit(ctx, "location.upsert", location.id, { code: location.code, branchCode: location.branchCode });
        return location;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกสาขาไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },

    async bmsUpsertPosDevice(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "pos.device.manage");
      try {
        const auth = requireAuth(ctx);
        const device = await upsertPosDevice(getTenantId(ctx), args.input, {
          editorId: auth.author_id,
          auditActor: String(ctx?.admin?.email ?? ctx?.admin?.id ?? auth.author_id),
        });
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
     * ตั้งค่าภาษีของร้าน (จด VAT / อัตรา / วิธีปัดเศษ / อนุมัติใบกำกับอย่างย่อ)
     * มีผลกับบิลใหม่เท่านั้น เอกสารที่ออกไปแล้วเก็บอัตราของตัวเองไว้ในแถวของมัน
     */
    async bmsUpdateTaxSettings(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "tax.setting.manage");
      const tenantId = getTenantId(ctx);
      const before = await getVatSettings(tenantId);
      try {
        const after = await updateVatSettings(tenantId, args.input);
        // ค่าพวกนี้เปลี่ยนเอกสารที่ออกให้ลูกค้า — ต้องรู้ว่าใครเปลี่ยนจากอะไรเป็นอะไร
        await audit(ctx, "tax.setting.update", tenantId, { before, after });
        return after;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกค่าตั้งภาษีไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },

    /**
     * ตั้งประเภท VAT ให้สินค้าที่ยังไม่ระบุทั้งหมดในคราวเดียว
     *
     * สิทธิ์ที่ใช้คือ tax.setting.manage ไม่ใช่ product.edit — นี่คือการจัดประเภทภาษี
     * ของทั้งร้าน ไม่ใช่การแก้สินค้ารายตัว คนที่แก้ชื่อ/ราคาสินค้าได้ไม่ควรตัดสินใจ
     * แทนร้านว่าสินค้าทั้งหมดคิด VAT หรือยกเว้น
     */
    async bmsSetVatCategoryForUnknown(
      _p: unknown,
      args: { vatCategory: string; activeOnly?: boolean | null },
      ctx: any
    ) {
      await requirePermission(ctx, "tax.setting.manage");
      const tenantId = getTenantId(ctx);
      const category = String(args.vatCategory ?? "").trim().toUpperCase();
      if (category !== "V" && category !== "N") {
        throw new GraphQLError("ประเภท VAT ต้องเป็น V หรือ N", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const activeOnly = args.activeOnly ?? true;
      const changed = await setVatCategoryForUnknown(tenantId, category, {
        activeOnly,
        editorId: requireAuth(ctx).author_id,
      });
      // เปลี่ยนฐานภาษีของสินค้าหลายตัวพร้อมกัน — ต้องรู้ว่าใครกดและกดเป็นอะไร
      await audit(ctx, "tax.product_category.bulk_set", tenantId, { category, activeOnly, changed });
      return changed;
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

    /**
     * ตั้ง/ล้าง PIN ของพนักงาน — PIN ไม่เคยถูกส่งกลับหรือบันทึกลง audit
     * ล้าง PIN = คนนั้นขายหน้าร้านไม่ได้ทันที (ใช้ตอนลาออก)
     */
    async bmsSetCashierPin(_p: unknown, args: { userId: ID_; pin?: string | null }, ctx: any) {
      await requirePermission(ctx, "pos.pin.manage");
      const tenantId = getTenantId(ctx);
      const actorUserId = String(requireAuth(ctx).author_id);
      try {
        if (args.pin) await setCashierPin(tenantId, args.userId, args.pin, actorUserId);
        else await clearCashierPin(tenantId, args.userId, actorUserId);
      } catch (e: any) {
        throw new GraphQLError(e?.message || "ตั้ง PIN ไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return true;
    },

    /** เปิด/ปิดทางเข้าหลังบ้านของบัญชีพนักงานหน้าร้าน (7.92) */
    async bmsSetCashierAccountMode(_p: unknown, args: { userId: ID_; posOnly: boolean }, ctx: any) {
      await requirePermission(ctx, "pos.staff.manage");
      try {
        await setCashierAccountMode(
          getTenantId(ctx), args.userId, args.posOnly, String(requireAuth(ctx).author_id)
        );
      } catch (e: any) {
        throw new GraphQLError(e?.message || "ตั้งค่าบัญชีไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return true;
    },

    async bmsUpsertProductPack(_p: unknown, args: { input: UpsertPackInput }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const pack = await upsertProductPack(getTenantId(ctx), args.input);
        await audit(ctx, "product.pack.upsert", pack.id, {
          sku: pack.productSku, size: pack.size, packCode: pack.packCode,
        });
        return pack;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกหน่วยขายไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },

    async bmsDeleteProductPack(_p: unknown, args: { id: ID_ }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      const ok = await deleteProductPack(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "product.pack.delete", args.id);
      return ok;
    },

    /** เดินคิวด้วยมือ — ปกติ cron ทำให้ แต่ต้องกดเองได้ตอนไล่ปัญหา */
    async bmsRunEtaxQueue(_p: unknown, args: { limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "etax.manage");
      const result = await processEtaxQueue(getTenantId(ctx), args.limit ?? 20);
      await audit(ctx, "etax.queue.run", null, result as any);
      return result;
    },

    /** เอาใบกำกับที่ออกก่อนเปิด e-Tax เข้าคิวย้อนหลัง */
    async bmsBackfillEtaxQueue(_p: unknown, args: { limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "etax.manage");
      const n = await backfillEtaxQueue(getTenantId(ctx), args.limit ?? 500);
      await audit(ctx, "etax.queue.backfill", null, { queued: n });
      return n;
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
