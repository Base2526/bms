import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "./testing/pg.mjs";
import { upsertMasterBank, upsertMasterThaiAddress } from "../apps/web/lib/bms/masterData.ts";
import { closeDatabasePool } from "../apps/web/lib/db.ts";

const pool = new Pool({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, max: 1,
});
test.after(() => pool.end());
test.after(() => closeDatabasePool());

test("the real editor service commits its audit with the master and denies an ordinary administrator", async () => {
  const tenantId=randomUUID(), actor=randomUUID();
  const bankId=randomUUID(), provinceId=randomUUID();
  const code=`A${actor.replaceAll('-','').slice(0,9)}`.toUpperCase();
  const ctx={scope:"admin",admin:{id:actor,email:`${actor}@example.invalid`,tenant_id:tenantId}};
  try {
    await pool.query(`INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE master editor',$2)`,[tenantId,`audit86-${tenantId}`]);
    await pool.query(`INSERT INTO users(id,name,username,email,password_hash,is_platform_admin,fake_test,tenant_id)
      VALUES($1,'FAKE master editor',$2,$2,'x',true,true,$3)`,[actor,ctx.admin.email,tenantId]);
    const input={id:bankId,code,countryCode:"TH",nameTh:"ทดสอบ",nameEn:"Audit bank"};
    assert.equal((await upsertMasterBank(ctx,input)).id,bankId);
    await upsertMasterBank(ctx,{...input,nameEn:"Audit bank edited"});
    const province=await upsertMasterThaiAddress(ctx,{id:provinceId,level:"PROVINCE",code,nameTh:"กรุงเทพมหานคร",nameEn:"Audit province"});
    assert.equal(province.level,"PROVINCE");
    assert.equal((await pool.query(`SELECT zone FROM bms_master_th_shipping_zones WHERE province_code=$1`,[code])).rows[0].zone,"BANGKOK");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND target=$2`,[tenantId,bankId])).rows[0].n,2);
    const history=(await pool.query(`SELECT editor_id,revision_id FROM bms_master_banks_revisions WHERE snapshot->>'id'=$1`,[bankId])).rows;
    assert.equal(history.length,1); assert.equal(history[0].editor_id,actor); assert.ok(history[0].revision_id);
    const invalidAuditTenant={...ctx,admin:{...ctx.admin,tenant_id:randomUUID()}};
    await assert.rejects(()=>upsertMasterBank(invalidAuditTenant,{...input,nameEn:"Must roll back"}));
    assert.equal((await pool.query(`SELECT name_en FROM bms_master_banks WHERE id=$1`,[bankId])).rows[0].name_en,"Audit bank edited");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM bms_master_banks_revisions WHERE snapshot->>'id'=$1`,[bankId])).rows[0].n,1);
    await pool.query(`UPDATE users SET is_platform_admin=false WHERE id=$1`,[actor]);
    await assert.rejects(()=>upsertMasterBank(ctx,{...input,nameEn:"Forbidden"}),/เฉพาะแอดมินแพลตฟอร์มเท่านั้น/);
    assert.equal((await pool.query(`SELECT name_en FROM bms_master_banks WHERE id=$1`,[bankId])).rows[0].name_en,"Audit bank edited");
  } finally {
    await pool.query(`DELETE FROM bms_master_th_shipping_zones WHERE province_code=$1`,[code]);
    await pool.query(`DELETE FROM bms_master_th_provinces WHERE id=$1`,[provinceId]);
    await pool.query(`DELETE FROM bms_master_banks_revisions WHERE snapshot->>'id'=$1`,[bankId]);
    await pool.query(`DELETE FROM bms_master_banks WHERE id=$1`,[bankId]);
    await pool.query(`DELETE FROM users WHERE id=$1`,[actor]);
    await pool.query(`DELETE FROM bms_tenants WHERE id=$1`,[tenantId]);
  }
});

