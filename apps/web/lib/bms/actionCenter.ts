import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getInventoryActionCenter, getOperationalAlerts } from "./dashboard";
import { listChannelHealth } from "./channelHealth";
import { listChannelsMasked } from "./channels";

export const ACTION_STATUSES = ["NEW", "ACCEPTED", "COMPLETED", "DISMISSED", "EXPIRED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

type Signal = {
  key: string;
  category: "POS" | "STOCK" | "MARGIN" | "RETENTION" | "SALES" | "OPERATIONS";
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  titleEn: string;
  evidence: Record<string, unknown>;
  expectedImpact: string;
  expectedImpactEn: string;
  confidence: number;
  dueHours: number;
  deepLink: string;
};

const row = (r: any) => ({
  id: r.id,
  actionKey: r.action_key,
  category: r.category,
  priority: r.priority,
  title: r.title,
  titleEn: r.title_en,
  evidence: r.evidence,
  expectedImpact: r.expected_impact,
  expectedImpactEn: r.expected_impact_en,
  confidence: Number(r.confidence),
  ownerId: r.owner_id,
  ownerName: r.owner_name || null,
  dueAt: r.due_at?.toISOString?.() ?? r.due_at ?? null,
  deepLink: r.deep_link,
  status: r.status,
  statusReason: r.status_reason,
  measuredOutcome: r.measured_outcome,
  firstSeenAt: r.first_seen_at?.toISOString?.() ?? r.first_seen_at,
  lastSeenAt: r.last_seen_at?.toISOString?.() ?? r.last_seen_at,
});

async function collectSignals(tenantId: string): Promise<Signal[]> {
  const [ops, inventory, margin, retention, sales, pos, channelHealth, channelConfig] = await Promise.all([
    getOperationalAlerts(tenantId),
    getInventoryActionCenter(tenantId, 30, 30, 20),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_products WHERE tenant_id=$1 AND active AND cost_price IS NOT NULL AND price <= cost_price`, [tenantId]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_customers c WHERE c.tenant_id=$1
      AND EXISTS (SELECT 1 FROM bms_orders o WHERE o.tenant_id=$1 AND o.customer_id=c.id AND o.status=ANY($2) AND o.created_at < now()-interval '60 days')
      AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.tenant_id=$1 AND o.customer_id=c.id AND o.status=ANY($2) AND o.created_at >= now()-interval '60 days')`, [tenantId, ["PAID","PACKING","SHIPPED","COMPLETED"]]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_orders WHERE tenant_id=$1 AND status='PENDING' AND created_at < now() - interval '2 hours'`, [tenantId]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_pos_shifts WHERE tenant_id=$1 AND status='OPEN' AND opened_at < now() - interval '16 hours'`, [tenantId]),
    listChannelHealth(tenantId),
    listChannelsMasked(tenantId),
  ]);
  const signals: Signal[] = [];
  const add = (condition: boolean, signal: Signal) => { if (condition) signals.push(signal); };
  add(ops.chatWaitingCount > 0, { key:"ops:chat-waiting",category:"SALES",priority:"CRITICAL",title:"ตอบลูกค้าที่กำลังรอ",titleEn:"Reply to waiting customers",evidence:{count:ops.chatWaitingCount},expectedImpact:"ลดโอกาสเสียลูกค้าจากการตอบช้า",expectedImpactEn:"Reduce lost customers caused by slow replies",confidence:.95,dueHours:1,deepLink:"/admin/inbox" });
  add(ops.slipPendingCount > 0, { key:"ops:slip-pending",category:"OPERATIONS",priority:"HIGH",title:"ตรวจสลิปรออนุมัติ",titleEn:"Review pending payment slips",evidence:{count:ops.slipPendingCount},expectedImpact:"ปลดออเดอร์ให้เดินหน้าต่อและลดเวลารอชำระ",expectedImpactEn:"Release orders for processing and reduce payment wait time",confidence:1,dueHours:4,deepLink:"/admin/payment?status=PENDING" });
  add(ops.packingOverdueCount > 0, { key:"ops:packing-overdue",category:"OPERATIONS",priority:"HIGH",title:"เร่งออเดอร์แพ็กเกินกำหนด",titleEn:"Resolve overdue packing orders",evidence:{count:ops.packingOverdueCount},expectedImpact:"ลดการส่งล่าช้าและข้อร้องเรียน",expectedImpactEn:"Reduce late shipments and complaints",confidence:1,dueHours:4,deepLink:"/admin/orders?status=PACKING" });
  add(inventory.summary.stockoutWithin7DaysCount > 0, { key:"stock:stockout-7d",category:"STOCK",priority:"HIGH",title:"ทบทวนสินค้าที่เสี่ยงหมดใน 7 วัน",titleEn:"Review variants at risk of stocking out within 7 days",evidence:{count:inventory.summary.stockoutWithin7DaysCount,suggestedUnits:inventory.summary.totalSuggestedQty},expectedImpact:"ลด Lost sales จากของหมด",expectedImpactEn:"Reduce lost sales caused by stock-outs",confidence:.75,dueHours:24,deepLink:"/admin/purchase" });
  add(inventory.summary.slowMovingCount > 0, { key:"stock:slow-moving",category:"STOCK",priority:"MEDIUM",title:"จัดการสินค้าขายช้าและเงินจม",titleEn:"Act on slow-moving and dead stock",evidence:{count:inventory.summary.slowMovingCount},expectedImpact:"คืนเงินสดจากสต็อกที่หมุนช้า",expectedImpactEn:"Release cash trapped in slow inventory",confidence:.7,dueHours:72,deepLink:"/admin/products" });
  add(inventory.summary.expiringLotCount > 0, { key:"stock:expiring",category:"STOCK",priority:"HIGH",title:"จัดการล็อตใกล้หมดอายุ",titleEn:"Act on expiring inventory lots",evidence:{count:inventory.summary.expiringLotCount,units:inventory.summary.expiringUnits},expectedImpact:"ลดของเสียจากหมดอายุด้วย FEFO, ลดราคา หรือโอนสาขา",expectedImpactEn:"Reduce expiry waste with FEFO, markdowns, or transfers",confidence:.95,dueHours:24,deepLink:"/admin/products" });
  add(Number(margin.rows[0]?.count)>0, { key:"margin:non-positive",category:"MARGIN",priority:"HIGH",title:"ตรวจสินค้าที่ราคาขายไม่สูงกว่าทุน",titleEn:"Review products priced at or below cost",evidence:{count:Number(margin.rows[0]?.count)},expectedImpact:"หยุดการขายที่ไม่สร้างกำไรขั้นต้น",expectedImpactEn:"Stop sales that produce no gross margin",confidence:.9,dueHours:24,deepLink:"/admin/products" });
  add(Number(retention.rows[0]?.count)>0, { key:"retention:dormant-60d",category:"RETENTION",priority:"MEDIUM",title:"ทบทวนลูกค้าที่เงียบเกิน 60 วัน",titleEn:"Review customers inactive for over 60 days",evidence:{count:Number(retention.rows[0]?.count)},expectedImpact:"สร้างโอกาสซื้อซ้ำจากฐานลูกค้าเดิม",expectedImpactEn:"Create repeat-purchase opportunities from existing customers",confidence:.6,dueHours:72,deepLink:"/admin/followup-queue" });
  add(Number(sales.rows[0]?.count)>0, { key:"sales:pending-2h",category:"SALES",priority:"HIGH",title:"ตามออเดอร์ที่ยังไม่ชำระเกิน 2 ชั่วโมง",titleEn:"Follow up orders unpaid for over 2 hours",evidence:{count:Number(sales.rows[0]?.count)},expectedImpact:"เพิ่ม Conversion จากออเดอร์ที่ค้าง",expectedImpactEn:"Improve conversion from pending orders",confidence:.85,dueHours:4,deepLink:"/admin/orders?status=PENDING" });
  add(Number(pos.rows[0]?.count)>0, { key:"pos:shift-open-16h",category:"POS",priority:"HIGH",title:"ตรวจสอบกะ POS ที่เปิดนานผิดปกติ",titleEn:"Review POS shifts open for over 16 hours",evidence:{count:Number(pos.rows[0]?.count),thresholdHours:16},expectedImpact:"ลดความเสี่ยงยอดเงินสดและกะค้างข้ามวัน",expectedImpactEn:"Reduce cash discrepancy and overnight-shift risk",confidence:.95,dueHours:2,deepLink:"/pos" });
  const configured = new Set(channelConfig.filter((c:any)=>c.active && c.has_token).map((c:any)=>c.channel));
  for (const channel of channelHealth.filter((c)=>configured.has(c.channel) && c.status !== "connected")) {
    signals.push({ key:`channel:${channel.channel}:${channel.status}`,category:"OPERATIONS",priority:"CRITICAL",title:`แก้การเชื่อมต่อ ${channel.channel}`,titleEn:`Fix ${channel.channel} connection`,evidence:{status:channel.status,detail:channel.status_detail},expectedImpact:"กู้การรับและตอบข้อความลูกค้าบนช่องทางนี้",expectedImpactEn:"Restore customer messaging on this channel",confidence:1,dueHours:1,deepLink:`/admin/settings?focus=channel&channel=${channel.channel}` });
  }
  return signals;
}

