import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/bms/platform";

/** Configuration writes are reserved for the shop Administrator or a DB-verified platform admin. */
export async function requireTenantSettingsAdministrator(ctx: any): Promise<void> {
  const auth = requireAuth(ctx);
  if (auth.scope === "admin" && (ctx?.admin?.role === "Administrator" || await isPlatformAdmin(ctx))) return;
  throw new GraphQLError("เฉพาะ Administrator เท่านั้น", {
    extensions: { code: "FORBIDDEN", http: { status: 403 } },
  });
}
