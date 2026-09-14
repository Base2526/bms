import { userCanAccessLocation } from "@/lib/bms/locations";

export type BoardGameRouteActor = {
  tenantId: string;
  adminId: string | number;
};

export async function canAccessBoardGameLocation(
  actor: BoardGameRouteActor,
  locationId: string | null | undefined
) {
  return Boolean(
    locationId && await userCanAccessLocation(actor.tenantId, String(actor.adminId), locationId)
  );
}
