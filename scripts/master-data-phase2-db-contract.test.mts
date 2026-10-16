import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const pool=new Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
test.after(async()=>pool.end());

test("phase 2 structured columns exist and remain nullable for legacy rows",async()=>{
  const result=await pool.query(`SELECT table_name,column_name,is_nullable FROM information_schema.columns
    WHERE (table_name,column_name) IN (('bms_store_profile','province_code'),('bms_locations','subdistrict_code'),
      ('bms_customer_addresses','district'),('bms_tax_documents','buyer_province_code')) ORDER BY 1,2`);
  assert.equal(result.rowCount,4);
  assert.ok(result.rows.every(row=>row.is_nullable==="YES"));
});

test("tax document snapshots have master references without replacing buyer_address",async()=>{
  const result=await pool.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='bms_tax_documents' AND column_name='buyer_address') legacy,
    (SELECT count(*)::int FROM pg_constraint WHERE conrelid='bms_tax_documents'::regclass AND contype='f' AND conname LIKE 'bms_tax_documents_buyer_%_code_fkey') refs`);
  assert.equal(result.rows[0].legacy,true);
  assert.equal(result.rows[0].refs,3);
});
