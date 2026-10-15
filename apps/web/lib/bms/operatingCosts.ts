import { createHash } from "crypto";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { userHasLocationScope } from "./locations";
import { calculateOperatingCosts, costMonth, costSourceKey, normalizeCostDecision, validateCostClassification,
  costReviewIsCurrent, COST_ROW_LIMIT, type ReviewedCostSource, type CostReview } from "./operatingCostMath";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// One canonical row per source, NEVER cash movements + expense, or statement headers + lines.
// Documents use pre-input-VAT base (WHT is not another cost); POS has only gross actual evidence.
const SOURCES_SQL = `WITH sources AS NOT MATERIALIZED (
  SELECT 'DOCUMENT:'||d.id AS key, 'DOCUMENT'::text AS kind, d.id::text,
    to_char(CASE WHEN d.document_kind IN ('SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE')
      THEN d.received_date ELSE d.document_date END,'YYYY-MM') AS month,
    ((CASE WHEN d.document_kind='SUPPLIER_CREDIT_NOTE' THEN -1 ELSE 1 END)*d.amount_before_vat)::text AS amount,
    'THB'::text AS currency, d.category, COALESCE(d.document_no,d.id::text) AS reference,
    (d.status='ACTIVE') AS eligible, d.updated_at::text AS revision
  FROM bms_expense_documents d WHERE d.tenant_id=$1
  UNION ALL
  SELECT 'POS_EXPENSE:'||e.id, 'POS_EXPENSE', e.id::text,
    to_char(COALESCE(e.settled_at,e.created_at) AT TIME ZONE 'Asia/Bangkok','YYYY-MM'),
    e.actual_amount::text, 'THB', e.category, COALESCE(e.receipt_ref,e.id::text),
    (e.status='SETTLED' AND e.actual_amount IS NOT NULL),
    concat_ws('|',e.status,e.funding_source,e.settled_at::text,e.actual_amount::text)
  FROM bms_pos_expenses e WHERE e.tenant_id=$1
  UNION ALL
  SELECT 'STATEMENT:'||s.id, 'STATEMENT', s.id::text,
    to_char(s.period_end AT TIME ZONE 'Asia/Bangkok','YYYY-MM'),
    (s.fee_amount+s.commission_amount)::text, s.currency, 'PLATFORM_GP', s.statement_reference,
    (i.environment='LIVE' AND s.status IN ('MATCHED','CLOSED') AND s.fee_amount>=0 AND s.commission_amount>=0),
    concat_ws('|',s.updated_at::text,i.environment)
  FROM bms_delivery_settlements s JOIN bms_delivery_integrations i
    ON i.tenant_id=s.tenant_id AND i.id=s.integration_id
  WHERE s.tenant_id=$1 AND (i.environment='LIVE' OR EXISTS (
    SELECT 1 FROM bms_operating_cost_reviews prior
    WHERE prior.tenant_id=s.tenant_id AND prior.source_key='STATEMENT:'||s.id))
)`;
const REVIEW_COLUMNS = `r.version, r.source_fingerprint, r.decision`;
function mapSource(row: any): ReviewedCostSource {
  const source = { key: row.key, kind: row.kind, id: row.id, month: row.month, amount: row.amount,
    currency: row.currency, category: row.category, reference: row.reference, eligible: row.eligible === true };
  return { ...source, fingerprint: hash({ ...source, revision: row.revision }),
    review: row.version == null ? null : { ...row.decision, version: Number(row.version), sourceFingerprint: row.source_fingerprint } };
}
async function assertAllBranches(tenantId: string, actorId: string) {
  // Statement-wide GP cannot be allocated to a branch without evidence. Do not leak it via an omitted filter.
  if (await userHasLocationScope(tenantId, actorId)) throw new Error("COST_ALL_BRANCH_ACCESS_REQUIRED");
}
async function sourceInTx(client: any, tenantId: string, key: string): Promise<ReviewedCostSource | null> {
  const result = await client.query(`${SOURCES_SQL} SELECT s.*, ${REVIEW_COLUMNS} FROM sources s
    LEFT JOIN bms_operating_cost_reviews r ON r.tenant_id=$1 AND r.source_key=s.key WHERE s.key=$2`, [tenantId, key]);
  return result.rows[0] ? mapSource(result.rows[0]) : null;
}

