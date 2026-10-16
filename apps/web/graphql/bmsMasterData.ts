import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import {
  listMasterBanks, listMasterThaiAddresses, listMasterUnits,
  upsertMasterBank, upsertMasterThaiAddress, upsertMasterUnit,
  type MasterAddressInput, type MasterBankInput, type MasterUnitInput,
} from "@/lib/bms/masterData";

function requireLoggedIn(ctx: any) {
  const auth = requireAuth(ctx, { optionalAdmin: true });
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

async function mutation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error: any) {
    if (error instanceof GraphQLError) throw error;
    throw new GraphQLError(error?.message || "MASTER_DATA_WRITE_FAILED", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
}

export const bmsMasterDataResolvers = {
  Query: {
    async bmsMasterBanks(_p: unknown, args: { search?: string; includeInactive?: boolean }, ctx: any) {
      requireLoggedIn(ctx);
      return listMasterBanks(args.search, args.includeInactive);
    },
    async bmsMasterUnits(_p: unknown, args: { search?: string; includeInactive?: boolean }, ctx: any) {
      requireLoggedIn(ctx);
      return listMasterUnits(args.search, args.includeInactive);
    },
    async bmsMasterThaiAddresses(_p: unknown, args: any, ctx: any) {
      requireLoggedIn(ctx);
      return listMasterThaiAddresses(args);
    },
  },
  Mutation: {
    async bmsUpsertMasterBank(_p: unknown, args: { input: MasterBankInput }, ctx: any) {
      return mutation(() => upsertMasterBank(ctx, args.input));
    },
    async bmsUpsertMasterUnit(_p: unknown, args: { input: MasterUnitInput }, ctx: any) {
      return mutation(() => upsertMasterUnit(ctx, args.input));
    },
    async bmsUpsertMasterThaiAddress(_p: unknown, args: { input: MasterAddressInput }, ctx: any) {
      return mutation(() => upsertMasterThaiAddress(ctx, args.input));
    },
  },
};
