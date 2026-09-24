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

async function collectDeliverySignals(tenantId: string): Promise<Signal[]> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<{
      acceptance_due: number; action_events: number; mapping_actions: number;
      failed_commands: number; pause_failures: number; refund_pending: number;
      settlement_mismatches: number; credential_expiring: number; unhealthy_integrations: number;
      webhook_stale: number;
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM bms_delivery_orders
          WHERE tenant_id=$1 AND local_status IN ('RECEIVED','AWAITING_ACCEPTANCE')
            AND acceptance_deadline_at IS NOT NULL AND acceptance_deadline_at <= now()+interval '10 minutes') AS acceptance_due,
        (SELECT COUNT(*)::int FROM bms_delivery_events
          WHERE tenant_id=$1 AND processing_status IN ('ACTION_REQUIRED','DEAD_LETTER')) AS action_events,
        (SELECT COUNT(*)::int FROM bms_delivery_menu_mappings
          WHERE tenant_id=$1 AND mapping_status IN ('UNMAPPED','STALE')) AS mapping_actions,
        (SELECT COUNT(*)::int FROM bms_delivery_commands
          WHERE tenant_id=$1 AND status IN ('FAILED','MANUAL_ACTION_REQUIRED')) AS failed_commands,
        (SELECT COUNT(*)::int FROM bms_delivery_intake_controls
          WHERE tenant_id=$1 AND desired_state <> provider_state
            AND sync_status IN ('FAILED','MANUAL_ACTION_REQUIRED')) AS pause_failures,
        (SELECT COUNT(DISTINCT ra.id)::int
           FROM bms_pos_refund_allocations ra
           JOIN bms_pos_returns pr ON pr.tenant_id=ra.tenant_id AND pr.id=ra.pos_return_id
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE ra.tenant_id=$1 AND ra.method='PLATFORM_SETTLEMENT'
            AND ra.status='PENDING') AS refund_pending,
        (SELECT COUNT(*)::int FROM bms_delivery_settlements
          WHERE tenant_id=$1 AND status IN ('MISMATCH','DISPUTED')) AS settlement_mismatches,
        (SELECT COUNT(*)::int FROM bms_delivery_integrations
          WHERE tenant_id=$1 AND active AND credential_expires_at IS NOT NULL
            AND credential_expires_at <= now()+interval '14 days') AS credential_expiring,
        (SELECT COUNT(*)::int FROM bms_delivery_integrations
          WHERE tenant_id=$1 AND active AND health_status NOT IN ('HEALTHY','DISABLED')) AS unhealthy_integrations,
        (SELECT COUNT(*)::int FROM bms_delivery_integrations
          WHERE tenant_id=$1 AND active AND rollout_mode <> 'OFF'
            AND (last_webhook_at IS NULL OR last_webhook_at < now()-interval '30 minutes')) AS webhook_stale`,
      [tenantId],
    );
    await client.query("COMMIT");
    const r = result.rows[0];
    if (!r) return [];
    const signals: Signal[] = [];
    const add = (count: number, signal: Omit<Signal, "evidence">) => {
      if (Number(count) > 0) signals.push({ ...signal, evidence: { count: Number(count) } });
    };
    add(r.acceptance_due, { key:"delivery:acceptance-due",category:"OPERATIONS",priority:"CRITICAL",title:"รับหรือแก้ออเดอร์เดลิเวอรีก่อนหมดเวลา",titleEn:"Accept or resolve delivery orders before timeout",expectedImpact:"ป้องกันออเดอร์หมดเวลาและสต็อกค้างจอง",expectedImpactEn:"Prevent provider timeouts and stranded reservations",confidence:1,dueHours:1,deepLink:"/pos?tab=incoming" });
    add(r.action_events, { key:"delivery:event-action",category:"OPERATIONS",priority:"CRITICAL",title:"แก้เหตุการณ์เดลิเวอรีที่ต้องตรวจด้วยคน",titleEn:"Resolve delivery events requiring human review",expectedImpact:"หยุด event ที่ผิด mapping หรือขัดแย้งก่อนกระทบงานครัวและเงิน",expectedImpactEn:"Contain mapping or state conflicts before they affect kitchen and finance",confidence:1,dueHours:1,deepLink:"/admin/delivery-platforms?tab=operations" });
    add(r.mapping_actions, { key:"delivery:mapping-action",category:"OPERATIONS",priority:"HIGH",title:"ตรวจ menu mapping ที่ยังไม่พร้อม",titleEn:"Review incomplete or stale delivery menu mappings",expectedImpact:"ป้องกันการสร้างออเดอร์บางส่วนหรือจับคู่สินค้าผิด",expectedImpactEn:"Prevent partial orders and incorrect item mapping",confidence:1,dueHours:4,deepLink:"/admin/delivery-platforms?tab=mappings" });
    add(r.failed_commands, { key:"delivery:command-failed",category:"OPERATIONS",priority:"CRITICAL",title:"แก้คำสั่ง provider ที่ล้มเหลว",titleEn:"Resolve failed provider commands",expectedImpact:"ทำให้สถานะจริงของร้านและ provider กลับมาตรงกัน",expectedImpactEn:"Restore agreement between local and provider state",confidence:1,dueHours:1,deepLink:"/admin/delivery-platforms?tab=operations" });
    add(r.pause_failures, { key:"delivery:pause-failed",category:"OPERATIONS",priority:"CRITICAL",title:"ตรวจการหยุดรับออเดอร์ที่ยังไม่ยืนยันบน provider",titleEn:"Review intake pauses not confirmed by providers",expectedImpact:"ลดความเสี่ยงรับออเดอร์ต่อทั้งที่ร้านตั้งใจปิด",expectedImpactEn:"Reduce the risk of receiving orders while the shop intends to be paused",confidence:1,dueHours:1,deepLink:"/admin/delivery-platforms?tab=operations" });
    add(r.refund_pending, { key:"delivery:refund-pending",category:"OPERATIONS",priority:"HIGH",title:"ติดตาม refund เดลิเวอรีที่ยังรอ provider",titleEn:"Follow up delivery refunds pending provider confirmation",expectedImpact:"ปิดยอดคืนเงินโดยไม่ถือว่าการกดใน BMS คือผลสำเร็จ",expectedImpactEn:"Close refunds without treating a local request as provider confirmation",confidence:1,dueHours:24,deepLink:"/admin/delivery-platforms?tab=finance" });
    add(r.settlement_mismatches, { key:"delivery:settlement-mismatch",category:"MARGIN",priority:"HIGH",title:"กระทบยอด settlement เดลิเวอรีที่ไม่ตรง",titleEn:"Reconcile mismatched delivery settlements",expectedImpact:"ค้นหาค่าธรรมเนียม คืนเงิน หรือยอดโอนที่ขาด",expectedImpactEn:"Identify missing fees, refunds, or payouts",confidence:1,dueHours:24,deepLink:"/admin/delivery-platforms?tab=finance" });
    add(r.credential_expiring, { key:"delivery:credential-expiring",category:"OPERATIONS",priority:"HIGH",title:"หมุน credential เดลิเวอรีที่ใกล้หมดอายุ",titleEn:"Rotate expiring delivery credentials",expectedImpact:"ป้องกันการเชื่อมต่อหยุดโดยไม่ตั้งใจ",expectedImpactEn:"Prevent avoidable integration outages",confidence:1,dueHours:24,deepLink:"/admin/delivery-platforms?tab=integrations" });
    add(r.unhealthy_integrations, { key:"delivery:integration-unhealthy",category:"OPERATIONS",priority:"CRITICAL",title:"แก้การเชื่อมต่อเดลิเวอรีที่ไม่ healthy",titleEn:"Fix unhealthy delivery integrations",expectedImpact:"กู้การรับออเดอร์และการยืนยันสถานะ provider",expectedImpactEn:"Restore order intake and provider acknowledgements",confidence:1,dueHours:1,deepLink:"/admin/delivery-platforms?tab=integrations" });
    add(r.webhook_stale, { key:"delivery:webhook-stale",category:"OPERATIONS",priority:"HIGH",title:"ตรวจ provider ที่ไม่มี webhook ล่าสุด",titleEn:"Check providers with stale webhook activity",expectedImpact:"ค้นหา webhook ที่หยุดก่อนเกิดออเดอร์ตกหล่น",expectedImpactEn:"Detect stopped webhooks before orders are missed",confidence:.85,dueHours:2,deepLink:"/admin/delivery-platforms?tab=operations" });
    return signals;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

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
  const [ops, inventory, margin, retention, sales, pos, customerQuality, duplicateCustomers, paymentConflicts, orderOutliers, channelHealth, channelConfig, deliverySignals] = await Promise.all([
    getOperationalAlerts(tenantId),
    getInventoryActionCenter(tenantId, 30, 30, 20),
    query<any>(`SELECT
      COUNT(*) FILTER (WHERE cost_price IS NOT NULL AND price <= cost_price)::int AS non_positive_count,
      COUNT(*) FILTER (WHERE cost_price IS NULL)::int AS missing_cost_count,
      COUNT(*) FILTER (WHERE price = 0)::int AS zero_price_count
      FROM bms_products WHERE tenant_id=$1 AND active`, [tenantId]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_customers c WHERE c.tenant_id=$1
      AND EXISTS (SELECT 1 FROM bms_orders o WHERE o.tenant_id=$1 AND o.customer_id=c.id AND o.status=ANY($2) AND o.created_at < now()-interval '60 days')
      AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.tenant_id=$1 AND o.customer_id=c.id AND o.status=ANY($2) AND o.created_at >= now()-interval '60 days')`, [tenantId, ["PAID","PACKING","SHIPPED","COMPLETED"]]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_orders WHERE tenant_id=$1 AND status='PENDING' AND created_at < now() - interval '2 hours'`, [tenantId]),
    query<any>(`SELECT COUNT(*)::int AS count FROM bms_pos_shifts WHERE tenant_id=$1 AND status='OPEN' AND opened_at < now() - interval '16 hours'`, [tenantId]),
    query<any>(`SELECT COUNT(DISTINCT c.id)::int AS count
      FROM bms_customers c
      WHERE c.tenant_id=$1 AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM bms_orders o
           WHERE o.tenant_id=$1 AND o.customer_id=c.id
             AND o.status NOT IN ('CANCELLED','RETURNED')
             AND o.channel NOT IN ('lazada','shopee','grabfood','lineman','foodpanda')
        )
        AND (
          NULLIF(btrim(c.phone),'') IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM bms_customer_addresses a
             WHERE a.tenant_id=$1 AND a.customer_id=c.id AND a.address_type='shipping'
          )
        )`, [tenantId]),
    query<any>(`WITH normalized AS (
        SELECT regexp_replace(phone, '[^0-9]+', '', 'g') AS phone_key
          FROM bms_customers
         WHERE tenant_id=$1 AND deleted_at IS NULL AND NULLIF(btrim(phone),'') IS NOT NULL
      ), duplicates AS (
        SELECT phone_key, COUNT(*)::int AS customers
          FROM normalized WHERE length(phone_key) >= 8
         GROUP BY phone_key HAVING COUNT(*) > 1
      )
      SELECT COUNT(*)::int AS group_count, COALESCE(SUM(customers),0)::int AS customer_count
        FROM duplicates`, [tenantId]),
    query<any>(`SELECT COUNT(DISTINCT p.id)::int AS count
      FROM bms_payments p
      JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
      WHERE p.tenant_id=$1 AND p.status='CONFIRMED' AND o.status='PENDING'`, [tenantId]),
    query<any>(`WITH paid AS (
        SELECT (total_amount+COALESCE(shipping_fee,0))::numeric AS amount
          FROM bms_orders
         WHERE tenant_id=$1 AND status=ANY($2)
           AND COALESCE(paid_at,created_at) >= now()-interval '90 days'
      ), stats AS (
        SELECT COUNT(*)::int AS sample_size, AVG(amount) AS avg_amount,
               COALESCE(STDDEV_SAMP(amount),0) AS stddev_amount FROM paid
      ), candidates AS (
        SELECT (total_amount+COALESCE(shipping_fee,0))::numeric AS amount
          FROM bms_orders
         WHERE tenant_id=$1 AND status NOT IN ('CANCELLED','RETURNED')
           AND created_at >= now()-interval '90 days'
      )
      SELECT stats.sample_size,
             COUNT(*) FILTER (
               WHERE candidates.amount > 50000
                  OR (stats.sample_size >= 20
                      AND candidates.amount > stats.avg_amount + 4*stats.stddev_amount)
             )::int AS outlier_count
        FROM stats LEFT JOIN candidates ON TRUE
       GROUP BY stats.sample_size, stats.avg_amount, stats.stddev_amount`, [tenantId, ["PAID","PACKING","SHIPPED","COMPLETED"]]),
    listChannelHealth(tenantId),
    listChannelsMasked(tenantId),
    collectDeliverySignals(tenantId),
  ]);
  const signals: Signal[] = [...deliverySignals];
  const add = (condition: boolean, signal: Signal) => { if (condition) signals.push(signal); };
  add(ops.chatWaitingCount > 0, { key:"ops:chat-waiting",category:"SALES",priority:"CRITICAL",title:"ตอบลูกค้าที่กำลังรอ",titleEn:"Reply to waiting customers",evidence:{count:ops.chatWaitingCount},expectedImpact:"ลดโอกาสเสียลูกค้าจากการตอบช้า",expectedImpactEn:"Reduce lost customers caused by slow replies",confidence:.95,dueHours:1,deepLink:"/admin/inbox" });
  add(ops.slipPendingCount > 0, { key:"ops:slip-pending",category:"OPERATIONS",priority:"HIGH",title:"ตรวจสลิปรออนุมัติ",titleEn:"Review pending payment slips",evidence:{count:ops.slipPendingCount},expectedImpact:"ปลดออเดอร์ให้เดินหน้าต่อและลดเวลารอชำระ",expectedImpactEn:"Release orders for processing and reduce payment wait time",confidence:1,dueHours:4,deepLink:"/admin/payment?status=PENDING" });
  add(ops.packingOverdueCount > 0, { key:"ops:packing-overdue",category:"OPERATIONS",priority:"HIGH",title:"เร่งออเดอร์แพ็กเกินกำหนด",titleEn:"Resolve overdue packing orders",evidence:{count:ops.packingOverdueCount},expectedImpact:"ลดการส่งล่าช้าและข้อร้องเรียน",expectedImpactEn:"Reduce late shipments and complaints",confidence:1,dueHours:4,deepLink:"/admin/orders?status=PACKING" });
  add(inventory.summary.stockoutWithin7DaysCount > 0, { key:"stock:stockout-7d",category:"STOCK",priority:"HIGH",title:"ทบทวนสินค้าที่เสี่ยงหมดใน 7 วัน",titleEn:"Review variants at risk of stocking out within 7 days",evidence:{count:inventory.summary.stockoutWithin7DaysCount,suggestedUnits:inventory.summary.totalSuggestedQty},expectedImpact:"ลด Lost sales จากของหมด",expectedImpactEn:"Reduce lost sales caused by stock-outs",confidence:.75,dueHours:24,deepLink:"/admin/purchase" });
  add(inventory.summary.slowMovingCount > 0, { key:"stock:slow-moving",category:"STOCK",priority:"MEDIUM",title:"จัดการสินค้าขายช้าและเงินจม",titleEn:"Act on slow-moving and dead stock",evidence:{count:inventory.summary.slowMovingCount},expectedImpact:"คืนเงินสดจากสต็อกที่หมุนช้า",expectedImpactEn:"Release cash trapped in slow inventory",confidence:.7,dueHours:72,deepLink:"/admin/products" });
  add(inventory.summary.expiringLotCount > 0, { key:"stock:expiring",category:"STOCK",priority:"HIGH",title:"จัดการล็อตใกล้หมดอายุ",titleEn:"Act on expiring inventory lots",evidence:{count:inventory.summary.expiringLotCount,units:inventory.summary.expiringUnits},expectedImpact:"ลดของเสียจากหมดอายุด้วย FEFO, ลดราคา หรือโอนสาขา",expectedImpactEn:"Reduce expiry waste with FEFO, markdowns, or transfers",confidence:.95,dueHours:24,deepLink:"/admin/products" });
  add(Number(margin.rows[0]?.non_positive_count)>0, { key:"margin:non-positive",category:"MARGIN",priority:"HIGH",title:"ตรวจสินค้าที่ราคาขายไม่สูงกว่าทุน",titleEn:"Review products priced at or below cost",evidence:{count:Number(margin.rows[0]?.non_positive_count)},expectedImpact:"หยุดการขายที่ไม่สร้างกำไรขั้นต้น",expectedImpactEn:"Stop sales that produce no gross margin",confidence:.9,dueHours:24,deepLink:"/admin/products" });
  add(Number(margin.rows[0]?.missing_cost_count)>0, { key:"margin:missing-cost",category:"MARGIN",priority:"HIGH",title:"เติมต้นทุนสินค้าที่หาย",titleEn:"Complete missing product costs",evidence:{count:Number(margin.rows[0]?.missing_cost_count)},expectedImpact:"ทำให้รายงานกำไรไม่ตีต้นทุนที่หายเป็นศูนย์",expectedImpactEn:"Prevent profit reports from treating missing costs as zero",confidence:1,dueHours:24,deepLink:"/admin/products" });
  add(Number(margin.rows[0]?.zero_price_count)>0, { key:"margin:zero-price",category:"MARGIN",priority:"HIGH",title:"ตรวจสินค้าที่ราคาขายเป็นศูนย์",titleEn:"Review zero-priced products",evidence:{count:Number(margin.rows[0]?.zero_price_count)},expectedImpact:"ยืนยันว่าราคาศูนย์เป็นของแจกโดยตั้งใจ ไม่ใช่ข้อมูลผิด",expectedImpactEn:"Confirm zero prices are intentional giveaways rather than bad data",confidence:1,dueHours:24,deepLink:"/admin/products" });
  add(Number(customerQuality.rows[0]?.count)>0, { key:"customer:missing-checkout",category:"SALES",priority:"HIGH",title:"เติมข้อมูลจัดส่งลูกค้าที่ไม่ครบ",titleEn:"Complete missing customer delivery data",evidence:{count:Number(customerQuality.rows[0]?.count)},expectedImpact:"ลดออเดอร์ที่ค้างเพราะไม่มีเบอร์หรือที่อยู่จัดส่ง",expectedImpactEn:"Reduce orders blocked by missing phone or shipping address",confidence:1,dueHours:24,deepLink:"/admin/customers" });
  add(Number(duplicateCustomers.rows[0]?.group_count)>0, { key:"customer:possible-duplicates",category:"SALES",priority:"MEDIUM",title:"ตรวจลูกค้าที่อาจซ้ำข้ามช่องทาง",titleEn:"Review possible cross-channel duplicate customers",evidence:{groups:Number(duplicateCustomers.rows[0]?.group_count),customers:Number(duplicateCustomers.rows[0]?.customer_count)},expectedImpact:"รวมประวัติของคนเดียวกันหลังพนักงานยืนยันตัวตน",expectedImpactEn:"Unify one person's history after staff verifies identity",confidence:.7,dueHours:72,deepLink:"/admin/customers" });
  add(Number(paymentConflicts.rows[0]?.count)>0, { key:"payment:order-conflict",category:"OPERATIONS",priority:"CRITICAL",title:"แก้ payment ยืนยันแล้วแต่ออเดอร์ยัง PENDING",titleEn:"Resolve confirmed payments with pending orders",evidence:{count:Number(paymentConflicts.rows[0]?.count)},expectedImpact:"คืนความสอดคล้องของสถานะเงินและออเดอร์ก่อนทำงานต่อ",expectedImpactEn:"Restore payment/order consistency before fulfillment continues",confidence:1,dueHours:1,deepLink:"/admin/payment?status=CONFIRMED" });
  add(Number(orderOutliers.rows[0]?.outlier_count)>0, { key:"sales:high-value-outlier",category:"SALES",priority:"HIGH",title:"ตรวจออเดอร์มูลค่าสูงผิดปกติ",titleEn:"Review unusually high-value orders",evidence:{count:Number(orderOutliers.rows[0]?.outlier_count),sampleSize:Number(orderOutliers.rows[0]?.sample_size),rule:"over 50000 absolute, or mean + 4sd with at least 20 paid orders"},expectedImpact:"แยกยอดขายจริงออกจากการกรอกผิดหรือทุจริต",expectedImpactEn:"Distinguish genuine sales from input errors or fraud",confidence:.85,dueHours:4,deepLink:"/admin/orders" });
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
