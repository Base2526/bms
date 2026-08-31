// =============================================================
// GraphQL resolvers — BMS CRM (admin panel)
// =============================================================

import { GraphQLError } from "graphql/error";
import {
  listCustomers,
  getCustomer,
  customerOrders,
  customerAddresses,
  customerIdentities,
  upsertCustomer,
  setCustomerTags,
  addCustomerAddress,
  updateCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
  deleteCustomer,
  mergeCustomers,
} from "@/lib/bms/customers";
import { listCustomerCouponWallet } from "@/lib/bms/coupons";
import { getMember, listLoyaltyLedger } from "@/lib/bms/membership";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { listLocationsForUser } from "@/lib/bms/locations";
import { requireAuth } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function toGqlError(err: any): never {
  throw new GraphQLError(err?.message || "operation failed", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

export const bmsCustomersResolvers = {
  Query: {
    async bmsCustomers(
      _p: unknown,
      args: { search?: string; limit?: number; offset?: number; enrolledLocationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "customer.view");
      const enrolledLocationId = args.enrolledLocationId?.trim() || null;
      if (enrolledLocationId && !UUID_RE.test(enrolledLocationId)) {
        throw new GraphQLError("รหัสสาขาที่สมัครไม่ถูกต้อง", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      return listCustomers(
        getTenantId(ctx),
        args.search ?? "",
        args.limit ?? 50,
        args.offset ?? 0,
        enrolledLocationId
      );
    },
    async bmsCustomerLocations(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "customer.view");
      const auth = requireAuth(ctx);
      return listLocationsForUser(getTenantId(ctx), String(auth.author_id || ""));
    },
    async bmsCustomer(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "customer.view");
      return getCustomer(getTenantId(ctx), args.id);
    },
  },

  Mutation: {
    async bmsUpsertCustomer(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      try {
        return await upsertCustomer(getTenantId(ctx), args.input);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetCustomerTags(_p: unknown, args: { id: string; tags: string[] }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      return setCustomerTags(getTenantId(ctx), args.id, args.tags);
    },
    async bmsAddCustomerAddress(
      _p: unknown,
      args: { id: string; label?: string; address: string; isDefault?: boolean },
      ctx: any
    ) {
      await requirePermission(ctx, "customer.edit");
      try {
        return await addCustomerAddress(getTenantId(ctx), args.id, args.label ?? null, args.address, !!args.isDefault);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsUpdateCustomerAddress(
      _p: unknown,
      args: { addressId: string; label?: string; address: string },
      ctx: any
    ) {
      await requirePermission(ctx, "customer.edit");
      try {
        return await updateCustomerAddress(getTenantId(ctx), args.addressId, args.label ?? null, args.address);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetDefaultCustomerAddress(_p: unknown, args: { addressId: string }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      try {
        return await setDefaultCustomerAddress(getTenantId(ctx), args.addressId);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsDeleteCustomerAddress(_p: unknown, args: { addressId: string }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      return deleteCustomerAddress(getTenantId(ctx), args.addressId);
    },
    async bmsDeleteCustomer(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      return deleteCustomer(getTenantId(ctx), args.id);
    },
    async bmsMergeCustomers(_p: unknown, args: { keepId: string; mergeId: string }, ctx: any) {
      await requirePermission(ctx, "customer.edit");
      try {
        const ok = await mergeCustomers(getTenantId(ctx), args.keepId, args.mergeId);
        await audit(ctx, "customer.merge", args.keepId, { mergedId: args.mergeId });
        return ok;
      } catch (err) {
        toGqlError(err);
      }
    },
  },

  BmsCustomer: {
    total_spent: (p: any) => Number(p.total_spent ?? 0),
    order_count: (p: any) => Number(p.order_count ?? 0),
    tags: (p: any) => p.tags ?? [],
    addresses: (p: any) => customerAddresses(p.tenant_id, p.id),
    identities: (p: any) => customerIdentities(p.tenant_id, p.id),
    orders: (p: any) => customerOrders(p.tenant_id, p.id),
    coupons: (p: any) => listCustomerCouponWallet(p.tenant_id, { customerId: p.id }),
    // สมาชิก/แต้มอยู่ที่นี่ด้วย (7.96) — คนดูข้อมูลลูกค้าไม่ควรต้องเดาว่าต้องไป
    // อีกหน้า (/admin/loyalty) เพื่อรู้ว่าลูกค้าคนนี้เป็นสมาชิกและมีแต้มเท่าไร
    membership: (p: any) => getMember(p.tenant_id, p.id),
    loyaltyLedger: (p: any) => listLoyaltyLedger(p.tenant_id, p.id, 50),
  },
};
