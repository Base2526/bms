import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { operationSupervisor, teamNotice } from "./operationTeamDispatch";
import { enqueueRealtimeEventInTx, realtimeEvent } from "./realtimeOutbox";

/** Holds change sellability without changing physical stock, so inventory triggers do not fire. */
export async function notifyLotAvailabilityInTx(
  c: PoolClient,
  tenantId: string,
  actorId: string,
  lot: { id: string; location_id: string },
  change: "HOLD" | "RELEASE",
) {
  const now = new Date().toISOString();
  await enqueueRealtimeEventInTx(c, realtimeEvent({
    eventId: randomUUID(),
    eventType: "inventory.changed",
    tenantId,
    locationId: lot.location_id,
    actorType: "ADMIN",
    actorId,
    entityType: "inventory_lot",
    entityId: lot.id,
    occurredAt: now,
    updatedAt: now,
    payload: { change, source: "operations.quality" },
  }));
}

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
