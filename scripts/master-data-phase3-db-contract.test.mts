import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "./testing/pg.mjs";

const pool=new Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
test.after(async()=>pool.end());

test("phase 3 carrier seed and shipment snapshots exist",async()=>{
  const carriers=await pool.query(`SELECT code,integration_status FROM bms_master_carriers ORDER BY code`);
  assert.equal(carriers.rowCount,6);
  assert.equal(carriers.rows.find((row)=>row.code==="FLASH")?.integration_status,"MOCK");
  assert.equal(carriers.rows.find((row)=>row.code==="KERRY")?.integration_status,"MOCK");
  const columns=await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='bms_shipments' AND column_name IN ('carrier_name','tracking_url','tracking_no_warning')`);
  assert.equal(columns.rowCount,3);
});

test("every imported province has one default shipping zone",async()=>{
  const result=await pool.query(`SELECT
    (SELECT count(*)::int FROM bms_master_th_provinces) provinces,
    (SELECT count(*)::int FROM bms_master_th_shipping_zones) zones,
    (SELECT count(*)::int FROM bms_master_th_provinces p LEFT JOIN bms_master_th_shipping_zones z ON z.province_code=p.code WHERE z.province_code IS NULL) missing`);
  assert.equal(result.rows[0].zones,result.rows[0].provinces);
  assert.equal(result.rows[0].missing,0);
});

test("shipping-zone overrides have forced RLS",async()=>{
  const result=await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='bms_shipping_zone_overrides'::regclass`);
  assert.equal(result.rows[0].relrowsecurity,true);
  assert.equal(result.rows[0].relforcerowsecurity,true);
});
