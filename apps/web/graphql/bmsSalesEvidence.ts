import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { getSalesEvidence } from "@/lib/bms/salesEvidence";

export const bmsSalesEvidenceResolvers = {
  Query: {
    async bmsSalesEvidence(_parent: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "report.view");
      await requirePermission(ctx, "tax.document.view");
      const actor = String(requireAuth(ctx).author_id);
      try { return await getSalesEvidence(getTenantId(ctx), actor, args.input); }
      catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "SALES_EVIDENCE_FORBIDDEN") throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
        if (!code.startsWith("SALES_EVIDENCE_")) throw error;
        return { status: "REJECTED", errorCode: code, groups: [], issues: [], samples: [] };
      }
    },
  },
};
