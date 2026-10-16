import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const pool = new Pool({host:process.env.POSTGRES_HOST||"localhost",port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||"appdb",user:process.env.POSTGRES_USER||"app",password:process.env.POSTGRES_PASSWORD||"app",max:1});

test.after(async()=>pool.end());

test("master tables have no tenant_id or RLS and bms_app has SELECT only", async()=>{
  const tables=["bms_master_banks","bms_master_units","bms_master_th_provinces","bms_master_th_districts","bms_master_th_subdistricts"];
  const meta=await pool.query(`SELECT c.relname,c.relrowsecurity,
    EXISTS(SELECT 1 FROM information_schema.columns x WHERE x.table_schema='public' AND x.table_name=c.relname AND x.column_name='tenant_id') has_tenant
    FROM pg_class c WHERE c.relname=ANY($1::text[])`,[tables]);
  assert.equal(meta.rowCount,tables.length);
  for(const row of meta.rows){assert.equal(row.relrowsecurity,false);assert.equal(row.has_tenant,false);}
  const grants=await pool.query(`SELECT table_name,privilege_type FROM information_schema.role_table_grants
    WHERE grantee='bms_app' AND table_name=ANY($1::text[])`,[tables]);
  for(const table of tables) assert.deepEqual(grants.rows.filter(r=>r.table_name===table).map(r=>r.privilege_type).sort(),["SELECT"]);
});

test("bms_app can read but cannot write master rows",async()=>{
  const client=await pool.connect();
  try{await client.query("BEGIN");await client.query("SET LOCAL ROLE bms_app");
    assert.ok((await client.query("SELECT count(*) FROM bms_master_banks")).rows.length===1);
    await assert.rejects(()=>client.query(`INSERT INTO bms_master_banks(code,country_code,name_th,name_en,source,source_version) VALUES('ZZZ','TH','x','x','test','test')`),(error:any)=>error?.code==="42501");
  }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release();}
});

test("active-bank changes do not rewrite payment-account snapshots",async()=>{
  const before=await pool.query(`SELECT tenant_id,payment_accounts FROM bms_store_profile WHERE payment_accounts<> '[]'::jsonb ORDER BY tenant_id LIMIT 1`);
  if(!before.rowCount)return;
  const client=await pool.connect();try{await client.query("BEGIN");const bank=await client.query(`SELECT id FROM bms_master_banks LIMIT 1`);if(!bank.rowCount)return;
    await client.query(`UPDATE bms_master_banks SET active=NOT active WHERE id=$1`,[bank.rows[0].id]);
    const after=await client.query(`SELECT payment_accounts FROM bms_store_profile WHERE tenant_id=$1`,[before.rows[0].tenant_id]);
    assert.deepEqual(after.rows[0].payment_accounts,before.rows[0].payment_accounts);
  }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release();}
});
