import { createHash } from "node:crypto";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { assertValuationLocation } from "./inventoryValuation";
import { recordMovement } from "./movements";
import { receiveLotInTx, validateTransferLotReceiptInTx } from "./lots";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

export type FishIntakeKind = "HISTORICAL" | "LIVE" | "OPENING";
export type FishIntakeLineInput = {
  sourceRow?: number | null;
  billDate?: string | null;
  receivedDate?: string | null;
  supplierName?: string | null;
  vesselRegistration?: string | null;
  fishName: string;
  billSize?: string | null;
  actualSize?: string | null;
  sku?: string | null;
  size?: string | null;
  billKg?: string | null;
  receivedKg: string;
  unitPricePerKg?: string | null;
  purchaseAmount: string;
  extraAmount?: string | null;
  quality?: string | null;
  note?: string | null;
  lotNo?: string | null;
  expiryDate?: string | null;
};
export type FishIntakeInput = {
  kind: FishIntakeKind;
  locationId?: string | null;
  requestKey: string;
  sourceName?: string | null;
  sourceSheet?: string | null;
  sourceYear?: number | null;
  note?: string | null;
  lines: FishIntakeLineInput[];
};
type ValidLine = FishIntakeLineInput & {
  billGrams: number | null;
  receivedGrams: number;
  purchaseAmountValue: string;
  extraAmountValue: string;
  unitPriceValue: string | null;
  lotNoValue: string | null;
};
export type FishIntakeResult = {
  status: "SAVED" | "REPLAYED";
  intakeId: string;
  lineCount: number;
  billGrams: number;
  receivedGrams: number;
  purchaseAmount: string;
  extraAmount: string;
};
export class FishIntakeError extends Error {
  constructor(public code: string, message: string, public line?: number) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const textField = (value: unknown, max: number): string | null => {
  if (value == null) return null;
  if (typeof value !== "string") throw new FishIntakeError("INVALID_TEXT", "ช่องข้อความไม่ถูกต้อง");
  const result = value.trim();
  if (result.length > max) throw new FishIntakeError("TEXT_TOO_LONG", `ข้อความยาวเกิน ${max} ตัวอักษร`);
  return result || null;
};
const dateField = (value: unknown): string | null => {
  const date = textField(value, 10);
  if (!date) return null;
  const parsed=ISO.test(date)?new Date(`${date}T00:00:00.000Z`):null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date)
    throw new FishIntakeError("INVALID_DATE", "วันที่ต้องเป็น YYYY-MM-DD ที่มีอยู่จริง");
  return date;
};
const grams = (value: unknown, required: boolean): number | null => {
  if (value == null || value === "") {
    if (required) throw new FishIntakeError("WEIGHT_REQUIRED", "ต้องระบุน้ำหนักเป็นกิโลกรัม");
    return null;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(value))
    throw new FishIntakeError("INVALID_WEIGHT", "น้ำหนักต้องเป็นกิโลกรัม ทศนิยมไม่เกิน 3 ตำแหน่ง");
  const [whole, fractional = ""] = value.split(".");
  const amount = Number(whole) * 1000 + Number(fractional.padEnd(3,"0"));
  if (!Number.isSafeInteger(amount) || (required && amount <= 0) || amount > 2147483647)
    throw new FishIntakeError("INVALID_WEIGHT", "น้ำหนักต้องมากกว่า 0 และไม่เกินขนาดที่ระบบรับได้");
  return amount;
};
const money = (value: unknown, defaultZero = false): string => {
  if ((value == null || value === "") && defaultZero) return "0.00";
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))
    throw new FishIntakeError("INVALID_AMOUNT", "จำนวนเงินต้องเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง");
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2,"0")}`;
};
const price = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(value))
    throw new FishIntakeError("INVALID_PRICE", "ราคาต่อกิโลต้องเป็นเลขบวก ทศนิยมไม่เกิน 4 ตำแหน่ง");
  return value;
};
const cents = (value: string): bigint => {
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
};
const amountFromCents = (value: bigint): string => `${value / 100n}.${String(value % 100n).padStart(2,"0")}`;

/** Pure boundary validation, also used by preview before any write. */
export function validateFishIntake(input: FishIntakeInput): { lines: ValidLine[]; totals: Omit<FishIntakeResult,"status"|"intakeId"> } {
  if (!(["HISTORICAL","LIVE","OPENING"] as string[]).includes(input.kind))
    throw new FishIntakeError("INVALID_KIND", "ชนิดรายการไม่ถูกต้อง");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 3000)
    throw new FishIntakeError("INVALID_LINES", "รายการต้องมี 1–3,000 แถว");
  if (typeof input.requestKey !== "string" || input.requestKey.length < 16 || input.requestKey.length > 128)
    throw new FishIntakeError("INVALID_KEY", "รหัสคำขอไม่ถูกต้อง");
  if (input.kind === "HISTORICAL" ? input.locationId != null : !input.locationId || !UUID.test(input.locationId))
    throw new FishIntakeError("INVALID_LOCATION", "สาขาไม่ถูกต้อง");
  if (input.kind !== "HISTORICAL" && input.lines.length > 100)
    throw new FishIntakeError("INVALID_LINES", "ใบรับปลาหนึ่งใบมีได้ไม่เกิน 100 รายการ");
  if (input.sourceYear != null && (!Number.isInteger(input.sourceYear) || input.sourceYear < 1900 || input.sourceYear > 2200))
    throw new FishIntakeError("INVALID_YEAR", "ปีข้อมูลไม่ถูกต้อง");
  textField(input.sourceName,255); textField(input.sourceSheet,100); textField(input.note,1000);
  let received = 0;
  let billed = 0;
  let purchase = 0n;
  let extra = 0n;
  const lines = input.lines.map((raw, index): ValidLine => {
    try {
      if (!raw || typeof raw !== "object") throw new FishIntakeError("INVALID_LINE", "รายการไม่ถูกต้อง");
      const fishName = textField(raw.fishName,200);
      if (!fishName) throw new FishIntakeError("FISH_NAME_REQUIRED", "ต้องระบุชื่อปลา");
      const receivedGrams = grams(raw.receivedKg,true)!;
      const billGrams = grams(raw.billKg,false);
      const purchaseAmountValue = money(raw.purchaseAmount);
      const extraAmountValue = money(raw.extraAmount,true);
      const unitPriceValue = price(raw.unitPricePerKg);
      const billDate = dateField(raw.billDate);
      const receivedDate = dateField(raw.receivedDate);
      const sku = textField(raw.sku,120);
      const size = textField(raw.size,64);
      const lotNoValue = textField(raw.lotNo,120);
      const expiryDate = dateField(raw.expiryDate);
      if (input.kind === "HISTORICAL") {
        if (!billDate || !receivedDate) throw new FishIntakeError("DATE_REQUIRED", "รายการย้อนหลังต้องมีวันที่บิลและวันที่รับ");
        if (!Number.isInteger(raw.sourceRow) || Number(raw.sourceRow) < 3)
          throw new FishIntakeError("SOURCE_ROW_REQUIRED", "ต้องมีแถวต้นฉบับ");
        if (sku || size || lotNoValue || expiryDate)
          throw new FishIntakeError("HISTORY_STOCK_FIELDS", "รายการย้อนหลังห้ามระบุสต็อกหรือล็อต");
      } else {
        if (!sku || !size) throw new FishIntakeError("PRODUCT_REQUIRED", "ต้องจับคู่ SKU และไซซ์ก่อนรับสต็อก");
        if (input.kind === "LIVE" && (!billDate || !receivedDate || billGrams == null))
          throw new FishIntakeError("LIVE_FIELDS_REQUIRED", "ใบรับปลาต้องมีวันที่บิล วันที่รับ และน้ำหนักตามบิล");
        if (input.kind === "LIVE" && !textField(raw.supplierName,200))
          throw new FishIntakeError("SUPPLIER_REQUIRED", "ใบรับปลาต้องระบุแพหรือผู้ขาย");
        if (input.kind === "OPENING" && !receivedDate)
          throw new FishIntakeError("OPENING_DATE_REQUIRED", "ยอดตั้งต้นต้องมีวันที่นับจริง");
        if (input.kind === "OPENING" && (billDate || billGrams != null || unitPriceValue != null || cents(extraAmountValue) !== 0n))
          throw new FishIntakeError("OPENING_FIELDS_INVALID", "ยอดตั้งต้นใช้เพียงน้ำหนักที่นับและมูลค่าคงเหลือ");
      }
      if (raw.sourceRow != null && (!Number.isInteger(raw.sourceRow) || Number(raw.sourceRow) < 3))
        throw new FishIntakeError("INVALID_SOURCE_ROW", "เลขแถวต้นฉบับไม่ถูกต้อง");
      for (const [value,max] of [[raw.supplierName,200],[raw.vesselRegistration,100],[raw.billSize,100],
        [raw.actualSize,100],[raw.quality,200],[raw.note,1000]] as const) textField(value,max);
      received += receivedGrams;
      billed += billGrams??0;
      purchase += cents(purchaseAmountValue);
      extra += cents(extraAmountValue);
      if (!Number.isSafeInteger(received) || !Number.isSafeInteger(billed) ||
          purchase > 99999999999999n || extra > 99999999999999n)
        throw new FishIntakeError("TOTAL_TOO_LARGE", "ยอดรวมเกินขนาดที่ระบบรับได้");
      return { ...raw, fishName, billDate, receivedDate, sku, size, expiryDate,
        supplierName:textField(raw.supplierName,200),vesselRegistration:textField(raw.vesselRegistration,100),
        billSize:textField(raw.billSize,100),actualSize:textField(raw.actualSize,100),
        quality:textField(raw.quality,200),note:textField(raw.note,1000),
        billGrams, receivedGrams, purchaseAmountValue, extraAmountValue, unitPriceValue, lotNoValue };
    } catch (error) {
      if (error instanceof FishIntakeError) throw new FishIntakeError(error.code,error.message,index+1);
      throw error;
    }
  });
  if (input.kind === "HISTORICAL" && new Set(lines.map(l=>l.sourceRow)).size !== lines.length)
    throw new FishIntakeError("DUPLICATE_SOURCE_ROW", "แถวต้นฉบับซ้ำกัน");
  return { lines, totals: { lineCount:lines.length, billGrams:billed, receivedGrams:received,
    purchaseAmount:amountFromCents(purchase), extraAmount:amountFromCents(extra) } };
}

export function fishIntakePreview(input: FishIntakeInput) {
  const { lines, totals }=validateFishIntake(input);
  const previewHash=createHash("sha256").update(JSON.stringify({kind:input.kind,locationId:input.locationId??null,
    sourceName:input.sourceName??null,sourceSheet:input.sourceSheet??null,sourceYear:input.sourceYear??null,
    note:input.note??null,lines})).digest("hex");
  return {previewHash,totals};
}

export async function saveFishIntake(tenantId: string, actorId: string, input: FishIntakeInput): Promise<FishIntakeResult> {
  const { lines, totals } = validateFishIntake(input);
  const requestHash = fishIntakePreview(input).previewHash;
  const client = await getClient();
  try {
    await beginTenantTx(client,tenantId,{editorId:actorId});
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,10119))",[`${tenantId}:${input.kind}:${input.requestKey}`]);
    const prior = (await client.query<{id:string;request_hash:string}>(
      `SELECT id,request_hash FROM bms_fish_intakes WHERE tenant_id=$1 AND kind=$2 AND request_key=$3`,
      [tenantId,input.kind,input.requestKey])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new FishIntakeError("IDEMPOTENCY_CONFLICT","รหัสคำขอนี้เคยใช้กับข้อมูลอื่นแล้ว");
      await client.query("COMMIT");
      return {status:"REPLAYED",intakeId:prior.id,...totals};
    }
    if (input.kind !== "HISTORICAL") {
      if (!(await isCapabilityEnabledInTx(client,tenantId,"WEIGHTED_PRODUCT")))
        throw new FishIntakeError("WEIGHTED_PRODUCT_DISABLED","ต้องเปิดใช้งานสินค้าชั่งน้ำหนักก่อนรับปลาเข้าสต็อก");
      await assertValuationLocation(client,tenantId,actorId,input.locationId!);
      const active = await client.query(`SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2 AND active`,
        [tenantId,input.locationId]);
      if (!active.rowCount) throw new FishIntakeError("LOCATION_INACTIVE","สาขานี้ไม่เปิดใช้งาน");
      const pairs = [...new Set(lines.map(l=>JSON.stringify([l.sku,l.size])))].map(s=>JSON.parse(s) as [string,string]).sort();
      for (const [sku,size] of pairs) {
        const product = (await client.query<{name:string;stock_policy:string;base_unit:string;lot_tracking:boolean;expiry_tracking:boolean}>(`
          SELECT p.name,sp.stock_policy,sp.base_unit,sp.lot_tracking,sp.expiry_tracking
            FROM bms_products p JOIN bms_product_stock_policies sp
              ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
            JOIN bms_product_variants v
              ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.code=$3 AND v.active
           WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active`,[tenantId,sku,size])).rows[0];
        if (!product || product.stock_policy!=="WEIGHTED" || product.base_unit!=="GRAM" || !product.lot_tracking)
          throw new FishIntakeError("PRODUCT_NOT_READY",`${sku}/${size}: ต้องตั้งเป็นสินค้าชั่งน้ำหนัก หน่วยกรัม และติดตามล็อต`);
        const relevant = lines.filter(l=>l.sku===sku&&l.size===size);
        if (product.expiry_tracking && relevant.some(l=>!l.expiryDate))
          throw new FishIntakeError("EXPIRY_REQUIRED",`${sku}/${size}: ต้องระบุวันหมดอายุ`);
        await client.query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
          VALUES($1,$2,$3,$4,0,0) ON CONFLICT DO NOTHING`,[tenantId,input.locationId,sku,size]);
        if (input.kind === "OPENING") {
          const inventory = (await client.query<{current_stock:number;reserved_stock:number}>(`
            SELECT current_stock,reserved_stock FROM bms_inventory
             WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,
            [tenantId,input.locationId,sku,size])).rows[0];
          const lots = (await client.query<{n:string}>(`
            SELECT count(*)::text AS n FROM bms_inventory_lots
             WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
            [tenantId,input.locationId,sku,size])).rows[0];
          if (Number(inventory.current_stock)!==0 || Number(inventory.reserved_stock)!==0 || Number(lots.n)!==0)
            throw new FishIntakeError("OPENING_NOT_EMPTY",`${sku}/${size}: ยอดตั้งต้นลงได้เฉพาะสต็อกที่ยังว่าง`);
        }
      }
    }
    const header = (await client.query<{id:string}>(`
      INSERT INTO bms_fish_intakes(tenant_id,kind,location_id,request_key,request_hash,source_name,source_sheet,source_year,note,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tenantId,input.kind,input.locationId??null,input.requestKey,requestHash,
        textField(input.sourceName,255),textField(input.sourceSheet,100),input.sourceYear??null,
        textField(input.note,1000),actorId])).rows[0];
    const inserted: Array<{id:string;line:ValidLine;lineNo:number}> = [];
    for (const [index,line] of lines.entries()) {
      const row = (await client.query<{id:string}>(`
        INSERT INTO bms_fish_intake_lines
          (tenant_id,intake_id,line_no,source_row,bill_date,received_date,supplier_name,vessel_registration,
           fish_name,bill_size,actual_size,sku,size,bill_grams,received_grams,unit_price_per_kg,
           purchase_amount,extra_amount,quality,note,lot_no,expiry_date)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        RETURNING id::text`,
        [tenantId,header.id,index+1,line.sourceRow??null,line.billDate,line.receivedDate,line.supplierName,
          line.vesselRegistration,line.fishName,line.billSize,line.actualSize,line.sku,line.size,
          line.billGrams,line.receivedGrams,line.unitPriceValue,line.purchaseAmountValue,
          line.extraAmountValue,line.quality,line.note,line.lotNoValue,line.expiryDate])).rows[0];
      inserted.push({id:row.id,line,lineNo:index+1});
    }
    if (input.kind !== "HISTORICAL") {
      for (const item of [...inserted].sort((a,b)=>`${a.line.sku}/${a.line.size}/${a.lineNo}`.localeCompare(`${b.line.sku}/${b.line.size}/${b.lineNo}`))) {
        const l=item.line;
        const qty=l.receivedGrams;
        const lotNo=l.lotNoValue??`FISH-${header.id.toUpperCase()}-${item.lineNo}`;
        if (!l.lotNoValue) await client.query(`UPDATE bms_fish_intake_lines SET lot_no=$3
          WHERE tenant_id=$1 AND id=$2`,[tenantId,item.id,lotNo]);
        const updated = await client.query(`UPDATE bms_inventory SET current_stock=current_stock+$5,updated_at=now()
          WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4
            AND current_stock <= 2147483647-$5`,[tenantId,input.locationId,l.sku,l.size,qty]);
        if (!updated.rowCount) throw new FishIntakeError("STOCK_OVERFLOW",`${l.sku}/${l.size}: สต็อกเกินขนาดที่ระบบรับได้`);
        const lotError = await validateTransferLotReceiptInTx(client,{tenantId,locationId:input.locationId!,
          productSku:l.sku!,size:l.size!,receivedQty:qty,
          lots:[{lot_no:lotNo,expiry_date:l.expiryDate??null,qty}]});
        if (lotError) throw new FishIntakeError("LOT_REVIEW_REQUIRED",lotError,item.lineNo);
        await receiveLotInTx(client,{tenantId,locationId:input.locationId!,productSku:l.sku!,size:l.size!,
          lotNo,qty,expiryDate:l.expiryDate??null,note:`Fish ${input.kind.toLowerCase()} ${header.id}`});
        const movementId=await recordMovement(client,{tenantId,locationId:input.locationId,
          sku:l.sku!,size:l.size!,type:input.kind==="OPENING"?"COUNT_ADJUST":"STOCK_IN",
          direction:input.kind==="OPENING"?"IN":undefined,qty,actor:`user:${actorId}`,
          note:`Fish ${input.kind.toLowerCase()} ${header.id} line ${item.lineNo}`,
          fishIntakeLineId:item.id});
        await client.query(`UPDATE bms_fish_intake_lines SET movement_id=$3
          WHERE tenant_id=$1 AND id=$2`,[tenantId,item.id,movementId]);
      }
    }
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES($1,$2,$3,$4,$5::jsonb)`,[tenantId,`user:${actorId}`,
        input.kind==="HISTORICAL"?"fish.history.import":input.kind==="OPENING"?"fish.stock.opening":"fish.receive",
        header.id,JSON.stringify({lineCount:totals.lineCount,receivedGrams:totals.receivedGrams,
          purchaseAmount:totals.purchaseAmount,extraAmount:totals.extraAmount,
          locationId:input.locationId??null,sourceName:input.sourceName??null})]);
    await client.query("COMMIT");
    return {status:"SAVED",intakeId:header.id,...totals};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listFishIntakes(tenantId: string, limit = 30) {
  const client = await getClient();
  try {
    await beginTenantTx(client,tenantId);
    const rows = await client.query<{
    id:string;kind:FishIntakeKind;location_id:string|null;source_name:string|null;source_sheet:string|null;
    created_at:Date;line_count:number;received_grams:string;purchase_amount:string;extra_amount:string;
  }>(`WITH recent AS (
         SELECT tenant_id,id,kind,location_id,source_name,source_sheet,created_at
           FROM bms_fish_intakes WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2
       )
       SELECT h.id,h.kind,h.location_id,h.source_name,h.source_sheet,h.created_at,
        count(l.id)::int AS line_count,coalesce(sum(l.received_grams),0)::text AS received_grams,
        coalesce(sum(l.purchase_amount),0)::text AS purchase_amount,
        coalesce(sum(l.extra_amount),0)::text AS extra_amount
       FROM recent h JOIN bms_fish_intake_lines l
         ON l.tenant_id=h.tenant_id AND l.intake_id=h.id
      GROUP BY h.id,h.kind,h.location_id,h.source_name,h.source_sheet,h.created_at
      ORDER BY h.created_at DESC`,
    [tenantId,Math.min(Math.max(limit,1),100)]);
    await client.query("COMMIT");
    return rows.rows.map(r=>({id:r.id,kind:r.kind,locationId:r.location_id,sourceName:r.source_name,
    sourceSheet:r.source_sheet,createdAt:r.created_at instanceof Date?r.created_at.toISOString():String(r.created_at),
    lineCount:r.line_count,receivedGrams:Number(r.received_grams),purchaseAmount:r.purchase_amount,extraAmount:r.extra_amount}));
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function fishIntakeOptions(tenantId:string, actorId:string, search="") {
  const term=search.trim().slice(0,100);
  const client=await getClient();
  try {
    await beginTenantTx(client,tenantId);
    const locations=(await client.query<{id:string;name:string}>(`
      SELECT l.id,l.name FROM bms_locations l WHERE l.tenant_id=$1 AND l.active
        AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
          OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a
            WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id))
      ORDER BY l.name LIMIT 100`,[tenantId,actorId])).rows;
    const products=(await client.query<{sku:string;name:string;size:string;expiry_tracking:boolean}>(`
      SELECT p.sku,p.name,v.code AS size,sp.expiry_tracking
        FROM bms_products p
        JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
        JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.active
       WHERE p.tenant_id=$1 AND p.active AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM'
         AND sp.lot_tracking AND ($2='' OR p.sku ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%')
       ORDER BY p.name,v.sort_order,v.code LIMIT 200`,[tenantId,term])).rows;
    await client.query("COMMIT");
    return {locations,products};
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally {client.release();}
}
