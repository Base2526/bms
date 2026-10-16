import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import {
  listMasterBanks, listMasterThaiAddresses, listMasterUnits,
  upsertMasterBank, upsertMasterCarrier, upsertMasterThaiAddress, upsertMasterUnit,
  type MasterAddressInput, type MasterBankInput, type MasterCarrierInput, type MasterUnitInput,
} from "@/lib/bms/masterData";
import { listMasterCarriers } from "@/lib/bms/shippingMaster";
import { listTaxMasterData } from "@/lib/bms/taxMaster";
import {
  listMasterBarcodes, reviewMasterBarcode, type MasterBarcodeInput,
} from "@/lib/bms/barcodeMaster";
import { requirePlatformAdmin } from "@/lib/bms/platform";

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
    async bmsMasterCarriers(_p: unknown, args: { includeInactive?: boolean }, ctx: any) {
      requireLoggedIn(ctx);
      return listMasterCarriers(Boolean(args.includeInactive));
    },
    async bmsMasterTaxReferences(_p: unknown, _args: unknown, ctx: any) {
      requireLoggedIn(ctx);
      return listTaxMasterData();
    },
    async bmsMasterBarcodes(_p: unknown, args: any, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listMasterBarcodes(args);
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
    async bmsUpsertMasterCarrier(_p: unknown, args: { input: MasterCarrierInput }, ctx: any) {
      return mutation(() => upsertMasterCarrier(ctx, args.input));
    },
    async bmsReviewMasterBarcode(_p: unknown, args: { input: MasterBarcodeInput }, ctx: any) {
      return mutation(() => reviewMasterBarcode(ctx, args.input));
    },
  },
};
