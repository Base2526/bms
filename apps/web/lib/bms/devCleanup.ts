import { getClient } from "@/lib/db";

/**
 * Delete seeded staff accounts that have not become part of protected business history.
 *
 * User foreign keys deliberately have mixed delete policies: disposable account-owned rows
 * cascade, attribution fields may become null, while durable operational history is restrictive.
 * Let those database policies decide per user instead of duplicating every current and future FK
 * in the dev cleanup route.
 */
type FakeUserCleanupResult = { deletedIds: string[]; referencedIds: string[] };

async function deleteUnreferencedFakeUsersByScope(
  tenantId: string,
  scope: "all" | "seeded-staff"
): Promise<FakeUserCleanupResult> {
  const client = await getClient();
  const deletedIds: string[] = [];
  const referencedIds: string[] = [];
  const seededStaffOnly = scope === "seeded-staff";

  try {
    await client.query("BEGIN");
    const candidates = await client.query<{ id: string }>(
      `SELECT id FROM users
        WHERE fake_test = true AND tenant_id = $1
          AND (NOT $2::boolean OR email LIKE '%@staff.bms.test')
        ORDER BY id
        FOR UPDATE`,
      [tenantId, seededStaffOnly]
    );

    // A seeded staff account may have been used in a real POS/operations flow after seeding.
    // Test each user inside a savepoint so one protected history row does not abort cleanup for
    // every other fixture.
    for (const { id } of candidates.rows) {
      await client.query("SAVEPOINT delete_fake_user");
      try {
        const result = await client.query<{ id: string }>(
          `DELETE FROM users
            WHERE id = $1 AND tenant_id = $2 AND fake_test = true
            RETURNING id`,
          [id, tenantId]
        );
        await client.query("RELEASE SAVEPOINT delete_fake_user");
        if (result.rows[0]) deletedIds.push(result.rows[0].id);
      } catch (error: any) {
        await client.query("ROLLBACK TO SAVEPOINT delete_fake_user");
        await client.query("RELEASE SAVEPOINT delete_fake_user");
        if (error?.code !== "23503") throw error;
        referencedIds.push(id);
      }
    }

    await client.query("COMMIT");
    return { deletedIds, referencedIds };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** Cleanup used by the global fake-data action, including fixtures from the standalone user seeder. */
export async function deleteUnreferencedFakeUsers(tenantId: string): Promise<FakeUserCleanupResult> {
  return deleteUnreferencedFakeUsersByScope(tenantId, "all");
}

/**
 * Replace scenario staff without deleting the demo shop's seeded Administrator account.
 * Both are fake_test rows, but only seedFakeStaff() accounts use this controlled email suffix.
 */
export async function deleteUnreferencedFakeStaff(tenantId: string): Promise<FakeUserCleanupResult> {
  return deleteUnreferencedFakeUsersByScope(tenantId, "seeded-staff");
}
