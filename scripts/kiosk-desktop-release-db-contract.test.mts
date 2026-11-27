/** Run only against an explicitly identified disposable restore of development data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getClient } from "../apps/web/lib/db.ts";

test("kiosk installer release migration reapply, FK, RLS and bms_app grants", {
  skip: process.env.BMS_KIOSK_RESTORED_DB !== "1" && "requires disposable restored development database",
}, async () => {
  const host = process.env.POSTGRES_HOST ?? "localhost";
  const database = process.env.POSTGRES_DB ?? "appdb";
  assert.match(host, /^(localhost|127\.0\.0\.1|::1)$/,
    "DB contract refuses a non-local database host");
  assert.match(database, /(restore|disposable|test)/i,
    "DB contract requires a named disposable restored/test database");
  const client = await getClient();
  const migration = await readFile(new URL("../db/migrations/10.147__bms_kiosk_desktop_releases.sql", import.meta.url), "utf8");
  const id = async (sql: string, params: unknown[]) =>
    (await client.query<{ id: string }>(sql, params)).rows[0].id;
  const reject = async (sql: string, params: unknown[], code: string) => {
    await client.query("SAVEPOINT expected_failure");
    try { await assert.rejects(client.query(sql, params), (error: unknown) =>
      (error as { code?: string }).code === code); }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(migration);
    const tag = `fake-kiosk-release-${randomUUID()}`;
    const tenant = await id("INSERT INTO bms_tenants(name,slug) VALUES($1,$1) RETURNING id", [tag]);
    const other = await id("INSERT INTO bms_tenants(name,slug) VALUES($1,$1) RETURNING id", [`${tag}-other`]);
    const branch = await id("INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id", [tenant, tag]);
    const otherBranch = await id("INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id", [other, `${tag}-other`]);
    const actor = await id(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test,is_platform_admin)
      SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE,TRUE FROM roles r WHERE r.name='Administrator' LIMIT 1 RETURNING id`,
    [tenant, tag, `${tag}@example.invalid`]);
    const file = (await client.query<{ id: number }>(`INSERT INTO files
      (filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id)
      VALUES('fake.exe','BMS-Kiosk-Setup-0.1.0-x64.exe','application/vnd.microsoft.portable-executable',4,$1,'fake/test', 'private',NULL)
      RETURNING id`, ["a".repeat(64)])).rows[0].id;
    const release = await id(`INSERT INTO bms_kiosk_desktop_releases
      (version,channel,file_id,original_name,size_bytes,sha256,signature_status,min_os,created_by)
      VALUES('0.1.0','pilot',$1,'BMS-Kiosk-Setup-0.1.0-x64.exe',4,$2,'INVALID','Windows 10 x64',$3)
      RETURNING id`, [file, "a".repeat(64), actor]);
    await reject(`INSERT INTO bms_kiosk_desktop_releases
      (version,channel,file_id,original_name,size_bytes,sha256,signature_status,min_os,created_by)
      VALUES('0.1.0','pilot',$1,'BMS-Kiosk-Setup-0.1.0-x64.exe',4,$2,'INVALID','Windows 10 x64',$3)`,
    [file, "a".repeat(64), actor], "23505");
    await reject(`UPDATE bms_kiosk_desktop_releases SET status='PUBLISHED' WHERE id=$1`, [release], "23514");
    await reject(`INSERT INTO bms_kiosk_desktop_release_branches
      (tenant_id,location_id,release_id,granted_by) VALUES($1,$2,$3,$4)`,
    [tenant, otherBranch, release, actor], "23503");
    await client.query(`INSERT INTO bms_kiosk_desktop_release_branches
      (tenant_id,location_id,release_id,granted_by) VALUES($1,$2,$3,$4)`,
    [tenant, branch, release, actor]);
    await reject(`INSERT INTO bms_kiosk_desktop_release_branches
      (tenant_id,location_id,release_id,granted_by) VALUES($1,$2,$3,$4)`,
    [tenant, branch, release, actor], "23505");
    await client.query(`UPDATE bms_kiosk_desktop_release_branches SET active=FALSE
      WHERE tenant_id=$1 AND location_id=$2 AND release_id=$3`, [tenant, branch, release]);
    await client.query("SET LOCAL ROLE bms_app");
    const count = async () => Number((await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM bms_kiosk_desktop_release_branches")).rows[0].n);
    assert.equal(await count(), 0);
    assert.equal(Number((await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM bms_kiosk_desktop_release_branches_revisions")).rows[0].n), 0);
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [other]);
    assert.equal(await count(), 0);
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [tenant]);
    assert.equal(await count(), 1);
    await client.query("SELECT id FROM bms_kiosk_desktop_releases WHERE id=$1", [release]);
    await reject("SELECT id FROM files WHERE id=$1", [file], "42501");
    const revisions = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM bms_kiosk_desktop_release_branches_revisions");
    assert.ok(Number(revisions.rows[0].n) >= 1);
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
});
