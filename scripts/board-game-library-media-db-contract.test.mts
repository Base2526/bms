import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { query } from "../apps/web/lib/db.ts";
import { createBoardGameTitle, createBoardGameCopy, listBoardGameLibrary } from "../apps/web/lib/bms/boardGameCafe.ts";
import { setBoardGameTitleImage } from "../apps/web/lib/bms/boardGameLibraryMedia.ts";
import { deleteStoredFile } from "../apps/web/lib/storage.ts";

test("title images are tenant-owned, audited and independent from playable copies", async () => {
  const ids: string[] = [];
  try {
    const migration = readFileSync(new URL("../db/migrations/10.42__bms_board_game_library_images.sql", import.meta.url), "utf8");
    const legacy = process.env.BMS_LIBRARY_EXPECT_LEGACY === "1";
    if (!legacy) { await query(migration); await query(migration); }
    for (let i = 0; i < 2; i++) {
      const tenant = (await query(`INSERT INTO bms_tenants(name,slug) VALUES('FAKE library test',$1) RETURNING id`, [`fake-library-${Date.now()}-${i}`])).rows[0].id;
      ids.push(tenant);
      await query(`INSERT INTO bms_store_profile(tenant_id,business_archetype) VALUES($1,'board_game_cafe')`, [tenant]);
    }
    const [tenant, other] = ids;
    const actor = String((await query(`INSERT INTO users(name,username,email,role,tenant_id,password_hash,fake_test)
      VALUES('FAKE library admin',$1,$1,'Administrator',$2,'x',TRUE) RETURNING id`, [`fake-library-${Date.now()}@example.invalid`, tenant])).rows[0].id);
    const location = (await query(`INSERT INTO bms_locations(tenant_id,code,name) VALUES($1,'MAIN','FAKE branch') RETURNING id`, [tenant])).rows[0].id;
    const title = await createBoardGameTitle(tenant, { title: "FAKE Azul" }, actor);
    const copy = await createBoardGameCopy(tenant, { titleId: title.id, locationId: location, copyCode: "FAKE-AZ-001" }, actor);
    const original = (await listBoardGameLibrary(tenant, location))[0];
    assert.equal(original.imageUrl, null);
    const sharp = createRequire(new URL("../apps/web/package.json", import.meta.url))("sharp");
    const bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: "green" } }).png().toBuffer();
    if (legacy) {
      await assert.rejects(setBoardGameTitleImage(tenant, title.id, bytes, actor), /10\.42/);
      assert.equal((await query(`SELECT count(*)::int AS n FROM files WHERE tenant_id=$1`, [tenant])).rows[0].n, 0);
      assert.deepEqual((await listBoardGameLibrary(tenant, location))[0].copies, original.copies);
      return;
    }
    await assert.rejects(setBoardGameTitleImage(other, title.id, bytes, actor), /ไม่พบเกม/);
    assert.equal((await query(`SELECT count(*)::int AS n FROM files WHERE tenant_id=$1`, [other])).rows[0].n, 0);
    const saved = await setBoardGameTitleImage(tenant, title.id, bytes, actor);
    assert.match(saved.imageUrl!, /^\/api\/files\/\d+$/);
    const fileId = Number(saved.imageUrl!.split("/").at(-1));
    const file = (await query(`SELECT tenant_id,visibility,mimetype FROM files WHERE id=$1`, [fileId])).rows[0];
    assert.equal(file.tenant_id, tenant); assert.equal(file.visibility, "public"); assert.equal(file.mimetype, "image/webp");
    const updated = (await listBoardGameLibrary(tenant, location))[0];
    assert.equal(updated.imageUrl, saved.imageUrl);
    assert.deepEqual(updated.copies, original.copies);
    assert.equal(updated.copies[0].id, copy.id);
    await assert.rejects(setBoardGameTitleImage(other, title.id, null, actor), /ไม่พบเกม/);
    await createBoardGameTitle(tenant, { title: "FAKE Azul", minPlayers: 2 }, actor);
    assert.equal((await listBoardGameLibrary(tenant, location))[0].imageUrl, saved.imageUrl, "title edits preserve artwork");
    await setBoardGameTitleImage(tenant, title.id, null, actor);
    assert.equal((await listBoardGameLibrary(tenant, location))[0].imageUrl, null);
    assert.equal((await query(`SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND action='board_game.title_image'`, [tenant])).rows[0].n, 2);
    for (const table of ["bms_inventory", "bms_orders", "bms_board_game_session_games"]) {
      assert.equal((await query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [tenant])).rows[0].n, 0);
    }
  } finally {
    if (ids.length) {
      const files = await query(`SELECT relpath FROM files WHERE tenant_id=ANY($1::uuid[])`, [ids]);
      for (const file of files.rows) await deleteStoredFile(file.relpath);
      for (const table of ["bms_board_game_copies", "bms_board_game_titles", "files", "bms_store_profile", "bms_locations", "bms_audit_log", "users"]) {
        await query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [ids]);
      }
      await query(`DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])`, [ids]);
    }
  }
});
