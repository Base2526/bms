import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createHash } from "crypto";

const PAID = ["PAID","PACKING","SHIPPED","COMPLETED"];
const ATTRIBUTION_DAYS = 30;
export const RETENTION_STATUSES = ["NEW","ACCEPTED","CONTACTED","CONVERTED","DISMISSED","EXPIRED"] as const;
type RetentionStatus = (typeof RETENTION_STATUSES)[number];

function shape(r:any) {
  return { id:r.id,customerId:r.customer_id,customerName:r.customer_name,cohort:r.cohort,status:r.status,rfmSegment:r.rfm_segment,
    recencyDays:Number(r.recency_days),frequency:Number(r.frequency),monetary:Number(r.monetary),expectedReturnAt:r.expected_return_at instanceof Date?r.expected_return_at.toISOString().slice(0,10):r.expected_return_at,
    riskScore:Number(r.risk_score),recommendedChannel:r.recommended_channel,recommendedMessageTh:r.recommended_message_th,recommendedMessageEn:r.recommended_message_en,
    recommendedOffer:r.recommended_offer,recommendedProductSku:r.recommended_product_sku,reasonTh:r.recommendation_reason_th,reasonEn:r.recommendation_reason_en,
    contactedAt:r.contacted_at?.toISOString?.()??r.contacted_at??null,convertedAt:r.converted_at?.toISOString?.()??r.converted_at??null,convertedRevenue:r.converted_revenue==null?null:Number(r.converted_revenue) };
}

