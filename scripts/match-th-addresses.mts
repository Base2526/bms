import process from "node:process";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const option = (name: string) => argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1).trim();
const tenantId = option("--tenant-id");
const actorId = option("--actor-id");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!tenantId || !uuid.test(tenantId)) throw new Error("--tenant-id=<uuid> is required");
if (apply && (!actorId || !uuid.test(actorId))) throw new Error("Apply refused: --actor-id=<uuid> is required for revision and audit");

type Candidate = { province_code:string;district_code:string;subdistrict_code:string;province:string;district:string;subdistrict:string;postcode:string };
async function candidates(client: PoolClient, text: string): Promise<Candidate[]> {
  const result = await client.query(
    `SELECT p.code province_code,d.code district_code,s.code subdistrict_code,
            p.name_th province,d.name_th district,s.name_th subdistrict,s.postcode
       FROM bms_master_th_subdistricts s
       JOIN bms_master_th_districts d ON d.code=s.district_code AND d.province_code=s.province_code
       JOIN bms_master_th_provinces p ON p.code=s.province_code
      WHERE p.active AND d.active AND s.active
        AND position(lower(p.name_th) in lower($1))>0
        AND position(lower(d.name_th) in lower($1))>0
        AND position(lower(s.name_th) in lower($1))>0
        AND (position(s.postcode in $1)>0 OR $1 !~ '[0-9]{5}')
      ORDER BY p.code,d.code,s.code LIMIT 2`, [text]);
  return result.rows;
}

const dbHost = process.env.POSTGRES_HOST?.trim();
const dbName = process.env.POSTGRES_DB?.trim();
const dbUser = process.env.POSTGRES_USER?.trim();
if (!dbHost || !dbName || !dbUser) {
  throw new Error("POSTGRES_HOST, POSTGRES_DB and POSTGRES_USER are required; no database defaults are allowed");
}
const pool = new Pool({ host:dbHost,port:Number(process.env.POSTGRES_PORT||5432),
  database:dbName,user:dbUser,password:process.env.POSTGRES_PASSWORD,max:1 });
const client = await pool.connect();
const report: Array<{table:string;id:string;confidence:"EXACT"|"AMBIGUOUS"|"NONE";codes?:string[]}> = [];
try {
  await client.query("BEGIN");
  if (actorId) {
    await client.query(`SELECT set_config('app.editor_id',$1,true)`,[actorId]);
    await client.query(`SELECT set_config('app.revision_id',$1,true)`,[randomUUID()]);
  }
  const sources = [
    { table:"bms_customer_addresses", sql:`SELECT id::text,address FROM bms_customer_addresses WHERE tenant_id=$1 AND province_code IS NULL AND address IS NOT NULL` },
    { table:"bms_locations", sql:`SELECT id::text,address FROM bms_locations WHERE tenant_id=$1 AND province_code IS NULL AND address IS NOT NULL` },
    { table:"bms_store_profile", sql:`SELECT tenant_id::text id,address FROM bms_store_profile WHERE tenant_id=$1 AND province_code IS NULL AND address IS NOT NULL` },
  ];
  for (const source of sources) {
    const rows = await client.query(source.sql,[tenantId]);
    for (const row of rows.rows) {
      const found = await candidates(client,row.address);
      const confidence = found.length===1?"EXACT":found.length>1?"AMBIGUOUS":"NONE";
      report.push({table:source.table,id:row.id,confidence,codes:found.map(v=>v.subdistrict_code)});
      if (!apply || found.length!==1) continue;
      const v=found[0];
      await client.query(`UPDATE ${source.table} SET province_code=$3,district_code=$4,subdistrict_code=$5,
        province=$6,district=$7,subdistrict=$8,postcode=$9 WHERE tenant_id=$1 AND ${source.table==="bms_store_profile"?"tenant_id::text":"id::text"}=$2`,
        [tenantId,row.id,v.province_code,v.district_code,v.subdistrict_code,v.province,v.district,v.subdistrict,v.postcode]);
    }
  }
  if (apply) await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
    VALUES($1,$2,'master_data.address_match',$1,$3::jsonb)`,[tenantId,actorId,JSON.stringify({exact:report.filter(x=>x.confidence==="EXACT").length,ambiguous:report.filter(x=>x.confidence==="AMBIGUOUS").length,none:report.filter(x=>x.confidence==="NONE").length})]);
  await client.query(apply?"COMMIT":"ROLLBACK");
  console.log(JSON.stringify({mode:apply?"applied":"dry-run",tenantId,summary:{exact:report.filter(x=>x.confidence==="EXACT").length,
    ambiguous:report.filter(x=>x.confidence==="AMBIGUOUS").length,none:report.filter(x=>x.confidence==="NONE").length},rows:report},null,2));
} catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
finally { client.release(); await pool.end(); }
