// =============================================================
// GraphQL resolvers — BMS CRM (admin panel)
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import {
  listCustomers,
  getCustomer,
  customerOrders,
  customerAddresses,
  customerIdentities,
  upsertCustomer,
  setCustomerTags,
  addCustomerAddress,
  deleteCustomer,
} from "@/lib/bms/customers";

function requireAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
  return auth;
}
function toGqlError(err: any): never {
  throw new GraphQLError(err?.message || "operation failed", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

export const bmsCustomersResolvers = {
  Query: {
    async bmsCustomers(
      _p: unknown,
      args: { search?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      requireAdmin(ctx);
      return listCustomers(args.search ?? "", args.limit ?? 50, args.offset ?? 0);
    },
    async bmsCustomer(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return getCustomer(args.id);
    },
  },

  Mutation: {
    async bmsUpsertCustomer(_p: unknown, args: { input: any }, ctx: any) {
      requireAdmin(ctx);
      try {
        return await upsertCustomer(args.input);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetCustomerTags(_p: unknown, args: { id: string; tags: string[] }, ctx: any) {
      requireAdmin(ctx);
      return setCustomerTags(args.id, args.tags);
    },
    async bmsAddCustomerAddress(
      _p: unknown,
      args: { id: string; label?: string; address: string; isDefault?: boolean },
      ctx: any
    ) {
      requireAdmin(ctx);
      try {
        return await addCustomerAddress(args.id, args.label ?? null, args.address, !!args.isDefault);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsDeleteCustomer(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return deleteCustomer(args.id);
    },
  },

  BmsCustomer: {
    total_spent: (p: any) => Number(p.total_spent ?? 0),
    order_count: (p: any) => Number(p.order_count ?? 0),
    tags: (p: any) => p.tags ?? [],
    addresses: (p: any) => customerAddresses(p.id),
    identities: (p: any) => customerIdentities(p.id),
    orders: (p: any) => customerOrders(p.id),
  },
};