export async function refreshActions(tenantId: string): Promise<number> {
  const signals = await collectSignals(tenantId);
  const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    for (const s of signals) {
      await client.query(
        `INSERT INTO bms_actions (tenant_id, action_key, category, priority, title, title_en, evidence, expected_impact, expected_impact_en, confidence, due_at, deep_link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+make_interval(hours=>$11),$12)
         ON CONFLICT (tenant_id, action_key) DO UPDATE SET
           category=EXCLUDED.category, priority=EXCLUDED.priority, title=EXCLUDED.title, title_en=EXCLUDED.title_en,
           evidence=EXCLUDED.evidence, expected_impact=EXCLUDED.expected_impact, expected_impact_en=EXCLUDED.expected_impact_en,
           confidence=EXCLUDED.confidence, deep_link=EXCLUDED.deep_link,
           due_at=CASE WHEN bms_actions.status IN ('NEW','ACCEPTED') THEN LEAST(bms_actions.due_at, EXCLUDED.due_at) ELSE bms_actions.due_at END,
           last_seen_at=now(), updated_at=now()`,
        [tenantId, `${businessDate}:${s.key}`, s.category, s.priority, s.title, s.titleEn, JSON.stringify(s.evidence), s.expectedImpact, s.expectedImpactEn, s.confidence, s.dueHours, s.deepLink]
      );
    }
    const keys = signals.map((s) => `${businessDate}:${s.key}`);
    const expired = await client.query<{ action_id: string; from_status: string }>(
      `WITH candidates AS (
         SELECT id,status FROM bms_actions
         WHERE tenant_id=$1 AND status IN ('NEW','ACCEPTED') AND NOT (action_key = ANY($2::text[]))
         FOR UPDATE
       ), updated AS (
         UPDATE bms_actions a SET status='EXPIRED', expired_at=now(), updated_at=now(), status_reason='signal_cleared'
         FROM candidates c WHERE a.id=c.id RETURNING a.id,c.status AS from_status
       )
       INSERT INTO bms_action_events (tenant_id,action_id,from_status,to_status,reason,meta)
       SELECT $1,id,from_status,'EXPIRED','signal_cleared','{"source":"signal_refresh"}'::jsonb FROM updated
       RETURNING action_id,from_status`,
      [tenantId, keys]
    );
    for (const item of expired.rows) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
         VALUES ($1,'system:action-refresh','action.expired',$2,$3)`,
        [tenantId, item.action_id, JSON.stringify({ from: item.from_status, to: "EXPIRED", reason: "signal_cleared" })]
      );
    }
    await client.query("COMMIT");
    return signals.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function listActions(tenantId: string, limit = 50) {
  const res = await query<any>(
    `SELECT a.*, u.name AS owner_name FROM bms_actions a LEFT JOIN users u ON u.id=a.owner_id
     WHERE a.tenant_id=$1 ORDER BY CASE a.status WHEN 'NEW' THEN 0 WHEN 'ACCEPTED' THEN 1 ELSE 2 END,
       CASE a.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, a.due_at NULLS LAST LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 100)]
  );
  return res.rows.map(row);
}

