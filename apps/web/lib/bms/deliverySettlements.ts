import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["GRABFOOD", "LINEMAN", "FOODPANDA"]);
const ADJUSTMENT_TYPES = new Set(["CHARGEBACK", "PENALTY", "REFUND", "PROVIDER_CORRECTION", "APPEAL_RESULT"]);
const DISPUTE_STATUSES = new Set(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "WON", "LOST", "CANCELLED"]);

function text(value: unknown, max = 500) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) throw new Error("DELIVERY_SETTLEMENT_TEXT_INVALID");
  return result;
}

function optionalText(value: unknown, max = 500) {
  const result = typeof value === "string" ? value.trim() : "";
  return result ? result.slice(0, max) : null;
}

function money(value: unknown, allowNegative = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || (!allowNegative && result < 0) || Math.abs(result) > 999999999999.99) {
    throw new Error("DELIVERY_SETTLEMENT_AMOUNT_INVALID");
  }
  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function instant(value: unknown, code: string) {
  const result = typeof value === "string" ? new Date(value) : null;
  if (!result || Number.isNaN(result.getTime())) throw new Error(code);
  return result.toISOString();
}

export async function listDeliveryFinance(tenantId: string, limit = 100) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const [settlements, lines, adjustments, disputes] = await Promise.all([
      client.query<any>(
        `SELECT s.*, i.environment
           FROM bms_delivery_settlements s
           JOIN bms_delivery_integrations i ON i.tenant_id=s.tenant_id AND i.id=s.integration_id
          WHERE s.tenant_id=$1 ORDER BY s.period_end DESC, s.created_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
      client.query<any>(
        `SELECT sl.*, s.statement_reference, d.provider_display_number
           FROM bms_delivery_settlement_lines sl
           JOIN bms_delivery_settlements s ON s.tenant_id=sl.tenant_id AND s.id=sl.settlement_id
           LEFT JOIN bms_delivery_orders d ON d.tenant_id=sl.tenant_id AND d.id=sl.delivery_order_id
          WHERE sl.tenant_id=$1 ORDER BY sl.updated_at DESC LIMIT $2`,
        [tenantId, bounded * 5],
      ),
      client.query<any>(
        `SELECT a.*, d.provider_order_id
           FROM bms_delivery_adjustments a
           LEFT JOIN bms_delivery_orders d ON d.tenant_id=a.tenant_id AND d.id=a.delivery_order_id
          WHERE a.tenant_id=$1 ORDER BY a.effective_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
      client.query<any>(
        `SELECT d.*, o.provider_order_id, o.provider_display_number
           FROM bms_delivery_disputes d
           LEFT JOIN bms_delivery_orders o ON o.tenant_id=d.tenant_id AND o.id=d.delivery_order_id
          WHERE d.tenant_id=$1 ORDER BY d.updated_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
    ]);
    await client.query("COMMIT");
    return { settlements: settlements.rows, lines: lines.rows, adjustments: adjustments.rows, disputes: disputes.rows };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function importManualDeliverySettlement(input: {
  tenantId: string; actorUserId: string; integrationId: string; provider: unknown;
  statementReference: unknown; periodStart: unknown; periodEnd: unknown; currency?: unknown;
  discountAmount?: unknown; commissionAmount?: unknown; lines: unknown;
}) {
  if (!UUID_RE.test(input.integrationId)) throw new Error("DELIVERY_INTEGRATION_ID_INVALID");
  const provider = String(input.provider ?? "").toUpperCase();
  if (!PROVIDERS.has(provider)) throw new Error("DELIVERY_PROVIDER_INVALID");
  const statementReference = text(input.statementReference, 300);
  const periodStart = instant(input.periodStart, "DELIVERY_SETTLEMENT_PERIOD_INVALID");
  const periodEnd = instant(input.periodEnd, "DELIVERY_SETTLEMENT_PERIOD_INVALID");
  if (periodEnd <= periodStart) throw new Error("DELIVERY_SETTLEMENT_PERIOD_INVALID");
  const currency = String(input.currency ?? "THB").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("DELIVERY_CURRENCY_INVALID");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) {
    throw new Error("DELIVERY_SETTLEMENT_LINES_INVALID");
  }
  const statementDiscount = money(input.discountAmount ?? 0);
  const statementCommission = money(input.commissionAmount ?? 0);
  const lines = input.lines.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`DELIVERY_SETTLEMENT_LINE_INVALID:${index}`);
    const row = raw as Record<string, unknown>;
    return {
      providerOrderId: text(row.providerOrderId, 500),
      gross: money(row.grossAmount ?? 0), fee: money(row.feeAmount ?? 0),
      refund: money(row.refundAmount ?? 0), adjustment: money(row.adjustmentAmount ?? 0, true),
      actualNet: money(row.actualNetAmount ?? 0, true),
      providerReference: optionalText(row.providerReference, 500),
    };
  });
  if (new Set(lines.map((line) => line.providerOrderId)).size !== lines.length) {
    throw new Error("DELIVERY_SETTLEMENT_DUPLICATE_ORDER");
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const integration = await client.query<{ provider: string }>(
      `SELECT provider FROM bms_delivery_integrations
        WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
      [input.tenantId, input.integrationId],
    );
    if (!integration.rowCount || integration.rows[0].provider !== provider) throw new Error("DELIVERY_INTEGRATION_SCOPE_INVALID");
    const duplicate = await client.query(
      `SELECT 1 FROM bms_delivery_settlements
        WHERE tenant_id=$1 AND integration_id=$2 AND statement_reference=$3`,
      [input.tenantId, input.integrationId, statementReference],
    );
    if (duplicate.rowCount) throw new Error("DELIVERY_SETTLEMENT_ALREADY_IMPORTED");

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_settlements
        (tenant_id,integration_id,provider,period_start,period_end,statement_reference,source,currency,imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MANUAL',$7,$8) RETURNING id`,
      [input.tenantId, input.integrationId, provider, periodStart, periodEnd, statementReference, currency, input.actorUserId],
    );
    const settlementId = inserted.rows[0].id;
    let gross = 0, fees = 0, refunds = 0, adjustments = 0, actual = 0, expected = 0;
    let mismatches = 0;
    for (const line of lines) {
      const order = await client.query<{ id: string; bms_order_id: string | null; expected_settlement_amount: string; currency: string }>(
        `SELECT id,bms_order_id,expected_settlement_amount,currency
           FROM bms_delivery_orders
          WHERE tenant_id=$1 AND integration_id=$2 AND provider_order_id=$3 FOR SHARE`,
        [input.tenantId, input.integrationId, line.providerOrderId],
      );
      const matched = order.rows[0];
      const expectedLine = matched ? Number(matched.expected_settlement_amount) : 0;
      const expectedAfterStatement = Math.round((expectedLine - line.fee - line.refund + line.adjustment) * 100) / 100;
      let refundMatches = line.refund === 0;
      if (matched?.bms_order_id && line.refund > 0) {
        const refund = await client.query<{ requested: string; completed: string; pending: number }>(
          `SELECT COALESCE(SUM(a.amount),0) AS requested,
                  COALESCE(SUM(a.amount) FILTER (WHERE a.status='COMPLETED'),0) AS completed,
                  COUNT(*) FILTER (WHERE a.status='PENDING')::int AS pending
             FROM bms_pos_refund_allocations a
             JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
            WHERE a.tenant_id=$1 AND pr.order_id=$2 AND a.method='PLATFORM_SETTLEMENT'`,
          [input.tenantId, matched.bms_order_id],
        );
        const requestedRefund = Number(refund.rows[0]?.requested ?? 0);
        refundMatches = Math.abs(requestedRefund - line.refund) <= 0.009;
        if (refundMatches && Number(refund.rows[0]?.pending ?? 0) > 0) {
          await client.query(
            `UPDATE bms_pos_refund_allocations a
                SET status='COMPLETED',external_ref=$3,completed_by=$4,completed_at=now(),updated_at=now()
               FROM bms_pos_returns pr
              WHERE a.tenant_id=$1 AND a.pos_return_id=pr.id AND pr.tenant_id=$1 AND pr.order_id=$2
                AND a.method='PLATFORM_SETTLEMENT' AND a.status='PENDING'`,
            [input.tenantId, matched.bms_order_id, statementReference, input.actorUserId],
          );
          await client.query(
            `UPDATE bms_pos_returns pr SET settlement_status='COMPLETED',updated_at=now()
              WHERE pr.tenant_id=$1 AND pr.order_id=$2
                AND NOT EXISTS (SELECT 1 FROM bms_pos_refund_allocations a
                                 WHERE a.tenant_id=pr.tenant_id AND a.pos_return_id=pr.id AND a.status='PENDING')`,
            [input.tenantId, matched.bms_order_id],
          );
          await client.query(
            `UPDATE bms_payments p SET status='REFUNDED',verified_by=$3,
                    refunded_at=COALESCE(refunded_at,now()),updated_at=now()
              WHERE p.tenant_id=$1 AND p.order_id=$2 AND p.method='PLATFORM_SETTLEMENT'
                AND p.status='CONFIRMED'
                AND (SELECT COALESCE(SUM(a.amount),0) FROM bms_pos_refund_allocations a
                      WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id AND a.status='COMPLETED')
                    >= p.amount-0.01`,
            [input.tenantId, matched.bms_order_id, input.actorUserId],
          );
          await client.query(
            `UPDATE bms_delivery_orders d
                SET payment_status=CASE WHEN o.status='RETURNED' THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,
                    updated_at=now()
               FROM bms_orders o
              WHERE d.tenant_id=$1 AND d.id=$2 AND o.tenant_id=d.tenant_id AND o.id=d.bms_order_id`,
            [input.tenantId, matched.id],
          );
          await client.query(
            `INSERT INTO bms_delivery_order_events
              (tenant_id,delivery_order_id,event_kind,actor_type,actor_id,source,safe_detail)
             VALUES ($1,$2,'PROVIDER_REFUND_CONFIRMED','USER',$3,'SETTLEMENT',$4::jsonb)`,
            [input.tenantId, matched.id, input.actorUserId,
              JSON.stringify({ statementReference, refundAmount: line.refund })],
          );
        }
      }
      const status = !matched ? "MISSING_ORDER"
        : !refundMatches ? "REFUND_MISMATCH"
          : matched.currency !== currency
            || ((statementDiscount === 0 && statementCommission === 0)
              && Math.abs(expectedAfterStatement - line.actualNet) > 0.009) ? "AMOUNT_MISMATCH"
            : "MATCHED";
      if (status !== "MATCHED") mismatches += 1;
      await client.query(
        `INSERT INTO bms_delivery_settlement_lines
          (tenant_id,settlement_id,delivery_order_id,bms_order_id,provider_order_id,gross_amount,
           fee_amount,refund_amount,adjustment_amount,actual_net_amount,reconciliation_status,safe_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [input.tenantId, settlementId, matched?.id ?? null, matched?.bms_order_id ?? null, line.providerOrderId,
          line.gross, line.fee, line.refund, line.adjustment, line.actualNet, status,
          JSON.stringify({ expectedNet: expectedAfterStatement, providerReference: line.providerReference,
            refundConfirmed: line.refund > 0 && refundMatches })],
      );
      gross += line.gross; fees += line.fee; refunds += line.refund;
      adjustments += line.adjustment; actual += line.actualNet; expected += expectedAfterStatement;
    }

    const missing = await client.query<{ id: string; bms_order_id: string | null; provider_order_id: string; expected_settlement_amount: string }>(
      `SELECT d.id,d.bms_order_id,d.provider_order_id,d.expected_settlement_amount
         FROM bms_delivery_orders d
        WHERE d.tenant_id=$1 AND d.integration_id=$2 AND d.created_at >= $3 AND d.created_at < $4
          AND d.payment_status='PLATFORM_CONFIRMED'
          AND NOT EXISTS (SELECT 1 FROM bms_delivery_settlement_lines sl
                           WHERE sl.tenant_id=d.tenant_id AND sl.settlement_id=$5
                             AND sl.provider_order_id=d.provider_order_id)`,
      [input.tenantId, input.integrationId, periodStart, periodEnd, settlementId],
    );
    for (const row of missing.rows) {
      await client.query(
        `INSERT INTO bms_delivery_settlement_lines
          (tenant_id,settlement_id,delivery_order_id,bms_order_id,provider_order_id,reconciliation_status,safe_detail)
         VALUES ($1,$2,$3,$4,$5,'MISSING_SETTLEMENT',$6::jsonb)`,
        [input.tenantId, settlementId, row.id, row.bms_order_id, row.provider_order_id,
          JSON.stringify({ expectedNet: Number(row.expected_settlement_amount) })],
      );
      expected += Number(row.expected_settlement_amount);
      mismatches += 1;
    }
    expected = Math.round((expected - statementDiscount - statementCommission) * 100) / 100;
    const status = mismatches === 0 && Math.abs(expected - actual) <= 0.009 ? "MATCHED" : "MISMATCH";
    await client.query(
      `UPDATE bms_delivery_settlements SET gross_amount=$3,fee_amount=$4,refund_amount=$5,
         adjustment_amount=$6,expected_net_amount=$7,actual_net_amount=$8,status=$9,
         discount_amount=$10,commission_amount=$11,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, settlementId, gross, fees, refunds, adjustments, expected, actual, status,
        statementDiscount, statementCommission],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.settlement_imported',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, settlementId,
        JSON.stringify({ provider, statementReference, lineCount: lines.length, missingCount: missing.rowCount,
          status, discountAmount: statementDiscount, commissionAmount: statementCommission })],
    );
    await client.query("COMMIT");
    return { id: settlementId, status, importedLines: lines.length, missingSettlementLines: missing.rowCount };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function recordDeliveryAdjustment(input: {
  tenantId: string; actorUserId: string; integrationId: string; deliveryOrderId?: unknown;
  settlementLineId?: unknown; adjustmentType: unknown; amount: unknown; currency?: unknown;
  providerReference?: unknown; reason: unknown; effectiveAt: unknown;
}) {
  if (!UUID_RE.test(input.integrationId)) throw new Error("DELIVERY_INTEGRATION_ID_INVALID");
  const deliveryOrderId = optionalText(input.deliveryOrderId, 50);
  const settlementLineId = optionalText(input.settlementLineId, 50);
  if (deliveryOrderId && !UUID_RE.test(deliveryOrderId)) throw new Error("DELIVERY_ORDER_ID_INVALID");
  if (settlementLineId && !UUID_RE.test(settlementLineId)) throw new Error("DELIVERY_SETTLEMENT_LINE_ID_INVALID");
  const adjustmentType = String(input.adjustmentType ?? "").toUpperCase();
  if (!ADJUSTMENT_TYPES.has(adjustmentType)) throw new Error("DELIVERY_ADJUSTMENT_TYPE_INVALID");
  const amount = money(input.amount, true);
  if (amount === 0) throw new Error("DELIVERY_ADJUSTMENT_AMOUNT_INVALID");
  const currency = String(input.currency ?? "THB").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("DELIVERY_CURRENCY_INVALID");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const scope = await client.query(
      `SELECT 1 FROM bms_delivery_integrations WHERE tenant_id=$1 AND id=$2
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_delivery_orders d WHERE d.tenant_id=$1 AND d.id=$3 AND d.integration_id=$2))
        AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_delivery_settlement_lines sl
              JOIN bms_delivery_settlements s ON s.tenant_id=sl.tenant_id AND s.id=sl.settlement_id
             WHERE sl.tenant_id=$1 AND sl.id=$4 AND s.integration_id=$2))
        AND ($3::uuid IS NULL OR $4::uuid IS NULL OR EXISTS (
              SELECT 1 FROM bms_delivery_settlement_lines sl
               WHERE sl.tenant_id=$1 AND sl.id=$4 AND sl.delivery_order_id=$3
            )) FOR SHARE`,
      [input.tenantId, input.integrationId, deliveryOrderId, settlementLineId],
    );
    if (!scope.rowCount) throw new Error("DELIVERY_ADJUSTMENT_SCOPE_INVALID");
    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_adjustments
        (tenant_id,integration_id,delivery_order_id,settlement_line_id,adjustment_type,amount,currency,
         provider_reference,reason,effective_at,recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [input.tenantId, input.integrationId, deliveryOrderId, settlementLineId, adjustmentType, amount, currency,
        optionalText(input.providerReference, 500), text(input.reason, 1000),
        instant(input.effectiveAt, "DELIVERY_ADJUSTMENT_DATE_INVALID"), input.actorUserId],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.adjustment_recorded',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ integrationId: input.integrationId, deliveryOrderId, settlementLineId, adjustmentType, amount, currency })],
    );
    await client.query("COMMIT");
    return { id: saved.rows[0].id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function createDeliveryDispute(input: {
  tenantId: string; actorUserId: string; integrationId: string; deliveryOrderId?: unknown;
  providerCaseId?: unknown; reason: unknown; claimedAmount: unknown; currency?: unknown;
}) {
  if (!UUID_RE.test(input.integrationId)) throw new Error("DELIVERY_INTEGRATION_ID_INVALID");
  const deliveryOrderId = optionalText(input.deliveryOrderId, 50);
  if (deliveryOrderId && !UUID_RE.test(deliveryOrderId)) throw new Error("DELIVERY_ORDER_ID_INVALID");
  const currency = String(input.currency ?? "THB").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("DELIVERY_CURRENCY_INVALID");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const scope = await client.query(
      `SELECT 1 FROM bms_delivery_integrations WHERE tenant_id=$1 AND id=$2
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_delivery_orders d
              WHERE d.tenant_id=$1 AND d.id=$3 AND d.integration_id=$2)) FOR SHARE`,
      [input.tenantId, input.integrationId, deliveryOrderId],
    );
    if (!scope.rowCount) throw new Error("DELIVERY_DISPUTE_SCOPE_INVALID");
    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_disputes
        (tenant_id,integration_id,delivery_order_id,provider_case_id,reason,claimed_amount,currency,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.tenantId, input.integrationId, deliveryOrderId, optionalText(input.providerCaseId, 500),
        text(input.reason, 2000), money(input.claimedAmount), currency, input.actorUserId],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.dispute_created',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ integrationId: input.integrationId, deliveryOrderId, claimedAmount: money(input.claimedAmount), currency })],
    );
    await client.query("COMMIT");
    return { id: saved.rows[0].id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function transitionDeliveryDispute(input: {
  tenantId: string; actorUserId: string; disputeId: string; status: unknown; providerCaseId?: unknown;
}) {
  if (!UUID_RE.test(input.disputeId)) throw new Error("DELIVERY_DISPUTE_ID_INVALID");
  const status = String(input.status ?? "").toUpperCase();
  if (!DISPUTE_STATUSES.has(status)) throw new Error("DELIVERY_DISPUTE_STATUS_INVALID");
  const allowed: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["UNDER_REVIEW", "WON", "LOST", "CANCELLED"],
    UNDER_REVIEW: ["WON", "LOST", "CANCELLED"], WON: [], LOST: [], CANCELLED: [],
  };
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const current = await client.query<{ status: string }>(
      `SELECT status FROM bms_delivery_disputes WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, input.disputeId],
    );
    if (!current.rowCount) throw new Error("DELIVERY_DISPUTE_NOT_FOUND");
    if (!allowed[current.rows[0].status]?.includes(status)) throw new Error("DELIVERY_DISPUTE_TRANSITION_INVALID");
    await client.query(
      `UPDATE bms_delivery_disputes SET status=$3,
         provider_case_id=COALESCE($4,provider_case_id),
         submitted_at=CASE WHEN $3='SUBMITTED' THEN now() ELSE submitted_at END,
         resolved_at=CASE WHEN $3 IN ('WON','LOST') THEN now() ELSE resolved_at END,
         updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, input.disputeId, status, optionalText(input.providerCaseId, 500)],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.dispute_transitioned',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, input.disputeId, JSON.stringify({ from: current.rows[0].status, to: status })],
    );
    await client.query("COMMIT");
    return { id: input.disputeId, status };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