export async function refreshRetentionCases(tenantId:string) {
  const stats=await query<any>(`WITH paid AS (
    SELECT o.id,o.customer_id,o.channel,o.total_amount,o.created_at FROM bms_orders o
    WHERE o.tenant_id=$1 AND o.customer_id IS NOT NULL AND o.status=ANY($2)
  ), agg AS (
    SELECT customer_id,COUNT(*)::int frequency,SUM(total_amount) monetary,MAX(created_at) last_order,MIN(created_at) first_order,
      CASE WHEN COUNT(*)>1 THEN EXTRACT(EPOCH FROM (MAX(created_at)-MIN(created_at)))/86400/(COUNT(*)-1) ELSE 60 END avg_gap
    FROM paid GROUP BY customer_id
  ) SELECT c.id customer_id,c.name,agg.*,
    COALESCE((SELECT ci.channel FROM bms_customer_identities ci WHERE ci.tenant_id=$1 AND ci.customer_id=c.id AND ci.channel IN ('line','facebook','instagram') ORDER BY ci.created_at DESC LIMIT 1),CASE WHEN c.phone IS NOT NULL THEN 'phone' END) channel,
    next.product_sku next_sku
  FROM agg JOIN bms_customers c ON c.id=agg.customer_id AND c.tenant_id=$1 AND c.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT peer.product_sku,COUNT(*) score FROM bms_order_items seed
    JOIN bms_orders so ON so.id=seed.order_id AND so.tenant_id=$1 AND so.status=ANY($2)
    JOIN bms_order_items peer ON peer.order_id=seed.order_id AND peer.product_sku<>seed.product_sku
    WHERE seed.product_sku IN (SELECT oi.product_sku FROM bms_order_items oi JOIN paid cp ON cp.id=oi.order_id WHERE cp.customer_id=c.id)
      AND peer.product_sku NOT IN (SELECT oi.product_sku FROM bms_order_items oi JOIN paid cp ON cp.id=oi.order_id WHERE cp.customer_id=c.id)
    GROUP BY peer.product_sku ORDER BY score DESC,peer.product_sku LIMIT 1
  ) next ON true`,[tenantId,PAID]);
  const periodKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit"}).format(new Date());
  const client=await getClient();
  try {
    await beginTenantTx(client,tenantId);
    for(const r of stats.rows){
      const recency=Math.max(0,Math.floor((Date.now()-new Date(r.last_order).getTime())/86400000));
      const gap=Math.max(14,Math.min(365,Number(r.avg_gap)||60));
      const expected=new Date(new Date(r.last_order).getTime()+Math.ceil(gap)*86400000).toISOString().slice(0,10);
      const risk=Math.max(0,Math.min(100,Math.round((recency/(gap*2))*100)));
      const segment=Number(r.frequency)>=5&&recency<=30?"CHAMPION":Number(r.frequency)>=3&&recency<=60?"LOYAL":Number(r.frequency)===1&&recency<=30?"NEW":recency>180?"HIBERNATING":risk>=60?"AT_RISK":"PROMISING";
      const cohort=["0","1"].includes(createHash("md5").update(String(r.customer_id)).digest("hex").slice(-1))?"HOLDOUT":"TREATMENT";
      const reasonTh=`ซื้อ ${r.frequency} ครั้ง มูลค่า ${Number(r.monetary).toFixed(0)} บาท และห่างจากครั้งล่าสุด ${recency} วัน (รอบปกติประมาณ ${Math.round(gap)} วัน)`;
      const reasonEn=`${r.frequency} purchases worth ${Number(r.monetary).toFixed(0)} THB; ${recency} days since last order versus an expected ${Math.round(gap)}-day rhythm`;
      await client.query(`INSERT INTO bms_retention_cases (tenant_id,customer_id,period_key,cohort,rfm_segment,recency_days,frequency,monetary,expected_return_at,risk_score,recommended_channel,recommended_message_th,recommended_message_en,recommended_offer,recommended_product_sku,recommendation_reason_th,recommendation_reason_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PERSONAL_SERVICE_NO_DISCOUNT',$14,$15,$16)
        ON CONFLICT (tenant_id,customer_id,period_key) DO UPDATE SET rfm_segment=EXCLUDED.rfm_segment,recency_days=EXCLUDED.recency_days,frequency=EXCLUDED.frequency,monetary=EXCLUDED.monetary,expected_return_at=EXCLUDED.expected_return_at,risk_score=EXCLUDED.risk_score,recommended_channel=EXCLUDED.recommended_channel,recommended_message_th=EXCLUDED.recommended_message_th,recommended_message_en=EXCLUDED.recommended_message_en,recommended_product_sku=EXCLUDED.recommended_product_sku,recommendation_reason_th=EXCLUDED.recommendation_reason_th,recommendation_reason_en=EXCLUDED.recommendation_reason_en,updated_at=now()`,
        [tenantId,r.customer_id,periodKey,cohort,segment,recency,r.frequency,r.monetary,expected,risk,r.channel,`คิดถึงคุณ ${r.name} หากกำลังมองหาสินค้าเดิม ทีมร้านช่วยเช็กของและแนะนำให้ได้ค่ะ`,`We miss you, ${r.name}. Our team can check availability and help with your next purchase.`,r.next_sku,reasonTh,reasonEn]);
    }
    await client.query(`WITH conversions AS (
      SELECT rc.id case_id,o.id order_id,o.created_at,o.total_amount FROM bms_retention_cases rc
      JOIN LATERAL (SELECT id,created_at,total_amount FROM bms_orders WHERE tenant_id=$1 AND customer_id=rc.customer_id AND status=ANY($2)
        AND created_at>COALESCE(rc.contacted_at,rc.created_at)
        AND created_at<=COALESCE(rc.contacted_at,rc.created_at)+($3::int * interval '1 day')
        ORDER BY created_at LIMIT 1) o ON true
      WHERE rc.tenant_id=$1 AND rc.status IN ('CONTACTED','NEW') AND ((rc.cohort='TREATMENT' AND rc.contacted_at IS NOT NULL) OR rc.cohort='HOLDOUT')
    ) UPDATE bms_retention_cases rc SET status='CONVERTED',converted_order_id=c.order_id,converted_at=c.created_at,converted_revenue=c.total_amount,updated_at=now() FROM conversions c WHERE rc.id=c.case_id`,[tenantId,PAID,ATTRIBUTION_DAYS]);
    await client.query(`UPDATE bms_retention_cases
      SET status='EXPIRED',updated_at=now()
      WHERE tenant_id=$1 AND status IN ('NEW','ACCEPTED','CONTACTED')
        AND COALESCE(contacted_at,created_at) < now() - ($2::int * interval '1 day')`,[tenantId,ATTRIBUTION_DAYS]);
    await client.query("COMMIT"); return stats.rowCount;
  }catch(e){await client.query("ROLLBACK").catch(()=>undefined);throw e;}finally{client.release();}
}

