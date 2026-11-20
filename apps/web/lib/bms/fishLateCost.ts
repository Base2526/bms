import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type FishLateCostInput = { lineNo:number; category:string; amount:string; reason:string;
  reference?:string|null; requestKey:string };
export class FishLateCostError extends Error {
  constructor(public code:string, message:string) { super(message); }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories=new Set(["TRANSPORT","ICE","HANDLING","OTHER"]);
export function validateFishLateCost(input:FishLateCostInput) {
  if (!input || !Number.isInteger(input.lineNo) || input.lineNo<1 || input.lineNo>100)
    throw new FishLateCostError("INVALID_LINE","เลือกรายการรับปลาให้ถูกต้อง");
  if (!categories.has(input.category)) throw new FishLateCostError("INVALID_CATEGORY","ประเภทค่าใช้จ่ายไม่ถูกต้อง");
  if (typeof input.amount!=="string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(input.amount) || /^0(?:\.0{1,2})?$/.test(input.amount))
    throw new FishLateCostError("INVALID_AMOUNT","จำนวนเงินต้องมากกว่า 0 บาท และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  if (typeof input.reason!=="string" || !input.reason.trim() || input.reason.trim().length>1000)
    throw new FishLateCostError("INVALID_REASON","ระบุเหตุผลไม่เกิน 1,000 ตัวอักษร");
  if (input.reference!=null && (typeof input.reference!=="string" || input.reference.trim().length>200))
    throw new FishLateCostError("INVALID_REFERENCE","หลักฐานอ้างอิงยาวเกิน 200 ตัวอักษร");
  if (typeof input.requestKey!=="string" || input.requestKey.length<16 || input.requestKey.length>128)
    throw new FishLateCostError("INVALID_KEY","รหัสคำขอไม่ถูกต้อง");
  const [whole,fraction=""]=input.amount.split(".");
  return {lineNo:input.lineNo,category:input.category,amount:`${whole}.${fraction.padEnd(2,"0")}`,
    reason:input.reason.trim(),reference:input.reference?.trim()||null,requestKey:input.requestKey};
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cents=(value:string)=>{const [whole,fraction=""]=value.split(".");return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));};
const baht=(value:bigint)=>`${value/100n}.${String(value%100n).padStart(2,"0")}`;
const micro=(value:string)=>{const [whole,fraction=""]=value.split(".");return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"));};
const money6=(value:bigint)=>`${value/1000000n}.${String(value%1000000n).padStart(6,"0")}`;
type Row={id:string;line_id:string;location_id:string;sku:string;size:string;extra_amount:string;
  value:string|null;version:string;qty:string;current_stock:string;received_grams:string;movement_id:string};

async function stateInTx(client:PoolClient, tenant:string, actor:string, intakeId:string, lineNo:number):Promise<Row> {
  const row=(await client.query<Row>(`SELECT h.id,l.id::text AS line_id,h.location_id,l.sku,l.size,
        l.extra_amount::text AS extra_amount,v.value::text AS value,v.version::text AS version,
        v.qty::text AS qty,i.current_stock::text,l.received_grams::text,l.movement_id::text
      FROM bms_fish_intakes h JOIN bms_fish_intake_lines l ON l.tenant_id=h.tenant_id AND l.intake_id=h.id
      JOIN bms_inventory_values v ON v.tenant_id=h.tenant_id AND v.location_id=h.location_id
        AND v.product_sku=l.sku AND v.size=l.size
      JOIN bms_inventory i ON i.tenant_id=v.tenant_id AND i.location_id=v.location_id
        AND i.product_sku=v.product_sku AND i.size=v.size
      WHERE h.tenant_id=$1 AND h.id=$2 AND h.kind='LIVE' AND l.line_no=$3
        AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$4)
          OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a
            WHERE a.tenant_id=$1 AND a.user_id=$4 AND a.location_id=h.location_id))
      FOR UPDATE OF v`,[tenant,intakeId,lineNo,actor])).rows[0];
  if (!row) throw new FishLateCostError("INTAKE_LINE_NOT_FOUND","ไม่พบรายการรับปลา LIVE ที่เข้าถึงได้");
  if (!row.movement_id) throw new FishLateCostError("MOVEMENT_REVIEW_REQUIRED","ใบรับปลาไม่มีหลักฐานสต็อกที่ครบถ้วน");
  const origin=(await client.query<{qty:string;amount:string|null}>(`SELECT qty::text,amount::text
    FROM bms_inventory_value_entries WHERE tenant_id=$1 AND movement_id=$2 AND fish_intake_line_id=$3
      AND kind='STOCK_IN'`,[tenant,row.movement_id,row.line_id])).rows[0];
  if (!origin || origin.amount==null || origin.qty!==row.received_grams)
    throw new FishLateCostError("VALUATION_SOURCE_REVIEW_REQUIRED","หลักฐานมูลค่าตอนรับปลาไม่ครบ ต้องตรวจสอบก่อนเพิ่มต้นทุน");
  const currency=(await client.query<{currency:string|null}>(`SELECT currency FROM bms_store_profile
    WHERE tenant_id=$1`,[tenant])).rows[0]?.currency;
  if (currency!=="THB") throw new FishLateCostError("STORE_CURRENCY_REQUIRED","ตั้งสกุลเงินร้านเป็นบาท (THB) ก่อนเพิ่มต้นทุนปลา");
  if (row.value==null) throw new FishLateCostError("VALUATION_UNKNOWN","ยังไม่ทราบมูลค่าสต็อก จึงเพิ่มต้นทุนไม่ได้");
  if (row.qty!==row.current_stock)
    throw new FishLateCostError("STOCK_REVIEW_REQUIRED","ยอดสต็อกกับมูลค่าสต็อกไม่ตรงกัน ต้องตรวจสอบก่อนเพิ่มต้นทุน");
  if (BigInt(row.qty)<=0n) throw new FishLateCostError("STOCK_ALREADY_CONSUMED","สต็อกนี้ขายหรือใช้หมดแล้ว ต้องตรวจต้นทุนย้อนหลังด้วยวิธีเฉพาะ");
  const lots=(await client.query<{qty:string}>(`SELECT COALESCE(SUM(qty),0)::text AS qty
    FROM bms_inventory_lots WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
    [tenant,row.location_id,row.sku,row.size])).rows[0];
  if (lots.qty!==row.qty) throw new FishLateCostError("LOT_REVIEW_REQUIRED","ยอดล็อตกับสต็อกไม่ตรงกัน ต้องตรวจสอบก่อนเพิ่มต้นทุน");
  const latest=(await client.query<{later:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM bms_stock_movements m
       WHERE m.tenant_id=$1 AND m.location_id=$2 AND m.product_sku=$3 AND m.size=$4
         AND m.type NOT IN ('RESERVE','RELEASE')
         AND m.id > (SELECT max(movement_id) FROM bms_fish_intake_lines
           WHERE tenant_id=$1 AND intake_id=$5)
    ) AS later`,[tenant,row.location_id,row.sku,row.size,intakeId])).rows[0];
  if (latest?.later) throw new FishLateCostError("LATER_STOCK_ACTIVITY_REVIEW_REQUIRED",
    "มีการขาย คืน รับเพิ่ม หรือปรับสต็อกหลังใบนี้ ระบบยังจัดสรรต้นทุนย้อนหลังอย่างตรวจสอบไม่ได้");
  return row;
}

export async function fishLateCost(tenant:string,actor:string,intakeId:string,raw:FishLateCostInput,
  action:"preview"|"commit",confirmed=false,previewHash?:string) {
  if (!UUID.test(intakeId)) throw new FishLateCostError("INVALID_INTAKE","เลขใบรับปลาไม่ถูกต้อง");
  const input=validateFishLateCost(raw);
  const requestHash=hash({intakeId,...input,requestKey:undefined});
  const client=await getClient();
  try {
    await beginTenantTx(client,tenant,{editorId:actor});
    // Serialize retries and separate concurrent corrections to the same valuation balance.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,10138))",[`${tenant}:${input.requestKey}`]);
    const prior=(await client.query<{id:string;request_hash:string;intake_id:string;visible:boolean}>(`
      SELECT a.id,a.request_hash,a.intake_id,(
        NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations r WHERE r.tenant_id=$1 AND r.user_id=$3)
        OR EXISTS(SELECT 1 FROM bms_user_allowed_locations r
          WHERE r.tenant_id=$1 AND r.user_id=$3 AND r.location_id=h.location_id)) AS visible
      FROM bms_fish_late_cost_adjustments a
      JOIN bms_fish_intakes h ON h.tenant_id=a.tenant_id AND h.id=a.intake_id
      WHERE a.tenant_id=$1 AND a.request_key=$2`,[tenant,input.requestKey,actor])).rows[0];
    if (prior) {
      if (prior.intake_id!==intakeId || !prior.visible)
        throw new FishLateCostError("IDEMPOTENCY_CONFLICT","รหัสคำขอนี้เคยใช้กับข้อมูลอื่นแล้ว");
      if (prior.request_hash!==requestHash) throw new FishLateCostError("IDEMPOTENCY_CONFLICT","รหัสคำขอนี้เคยใช้กับข้อมูลอื่นแล้ว");
      await client.query("COMMIT");
      return {status:"REPLAYED" as const,adjustmentId:prior.id};
    }
    const row=await stateInTx(client,tenant,actor,intakeId,input.lineNo);
    if (row.value==null) throw new FishLateCostError("VALUATION_UNKNOWN","ยังไม่ทราบมูลค่าสต็อก จึงเพิ่มต้นทุนไม่ได้");
    const priorCost=(await client.query<{amount:string}>(`SELECT COALESCE(SUM(amount),0)::text AS amount
      FROM bms_fish_late_cost_adjustments WHERE tenant_id=$1 AND intake_line_id=$2`,[tenant,row.line_id])).rows[0];
    const oldCents=cents(row.extra_amount)+cents(priorCost.amount);
    const addCents=cents(input.amount);
    const old=baht(oldCents),next=baht(oldCents+addCents);
    const currentHash=hash({requestHash,version:row.version,old,valuation:row.value,qty:row.qty});
    const output={lineNo:input.lineNo,originalExtraAmount:row.extra_amount,priorAdjustments:priorCost.amount,
      currentExtraCost:old,addedAmount:input.amount,newExtraCost:next,valuationBefore:row.value,
      valuationAfter:money6(micro(row.value)+addCents*10000n),stockQty:Number(row.qty),previewHash:currentHash};
    if (action==="preview") {await client.query("COMMIT");return {status:"PREVIEW" as const,...output};}
    if (!confirmed || previewHash!==currentHash) throw new FishLateCostError("PREVIEW_STALE","ข้อมูลต้นทุนเปลี่ยนหลังตรวจ กรุณาตรวจยอดใหม่ก่อนยืนยัน");
    const updated=(await client.query<{value:string}>(`UPDATE bms_inventory_values
      SET value=value+$5::numeric,version=version+1
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4
      RETURNING value::text`,[tenant,row.location_id,row.sku,row.size,input.amount])).rows[0];
    const saved=(await client.query<{id:string}>(`INSERT INTO bms_fish_late_cost_adjustments
      (tenant_id,intake_id,intake_line_id,request_key,request_hash,category,amount,reason,reference,
       valuation_before,valuation_after,stock_qty_at_commit,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [tenant,intakeId,row.line_id,input.requestKey,requestHash,input.category,input.amount,input.reason,input.reference,
        row.value,updated.value,row.qty,actor])).rows[0];
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES($1,$2,'fish.cost.adjust',$3,$4::jsonb)`,[tenant,`user:${actor}`,saved.id,
      JSON.stringify({intakeId,lineNo:input.lineNo,amount:input.amount,category:input.category})]);
    await client.query("COMMIT");
    return {status:"SAVED" as const,adjustmentId:saved.id,...output};
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}
