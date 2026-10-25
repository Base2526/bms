import type { PoolClient } from "pg";
import { operationSupervisor, teamNotice } from "./operationTeamDispatch";

/** Transactional inbox only; shared by explicit decisions and held-stock replenishment. */
export async function notifyQualityCase(
  c: PoolClient,
  tenant: string,
  p: { id: string; location_id: string; assigned_to: string; version: number },
  kind: string,
) {
  const head = await operationSupervisor(
    c,
    tenant,
    p.location_id,
    new Date().toISOString(),
  );
  for (const recipient of new Set([p.assigned_to, head]))
    await teamNotice(
      c,
      tenant,
      p.location_id,
      recipient,
      p.id,
      "QUALITY",
      kind,
      String(p.version),
      "operations.quality.view",
    );
}