export async function listRetentionCases(tenantId:string,limit=100){const r=await query<any>(`SELECT rc.*,c.name customer_name FROM bms_retention_cases rc JOIN bms_customers c ON c.id=rc.customer_id AND c.tenant_id=rc.tenant_id WHERE rc.tenant_id=$1 ORDER BY CASE rc.status WHEN 'NEW' THEN 0 WHEN 'ACCEPTED' THEN 1 ELSE 2 END,rc.risk_score DESC,rc.monetary DESC LIMIT $2`,[tenantId,Math.min(Math.max(limit,1),200)]);return r.rows.map(shape);}

export async function getRetentionAnalytics(tenantId:string){const r=await query<any>(`SELECT cohort,COUNT(*)::int total,COUNT(*) FILTER(WHERE status='CONVERTED')::int converted,COALESCE(SUM(converted_revenue),0) revenue FROM bms_retention_cases WHERE tenant_id=$1 GROUP BY cohort`,[tenantId]);const by=Object.fromEntries(r.rows.map(x=>[x.cohort,x]));const t=by.TREATMENT||{total:0,converted:0,revenue:0},h=by.HOLDOUT||{total:0,converted:0,revenue:0};const tr=t.total?t.converted/t.total:0,hr=h.total?h.converted/h.total:0;return{treatmentTotal:t.total,holdoutTotal:h.total,treatmentConverted:t.converted,holdoutConverted:h.converted,treatmentRate:tr,holdoutRate:hr,incrementalLift:tr-hr,retentionRevenue:Number(t.revenue)};}

export async function transitionRetentionCase(tenantId:string,id:string,actorId:string,status:RetentionStatus,reason?:string){if(!RETENTION_STATUSES.includes(status))throw new Error("invalid status");const client=await getClient();try{await beginTenantTx(client,tenantId,{editorId:actorId});const before=await client.query<any>(`SELECT * FROM bms_retention_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);if(!before.rowCount)throw new Error("case not found");const b=before.rows[0];if(b.cohort==='HOLDOUT'&&['ACCEPTED','CONTACTED'].includes(status))throw new Error("holdout cases cannot be contacted");const allowed:any={NEW:['ACCEPTED','DISMISSED'],ACCEPTED:['CONTACTED','DISMISSED'],CONTACTED:[],CONVERTED:[],DISMISSED:[],EXPIRED:[]};if(!allowed[b.status]?.includes(status))throw new Error(`cannot transition ${b.status} to ${status}`);if(status==='DISMISSED'&&!reason?.trim())throw new Error("reason required");const u=await client.query<any>(`UPDATE bms_retention_cases SET status=$3,accepted_by=CASE WHEN $3='ACCEPTED' THEN $4 ELSE accepted_by END,accepted_at=CASE WHEN $3='ACCEPTED' THEN now() ELSE accepted_at END,contacted_at=CASE WHEN $3='CONTACTED' THEN now() ELSE contacted_at END,dismissed_at=CASE WHEN $3='DISMISSED' THEN now() ELSE dismissed_at END,dismiss_reason=CASE WHEN $3='DISMISSED' THEN $5 ELSE dismiss_reason END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,status,actorId,reason?.trim()||null]);await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5)`,[tenantId,actorId,`retention.${status.toLowerCase()}`,id,JSON.stringify({from:b.status,to:status,reason:reason||null})]);await client.query("COMMIT");return shape(u.rows[0]);}catch(e){await client.query("ROLLBACK").catch(()=>undefined);throw e;}finally{client.release();}}
