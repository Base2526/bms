import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { runChecklistSchedules } from "@/lib/bms/operationChecklists";
import { runChecklistFollowups } from "@/lib/bms/operationChecklistFollowup";
import { runOperationTeamFollowups } from "@/lib/bms/operationTeam";
import { runProductionFollowups } from "@/lib/bms/operationProduction";
import { runMaterialFollowups } from "@/lib/bms/operationMaterials";
import { runQualityFollowups } from "@/lib/bms/operationQuality";
import { withRouteErrorLog } from "@/lib/log/routeError";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(req: Request) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) return auth.response;
  const result = await recordJobRun(
    "operation-checklists",
    "cron",
    async () => {
      const r = await runChecklistSchedules();
      const followup = await runChecklistFollowups();
      const team = await runOperationTeamFollowups();
      const production = await runProductionFollowups();
      const materials = await runMaterialFollowups();
      const quality = await runQualityFollowups();
      if (r.failed || followup.failed || team.failed || production.failed || materials.failed || quality.failed)
        throw new Error(
          `Checklist schedules/followup: ${r.failed + followup.failed + team.failed + production.failed + materials.failed + quality.failed} tenant batches failed`,
        );
      return { ...r, followup, team, production, materials, quality };
    },
  );
  return NextResponse.json({ ok: true, ...result });
}
export const POST = withRouteErrorLog(
  "POST /api/bms/operations/run",
  handlePOST,
);
