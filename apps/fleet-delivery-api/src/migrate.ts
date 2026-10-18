import path from "node:path";
import { createDatabasePool, runMigrations } from "@bms/fleet-delivery-database";
import { requiredEnv } from "@bms/fleet-delivery-shared";

const pool = createDatabasePool(requiredEnv("FLEET_DELIVERY_MIGRATION_DATABASE_URL"), 1);
const migrationsDir = process.env.FLEET_DELIVERY_MIGRATIONS_DIR?.trim()
  || path.resolve(process.cwd(), "packages/fleet-delivery-database/migrations");
try {
  const applied = await runMigrations(pool, migrationsDir);
  console.log(JSON.stringify({ component: "fleet-delivery-migrations", applied }));
} finally {
  await pool.end();
}
