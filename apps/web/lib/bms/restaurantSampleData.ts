import { query } from "@/lib/db";
import {
  createRestaurantArea,
  createRestaurantTable,
  listRestaurantFloor,
} from "./restaurantPos";
import { resolveDefaultLocationId } from "./locations";

const SAMPLE_AREAS = [
  {
    name: "โซนในร้าน (ตัวอย่าง)",
    tables: [
      { name: "โต๊ะ 1", seats: 4, shape: "rect" as const },
      { name: "โต๊ะ 2", seats: 4, shape: "rect" as const },
      { name: "โต๊ะ 3", seats: 4, shape: "rect" as const },
      { name: "โต๊ะ 4", seats: 4, shape: "rect" as const },
      { name: "โต๊ะ 5", seats: 2, shape: "round" as const },
      { name: "โต๊ะ 6", seats: 2, shape: "round" as const },
    ],
  },
  {
    name: "โซนด้านนอก (ตัวอย่าง)",
    tables: [
      { name: "โต๊ะ 7", seats: 2, shape: "round" as const },
      { name: "โต๊ะ 8", seats: 2, shape: "round" as const },
    ],
  },
] as const;

export type RestaurantSampleFloorResult = {
  areasCreated: number;
  tablesCreated: number;
  skippedExistingFloor: boolean;
};

/**
 * Add a small, visibly labelled restaurant floor to an otherwise empty sample shop.
 *
 * The normal floor services remain the only write path so branch validation, layout
 * locking, audit rows and realtime invalidation stay identical to an operator-created
 * floor. A real floor is never mixed with sample tables. Exact-name checks make a
 * partially interrupted sample run safe to resume.
 */
export async function seedRestaurantSampleFloor(tenantId: string): Promise<RestaurantSampleFloorResult> {
  const [locationId, actor] = await Promise.all([
    resolveDefaultLocationId(tenantId),
    query<{ id: string }>(
      `SELECT id FROM users
        WHERE tenant_id = $1
        ORDER BY (role = 'Administrator') DESC, created_at, id
        LIMIT 1`,
      [tenantId]
    ),
  ]);
  const actorUserId = actor.rows[0]?.id;
  if (!locationId) throw new Error("ไม่พบสาขาสำหรับสร้างผังร้านอาหารตัวอย่าง");
  if (!actorUserId) throw new Error("ไม่พบผู้ดูแลสำหรับบันทึกผังร้านอาหารตัวอย่าง");

  let floor = await listRestaurantFloor(tenantId, locationId);
  const sampleNames = new Set(SAMPLE_AREAS.map((area) => area.name));
  const hasSampleArea = floor.areas.some((area) => sampleNames.has(area.name));
  if (!hasSampleArea && (floor.areas.length > 0 || floor.tables.length > 0)) {
    return { areasCreated: 0, tablesCreated: 0, skippedExistingFloor: true };
  }

  let areasCreated = 0;
  let tablesCreated = 0;
  for (const areaSpec of SAMPLE_AREAS) {
    let area = floor.areas.find((candidate) => candidate.name === areaSpec.name);
    if (!area) {
      area = await createRestaurantArea({ tenantId, actorUserId, locationId, name: areaSpec.name });
      areasCreated += 1;
      floor = await listRestaurantFloor(tenantId, locationId);
    }
    for (const tableSpec of areaSpec.tables) {
      const exists = floor.tables.some(
        (table) => table.areaId === area!.id && table.name === tableSpec.name
      );
      if (exists) continue;
      await createRestaurantTable({
        tenantId,
        actorUserId,
        locationId,
        areaId: area.id,
        ...tableSpec,
      });
      tablesCreated += 1;
      floor = await listRestaurantFloor(tenantId, locationId);
    }
  }

  return { areasCreated, tablesCreated, skippedExistingFloor: false };
}