export async function getActionMetrics(tenantId: string, days = 30) {
  const res = await query<any>(
    `SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
      COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at-created_at))/60) FILTER (WHERE accepted_at IS NOT NULL),0) AS avg_minutes,
      COUNT(*) FILTER (WHERE measured_outcome IS NOT NULL)::int AS measured
     FROM bms_actions WHERE tenant_id=$1 AND created_at >= now()-make_interval(days=>$2)`, [tenantId, Math.min(Math.max(days, 1), 365)]);
  const r = res.rows[0];
  return { days, total: r.total, accepted: r.accepted, completed: r.completed,
    acceptanceRate: r.total ? r.accepted / r.total : 0, completionRate: r.total ? r.completed / r.total : 0,
    avgTimeToActionMinutes: Number(r.avg_minutes), measuredOutcomeCount: r.measured };
}

export async function transitionAction(tenantId: string, actionId: string, actorId: string, status: ActionStatus, reason?: string | null, ownerId?: string | null, measuredOutcome?: unknown) {
  if (!ACTION_STATUSES.includes(status)) throw new Error("invalid action status");
  if (["DISMISSED", "EXPIRED"].includes(status) && !reason?.trim()) throw new Error("reason is required");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const before = await client.query<any>("SELECT * FROM bms_actions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, actionId]);
    if (!before.rowCount) throw new Error("action not found");
    const from = before.rows[0].status;
    const allowed: Record<string, ActionStatus[]> = { NEW: ["ACCEPTED","DISMISSED","EXPIRED"], ACCEPTED: ["COMPLETED","DISMISSED","EXPIRED"], COMPLETED: [], DISMISSED: [], EXPIRED: [] };
    if (!allowed[from]?.includes(status)) throw new Error(`cannot transition ${from} to ${status}`);
    const updated = await client.query<any>(
      `UPDATE bms_actions SET status=$3, status_reason=$4, owner_id=COALESCE($5,owner_id), measured_outcome=COALESCE($6,measured_outcome),
       accepted_at=CASE WHEN $3='ACCEPTED' THEN now() ELSE accepted_at END,
       completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE completed_at END,
       dismissed_at=CASE WHEN $3='DISMISSED' THEN now() ELSE dismissed_at END,
       expired_at=CASE WHEN $3='EXPIRED' THEN now() ELSE expired_at END, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, actionId, status, reason?.trim() || null, ownerId || (status === "ACCEPTED" ? actorId : null), measuredOutcome ? JSON.stringify(measuredOutcome) : null]);
    await client.query(`INSERT INTO bms_action_events (tenant_id,action_id,from_status,to_status,reason,actor_id,meta) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tenantId, actionId, from, status, reason?.trim() || null, actorId, JSON.stringify({ measuredOutcome: measuredOutcome ?? null })]);
    await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta) VALUES ($1,$2,$3,$4,$5)`, [tenantId, actorId, `action.${status.toLowerCase()}`, actionId, JSON.stringify({ from, to: status, reason: reason?.trim() || null })]);
    await client.query("COMMIT");
    return row(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function recordDemandEvent(tenantId: string, actorId: string, input: { sku: string; size: string; kind: "LOST_SALE" | "RESTOCK_REQUEST"; qty: number; note?: string | null }) {
  if (!(["LOST_SALE", "RESTOCK_REQUEST"] as const).includes(input.kind)) throw new Error("invalid demand kind");
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 10000) throw new Error("qty must be 1-10000");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const result = await client.query<any>(`INSERT INTO bms_inventory_demand_events (tenant_id,product_sku,size,kind,qty,note,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [tenantId, input.sku.trim(), input.size.trim().toUpperCase(), input.kind, input.qty, input.note?.trim() || null, actorId]);
    await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta) VALUES ($1,$2,'inventory.demand.record',$3,$4)`, [tenantId, actorId, result.rows[0].id, JSON.stringify({ sku: input.sku, size: input.size, kind: input.kind, qty: input.qty })]);
    await client.query("COMMIT"); return result.rows[0].id;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function upsertInventoryPolicy(tenantId: string, actorId: string, input: { sku: string; size: string; safetyStockDays: number; leadTimeDays: number }) {
  if (!Number.isInteger(input.safetyStockDays) || input.safetyStockDays < 0 || input.safetyStockDays > 90) throw new Error("safetyStockDays must be 0-90");
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 180) throw new Error("leadTimeDays must be 0-180");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    await client.query(`INSERT INTO bms_inventory_policies (tenant_id,product_sku,size,safety_stock_days,lead_time_days,updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id,product_sku,size) DO UPDATE SET safety_stock_days=EXCLUDED.safety_stock_days,lead_time_days=EXCLUDED.lead_time_days,updated_by=EXCLUDED.updated_by,updated_at=now()`, [tenantId,input.sku.trim(),input.size.trim().toUpperCase(),input.safetyStockDays,input.leadTimeDays,actorId]);
    await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta) VALUES ($1,$2,'inventory.policy.update',$3,$4)`, [tenantId,actorId,`${input.sku}:${input.size}`,JSON.stringify({ safetyStockDays:input.safetyStockDays,leadTimeDays:input.leadTimeDays })]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; } finally { client.release(); }
}
