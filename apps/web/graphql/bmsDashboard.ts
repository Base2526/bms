// GraphQL resolver — BMS dashboard (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getDashboard } from "@/lib/bms/dashboard";

export const bmsDashboardResolvers = {
  Query: {
    async bmsDashboard(_p: unknown, _a: unknown, ctx: any) {
      const auth = requireAuth(ctx);
      if (auth.scope !== "admin") {
        throw new GraphQLError("Admin only", {
          extensions: { code: "FORBIDDEN", http: { status: 403 } },
        });
      }
      return getDashboard();
    },
  },
};
