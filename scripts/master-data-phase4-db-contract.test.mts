import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const pool=new Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
test.after(async()=>pool.end());

test("phase 4 reference seeds and grants exist",async()=>{
  assert.equal(Number((await pool.query(`SELECT count(*) FROM bms_master_tax_document_types`)).rows[0].count),8);
  assert.equal(Number((await pool.query(`SELECT rate FROM bms_master_vat_rates WHERE country_code='TH' AND DATE '2026-10-16' BETWEEN effective_from AND effective_to`)).rows[0].rate),7);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM bms_master_tax_buyer_types`)).rows[0].count),3);
  const privileges=await pool.query(`SELECT table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='bms_app' AND table_name LIKE 'bms_master_tax%'`);
  assert.ok(privileges.rows.some((row)=>row.table_name==='bms_master_tax_document_types'&&row.privilege_type==='SELECT'));
  assert.ok(!privileges.rows.some((row)=>row.privilege_type==='INSERT'||row.privilege_type==='UPDATE'||row.privilege_type==='DELETE'));
});

test("a future document-code version cannot change today's resolution",async()=>{
  await pool.query("BEGIN");
  try{
    await pool.query(`INSERT INTO bms_master_tax_document_types(code,name_th,name_en,bms_document_type,effective_from,source,source_version)
      VALUES('T05','future','future','FULL','2099-01-01','contract test','future')`);
    const today=await pool.query(`SELECT code FROM bms_master_tax_document_types WHERE active AND bms_document_type='FULL' AND effective_from<=DATE '2026-10-16' AND (effective_to IS NULL OR effective_to>=DATE '2026-10-16') ORDER BY effective_from DESC LIMIT 1`);
    const future=await pool.query(`SELECT code FROM bms_master_tax_document_types WHERE active AND bms_document_type='FULL' AND effective_from<=DATE '2099-01-01' AND (effective_to IS NULL OR effective_to>=DATE '2099-01-01') ORDER BY effective_from DESC LIMIT 1`);
    assert.equal(today.rows[0].code,'T03');assert.equal(future.rows[0].code,'T05');
  } finally { await pool.query("ROLLBACK"); }
});