export async function getOperatingCostReport(tenantId: string, actorId: string, monthValue: string) {
  const month = costMonth(monthValue);
  await assertAllBranches(tenantId, actorId);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const report = await getOperatingCostsInTx(client, tenantId, month);
    await client.query("COMMIT");
    return report;
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

/** Internal composition: caller owns tenant transaction and all-source/all-branch authorization. */
export async function getOperatingCostsInTx(client: any, tenantId: string, monthValue: string) {
    const month = costMonth(monthValue);
    const result = await client.query(`${SOURCES_SQL}, selected AS (
      SELECT s.*, ${REVIEW_COLUMNS} FROM sources s LEFT JOIN bms_operating_cost_reviews r
        ON r.tenant_id=$1 AND r.source_key=s.key
      WHERE s.month=$2 OR (r.decision->>'disposition'='DEPRECIATION'
        AND r.decision->>'startMonth'<=$2)
      ORDER BY s.month DESC,s.key LIMIT $3
    ), targets AS (
      SELECT s.*, ${REVIEW_COLUMNS} FROM sources s JOIN bms_operating_cost_reviews r
        ON r.tenant_id=$1 AND r.source_key=s.key
      WHERE s.key IN (SELECT decision->>'duplicateKey' FROM selected)
        AND s.key NOT IN (SELECT key FROM selected)
    ) SELECT * FROM selected UNION ALL SELECT * FROM targets`, [tenantId, month, COST_ROW_LIMIT + 1]);
    const mapped: ReviewedCostSource[] = result.rows.map(mapSource);
    // Targets outside the month are needed only to validate a duplicate's canonical evidence.
    const candidateCount = mapped.filter(s => s.month === month || s.review?.disposition === "DEPRECIATION").length;
    const report = calculateOperatingCosts(month, mapped, candidateCount > COST_ROW_LIMIT);
    return report;
}

export async function reviewOperatingCost(tenantId: string, actorId: string, input: any): Promise<{ version: number }> {
  const identity = costSourceKey(input?.sourceKey);
  const decision = normalizeCostDecision(input);
  if (input.confirmed !== true || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 2147483647
    || typeof input.sourceFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceFingerprint)) throw new Error("COST_CONFIRMATION_REQUIRED");
  if (decision.duplicateKey === identity.key) throw new Error("COST_DUPLICATE_SELF");
  await assertAllBranches(tenantId, actorId);
  const requestHash = hash({ key: identity.key, expectedVersion: input.expectedVersion,
    sourceFingerprint: input.sourceFingerprint, decision });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    // Serialize decision graphs, including a canonical target changing while a duplicate is reviewed.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`operating-cost-review:${tenantId}`]);
    const prior = (await client.query(`SELECT version,request_hash,decision FROM bms_operating_cost_reviews
      WHERE tenant_id=$1 AND source_key=$2 FOR UPDATE`, [tenantId, identity.key])).rows[0];
    if (prior?.request_hash === requestHash) { await client.query("COMMIT"); return { version: Number(prior.version) }; }
    if (Number(prior?.version ?? 0) !== input.expectedVersion) throw new Error("COST_REVIEW_CONFLICT");
    // Polymorphic identities are never client authority: lock and re-read the tenant-owned source.
    const tables = { DOCUMENT: "bms_expense_documents", POS_EXPENSE: "bms_pos_expenses", STATEMENT: "bms_delivery_settlements" };
    for (const key of [identity.key, ...(decision.duplicateKey ? [decision.duplicateKey] : [])].sort()) {
      const ref = costSourceKey(key);
      await client.query(`SELECT id FROM ${tables[ref.kind]} WHERE tenant_id=$1 AND id=$2 FOR SHARE`, [tenantId, ref.id]);
    }
    const source = await sourceInTx(client, tenantId, identity.key);
    if (!source) throw new Error("COST_SOURCE_NOT_FOUND");
    if (source.fingerprint !== input.sourceFingerprint) throw new Error("COST_SOURCE_CHANGED");
    validateCostClassification(source, decision);
    if (decision.duplicateKey) {
      const target = await sourceInTx(client, tenantId, decision.duplicateKey);
      if (!target || !costReviewIsCurrent(target) || !["OPERATING", "GP", "DEPRECIATION"].includes(target.review!.disposition)) throw new Error("COST_CANONICAL_REVIEW_REQUIRED");
      validateCostClassification(target, normalizeCostDecision(target.review));
    }
    const version = input.expectedVersion + 1;
    await client.query(`INSERT INTO bms_operating_cost_reviews
      (tenant_id,source_key,version,source_fingerprint,decision,request_hash,reviewed_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
      ON CONFLICT (tenant_id,source_key) DO UPDATE SET version=EXCLUDED.version,
        source_fingerprint=EXCLUDED.source_fingerprint,decision=EXCLUDED.decision,
        request_hash=EXCLUDED.request_hash,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()`,
    [tenantId, identity.key, version, source.fingerprint, JSON.stringify(decision), requestHash, actorId]);
    await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
      VALUES ($1,$2,'report.operating_cost_review',$3,$4::jsonb)`,
    [tenantId, actorId, identity.key, JSON.stringify({ version, before: prior?.decision ?? null, after: decision })]);
    await client.query("COMMIT"); return { version };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}