test("all Phase 1/3 editor functions work as bms_app and preserve revision provenance", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actor = randomUUID();
    const revision = randomUUID();
    // Rollback-only fixture, never change a real account's platform permissions.
    await client.query(`INSERT INTO users(id,name,username,email,password_hash,is_platform_admin,fake_test)
      VALUES($1,'FAKE master write',$2,$2,'x',true,true)`, [actor, `${actor}@example.invalid`]);
    await client.query(`SELECT set_config('app.editor_id',$1,true),set_config('app.revision_id',$2,true)`, [actor, revision]);
    await client.query("SET LOCAL ROLE bms_app");
    const cases = [
      { table: "banks", fn: "upsert_master_bank", args: [null,"AUDIT86","TH","ทดสอบ","Audit bank",null,true,0,"test","audit86"] },
      { table: "units", fn: "upsert_master_unit", args: [null,"Z86","TH","ทดสอบ","Audit unit",[],"COUNT",1,true,"test","audit86"] },
      { table: "th_provinces", fn: "upsert_master_th_province", args: [null,"AUDIT86","ทดสอบ","Audit province",true,"test","audit86"] },
      { table: "th_districts", fn: "upsert_master_th_district", args: [null,"AUDIT8601","AUDIT86","ทดสอบ","Audit district",true,"test","audit86"] },
      { table: "th_subdistricts", fn: "upsert_master_th_subdistrict", args: [null,"AUDIT860101","AUDIT86","AUDIT8601","ทดสอบ","Audit subdistrict","10000",true,"test","audit86"] },
      { table: "carriers", fn: "upsert_master_carrier", args: [null,"AUDIT86","TH","ทดสอบ","Audit carrier",null,null,"NONE",true,"test","audit86"] },
    ];
    for (const fixture of cases) {
      const sql = `SELECT * FROM public.${fixture.fn}(${fixture.args.map((_, i) => `$${i+1}`).join(",")})`;
      const inserted = await client.query(sql, fixture.args);
      assert.equal(inserted.rowCount, 1, fixture.fn);
      const args = [...fixture.args]; args[0] = inserted.rows[0].id;
      const updated = await client.query(sql, args);
      assert.equal(updated.rows[0].id, inserted.rows[0].id);
      const history = await client.query(`SELECT editor_id,revision_id FROM bms_master_${fixture.table}_revisions
        WHERE snapshot->>'id'=$1`, [inserted.rows[0].id]);
      assert.deepEqual(history.rows, [{editor_id:actor,revision_id:revision}], fixture.fn);
      // Six isolated DB mutants: removing the definer boundary must break each
      // restricted writer. The savepoint restores the function and role even
      // though the deliberately failing statement aborts its subtransaction.
      const signature=(await client.query(`SELECT oid::regprocedure::text AS signature FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname=$1`,[fixture.fn])).rows[0].signature;
      await client.query("SAVEPOINT invoker_mutant");
      await client.query("RESET ROLE");
      await client.query(`ALTER FUNCTION ${signature} SECURITY INVOKER`);
      await client.query("SET LOCAL ROLE bms_app");
      await assert.rejects(()=>client.query(sql,args),(e:any)=>e.code==='42501',fixture.fn);
      await client.query("ROLLBACK TO SAVEPOINT invoker_mutant");
    }
    await client.query(`SELECT public.ensure_master_province_shipping_zone('AUDIT86','UPCOUNTRY')`);
    await client.query(`SELECT public.ensure_master_province_shipping_zone('AUDIT86','BANGKOK')`);
    assert.equal((await client.query(`SELECT zone FROM bms_master_th_shipping_zones WHERE province_code='AUDIT86'`)).rows[0].zone,"UPCOUNTRY");
    await client.query("SAVEPOINT deny_direct");
    await assert.rejects(() => client.query(`UPDATE bms_master_banks SET active=false WHERE code='AUDIT86'`), (e:any)=>e.code==='42501');
    await client.query("ROLLBACK TO SAVEPOINT deny_direct");
    await client.query(`SELECT set_config('app.editor_id','',true)`);
    for (const fixture of cases) {
      await client.query("SAVEPOINT deny_editor");
      await assert.rejects(() => client.query(`SELECT * FROM public.${fixture.fn}(${fixture.args.map((_,i)=>`$${i+1}`).join(",")})`,fixture.args), (e:any)=>e.code==='42501');
      await client.query("ROLLBACK TO SAVEPOINT deny_editor");
    }
  } finally {
    await client.query("ROLLBACK"); client.release();
  }
});
