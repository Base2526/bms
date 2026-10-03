import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx, getTenantId } from "./tenant";
import { requirePermission } from "./permissions";
import { listLocationsForUser } from "./locations";
import {
  getFullTaxInvoiceView,
  issueFullTaxInvoiceInTx,
  type FullInvoiceBuyer,
} from "./taxDocuments";
import { isValidThaiTaxId } from "./thaiTaxId";
import {
  parseTaxRequestAccess,
  taxRequestAccessHash,
  taxRequestConfiguration,
  verifyTaxRequestToken,
} from "./taxRequestToken";
import { taxRequestDeadline, taxRequestPolicy } from "./taxRequestPolicy";

const sameBuyer = (a: FullInvoiceBuyer, b: FullInvoiceBuyer) =>
  Object.entries(a).every(
    ([key, value]) => b[key as keyof FullInvoiceBuyer] === value
  );
async function policyInTx(
  client: PoolClient,
  deadline: Date | string,
  count: number,
  status: string
) {
  const clock = await client.query(`SELECT clock_timestamp() AS now`);
  return taxRequestPolicy(deadline, count, status, clock.rows[0].now);
}
function enforceSubmissionPolicy(policy: ReturnType<typeof taxRequestPolicy>) {
  if (policy.expired)
    throw new TaxRequestError(
      "ครบกำหนด 7 วันหลังขายแล้ว ไม่สามารถส่งหรือแก้ไขคำขอออนไลน์ได้ กรุณาติดต่อร้าน",
      410
    );
  if (!policy.remaining)
    throw new TaxRequestError(
      "ส่งข้อมูลครบ 3 ครั้งต่อใบเสร็จแล้ว กรุณาติดต่อร้าน",
      409
    );
}

export class TaxRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function cloudOnly() {
  if (!taxRequestConfiguration().enabled)
    throw new TaxRequestError(
      "บริการขอใบกำกับภาษีออนไลน์ยังไม่เปิดใช้งาน กรุณาติดต่อร้าน",
      404
    );
}
async function inTenant<T>(
  tenantId: string,
  actor: string | null,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  cloudOnly();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor });
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
const unavailable = () =>
  new TaxRequestError(
    "บิลนี้ไม่สามารถขอผ่านช่องทางออนไลน์ได้ หรือมีคำขอ/ใบเต็มอยู่แล้ว กรุณาติดต่อร้าน",
    409
  );
const clean = (v: unknown, max: number, required = true): string => {
  if (typeof v !== "string") {
    if (!required && v == null) return "";
    throw new TaxRequestError("ข้อมูลไม่ครบถ้วน");
  }
  const value = v.trim();
  if (
    (required && !value) ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new TaxRequestError("ข้อมูลไม่ถูกต้องหรือยาวเกินกำหนด");
  return value;
};
export function normalizeTaxRequestBuyer(raw: unknown): FullInvoiceBuyer {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TaxRequestError("กรุณากรอกข้อมูลผู้ซื้อ");
  const b = raw as Record<string, unknown>;
  const taxId = clean(b.taxId, 13),
    branchCode = clean(b.branchCode, 5);
  if (!isValidThaiTaxId(taxId) || !/^\d{5}$/.test(branchCode))
    throw new TaxRequestError(
      "เลขผู้เสียภาษีหรือรหัสสาขาไม่ถูกต้อง (สำนักงานใหญ่ 00000)"
    );
  return {
    name: clean(b.name, 200),
    taxId,
    branchCode,
    address: clean(b.address, 1000),
    phone: clean(b.phone, 30, false) || null,
  };
}
async function receiptOrder(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  enforceWindow: boolean
) {
  // Same order-first lock order as issuance/return. No public body controls tenant or amount.
  const res = await client.query(
    `SELECT o.id,o.location_id,o.status,o.voided_at,o.created_at,
      t.name AS store_name, d.doc_no, d.grand_total, d.issued_at AS receipt_issued_at
    FROM bms_orders o JOIN bms_tenants t ON t.id=o.tenant_id
    JOIN bms_tax_documents d ON d.tenant_id=o.tenant_id AND d.order_id=o.id
      AND d.doc_type='ABBREVIATED' AND d.cancelled_at IS NULL
    WHERE o.tenant_id=$1 AND o.id=$2 FOR UPDATE OF o`,
    [tenantId, orderId]
  );
  const row = res.rows[0];
  if (!row || row.status !== "COMPLETED" || row.voided_at) throw unavailable();
  row.request_deadline = taxRequestDeadline(row.receipt_issued_at);
  row.policy = await policyInTx(client, row.request_deadline, 0, "PENDING");
  if (enforceWindow) enforceSubmissionPolicy(row.policy);
  const invalid = await client.query(
    `SELECT 1 FROM bms_pos_returns WHERE tenant_id=$1 AND order_id=$2 AND is_void=FALSE
    UNION ALL SELECT 1 FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2 AND doc_type='FULL' AND cancelled_at IS NULL`,
    [tenantId, orderId]
  );
  if (invalid.rowCount) throw unavailable();
  return row;
}
async function audit(
  client: PoolClient,
  tenantId: string,
  actor: string | null,
  id: string,
  action: string
) {
  await client.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,'{}'::jsonb)`,
    [tenantId, actor ?? "customer", `tax.request.${action}`, id]
  );
}
export async function inspectTaxReceipt(token: string) {
  const identity = verifyTaxRequestToken(token);
  if (!identity)
    throw new TaxRequestError("ลิงก์ไม่ถูกต้องหรือบริการไม่พร้อมใช้งาน", 404);
  return inTenant(identity.tenantId, null, async (client) => {
    const row = await receiptOrder(
      client,
      identity.tenantId,
      identity.orderId,
      true
    );
    const prior = await client.query(
      `SELECT 1 FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND order_id=$2`,
      [identity.tenantId, identity.orderId]
    );
    if (prior.rowCount) throw unavailable();
    return {
      storeName: row.store_name,
      documentNo: row.doc_no,
      total: Number(row.grand_total),
      policy: row.policy,
    };
  });
}
export async function submitTaxRequest(
  token: string,
  rawBuyer: unknown,
  accessSecret: string
) {
  const identity = verifyTaxRequestToken(token);
  if (!identity)
    throw new TaxRequestError("ลิงก์ไม่ถูกต้องหรือบริการไม่พร้อมใช้งาน", 404);
  const buyer = normalizeTaxRequestBuyer(rawBuyer),
    accessHash = taxRequestAccessHash(accessSecret);
  return inTenant(identity.tenantId, null, async (client) => {
    // Lock before looking for a replay; a network retry cannot create a second request.
    await client.query(
      `SELECT id FROM bms_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [identity.tenantId, identity.orderId]
    );
    const prior = await client.query(
      `SELECT id,access_hash,buyer FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND order_id=$2`,
      [identity.tenantId, identity.orderId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].access_hash !== accessHash) throw unavailable();
      const first = await client.query(
        `SELECT buyer FROM bms_tax_request_submissions
        WHERE tenant_id=$1 AND request_id=$2 AND client_version=0`,
        [identity.tenantId, prior.rows[0].id]
      );
      if (!sameBuyer(buyer, first.rows[0]?.buyer ?? prior.rows[0].buyer))
        throw new TaxRequestError(
          "คำขอนี้มีข้อมูลต่างจากครั้งก่อน กรุณาเปิดลิงก์ติดตามเพื่อแก้ไข",
          409
        );
      return {
        access: `${identity.tenantId}.${prior.rows[0].id}.${accessSecret}`,
      };
    }
    const order = await receiptOrder(
      client,
      identity.tenantId,
      identity.orderId,
      true
    );
    const row = await client.query(
      `INSERT INTO bms_tax_invoice_requests(tenant_id,location_id,order_id,buyer,access_hash,request_deadline)
      VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
      [
        identity.tenantId,
        order.location_id,
        identity.orderId,
        JSON.stringify(buyer),
        accessHash,
        order.request_deadline,
      ]
    );
    await client.query(
      `INSERT INTO bms_tax_request_submissions(tenant_id,request_id,submission_no,client_version,buyer)
      VALUES($1,$2,1,0,$3::jsonb)`,
      [identity.tenantId, row.rows[0].id, JSON.stringify(buyer)]
    );
    await audit(client, identity.tenantId, null, row.rows[0].id, "submit");
    return { access: `${identity.tenantId}.${row.rows[0].id}.${accessSecret}` };
  });
}
/** Lost-response recovery requires the browser's independently generated secret, not just the receipt. */
export async function recoverTaxRequest(token: string, accessSecret: string) {
  const identity = verifyTaxRequestToken(token);
  if (!identity) throw new TaxRequestError("ลิงก์ไม่ถูกต้อง", 404);
  const hash = taxRequestAccessHash(accessSecret);
  return inTenant(identity.tenantId, null, async (client) => {
    const row = await client.query(
      `SELECT id FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND order_id=$2 AND access_hash=$3 AND access_expires_at>now()`,
      [identity.tenantId, identity.orderId, hash]
    );
    return {
      access: row.rows[0]
        ? `${identity.tenantId}.${row.rows[0].id}.${accessSecret}`
        : null,
    };
  });
}
async function accessRow(
  client: PoolClient,
  identity: ReturnType<typeof parseTaxRequestAccess>,
  lock = false
) {
  const result = await client.query(
    `SELECT * FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND id=$2 AND access_hash=$3 AND access_expires_at>now() ${
      lock ? "FOR UPDATE" : ""
    }`,
    [identity.tenantId, identity.id, identity.accessHash]
  );
  if (!result.rows[0])
    throw new TaxRequestError(
      "ไม่พบคำขอหรือลิงก์ติดตามหมดอายุ กรุณาติดต่อร้าน",
      404
    );
  return result.rows[0];
}
export async function trackTaxRequest(access: string) {
  const identity = parseTaxRequestAccess(access);
  return inTenant(identity.tenantId, null, async (client) => {
    const row = await accessRow(client, identity);
    let invoice = null,
      documentCancelled = false;
    if (row.status === "ISSUED") {
      const doc = await client.query(
        `SELECT cancelled_at FROM bms_tax_documents WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
        [identity.tenantId, row.document_id]
      );
      documentCancelled = !doc.rows[0] || Boolean(doc.rows[0].cancelled_at);
      if (!documentCancelled)
        invoice = await getFullTaxInvoiceView(
          identity.tenantId,
          row.document_id,
          [row.location_id],
          client
        );
    }
    return {
      status: documentCancelled ? "DOCUMENT_CANCELLED" : row.status,
      version: row.version,
      buyer: row.buyer,
      feedback: row.feedback,
      invoice,
      policy: await policyInTx(
        client,
        row.request_deadline,
        row.submission_count,
        row.status
      ),
    };
  });
}
export async function reviseTaxRequest(
  access: string,
  version: number,
  rawBuyer: unknown
) {
  const identity = parseTaxRequestAccess(access),
    buyer = normalizeTaxRequestBuyer(rawBuyer);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new TaxRequestError("เวอร์ชันคำขอไม่ถูกต้อง");
  return inTenant(identity.tenantId, null, async (client) => {
    // Locate without locking, then order -> request, matching staff approval.
    const found = await accessRow(client, identity);
    await client.query(
      `SELECT id FROM bms_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [identity.tenantId, found.order_id]
    );
    const row = await accessRow(client, identity, true);
    // Replay a committed submission before checking mutable status/deadline/quota.
    const prior = await client.query(
      `SELECT buyer FROM bms_tax_request_submissions
      WHERE tenant_id=$1 AND request_id=$2 AND client_version=$3`,
      [identity.tenantId, row.id, version]
    );
    if (prior.rows[0]) {
      if (!sameBuyer(buyer, prior.rows[0].buyer))
        throw new TaxRequestError(
          "การส่งครั้งนี้มีข้อมูลต่างจากเดิม กรุณาโหลดข้อมูลล่าสุด",
          409
        );
      return { ok: true };
    }
    if (
      !["PENDING", "NEEDS_INFO"].includes(row.status) ||
      row.version !== version
    )
      throw new TaxRequestError("คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่", 409);
    await receiptOrder(client, identity.tenantId, row.order_id, false);
    enforceSubmissionPolicy(
      await policyInTx(
        client,
        row.request_deadline,
        row.submission_count,
        row.status
      )
    );
    await client.query(
      `UPDATE bms_tax_invoice_requests SET buyer=$3::jsonb,status='PENDING',feedback=NULL,version=version+1,submission_count=submission_count+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [identity.tenantId, row.id, JSON.stringify(buyer)]
    );
    await client.query(
      `INSERT INTO bms_tax_request_submissions(tenant_id,request_id,submission_no,client_version,buyer)
      VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        identity.tenantId,
        row.id,
        row.submission_count + 1,
        version,
        JSON.stringify(buyer),
      ]
    );
    await audit(client, identity.tenantId, null, row.id, "revise");
    return { ok: true };
  });
}
export async function listTaxRequests(ctx: any, status: string, offset = 0) {
  await requirePermission(ctx, "tax.document.view");
  const configuration = taxRequestConfiguration();
  if (!configuration.enabled) return { enabled: false, rows: [] };
  if (!["PENDING", "NEEDS_INFO", "REJECTED", "ISSUED"].includes(status))
    throw new TaxRequestError("สถานะไม่ถูกต้อง");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
    throw new TaxRequestError("หน้ารายการไม่ถูกต้อง");
  const tenantId = getTenantId(ctx),
    locations = await listLocationsForUser(tenantId, String(ctx.admin.id));
  return inTenant(tenantId, String(ctx.admin.id), async (client) => {
    const result = await client.query(
      `SELECT r.id,r.order_id AS "orderId",r.buyer,r.status,r.version,r.feedback,r.document_id AS "documentId",r.created_at AS "createdAt",l.name AS "locationName",l.branch_code AS "branchCode",
        d.doc_no AS "receiptNo",d.grand_total AS total,r.submission_count AS "submissionCount",r.request_deadline AS "requestDeadline"
      FROM bms_tax_invoice_requests r JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id
      JOIN bms_tax_documents d ON d.tenant_id=r.tenant_id AND d.order_id=r.order_id AND d.doc_type='ABBREVIATED'
      WHERE r.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status=$3 ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $4`,
      [tenantId, locations.map((l) => l.id), status, offset]
    );
    return {
      enabled: true,
      rows: result.rows.slice(0, 50),
      hasMore: result.rows.length > 50,
    };
  });
}
export async function reviewTaxRequest(
  ctx: any,
  input: {
    id: string;
    version: number;
    action: string;
    reason?: string;
    confirmed?: boolean;
  }
) {
  await requirePermission(ctx, "tax.document.issue");
  if (
    !input ||
    typeof input !== "object" ||
    !/^[a-f0-9-]{36}$/i.test(input.id ?? "") ||
    !Number.isSafeInteger(input.version)
  )
    throw new TaxRequestError("ข้อมูลคำขอไม่ถูกต้อง");
  if (input.confirmed !== true)
    throw new TaxRequestError("ต้องยืนยันการดำเนินการ");
  if (!["ISSUE", "NEEDS_INFO", "REJECT"].includes(input.action))
    throw new TaxRequestError("คำสั่งไม่ถูกต้อง");
  const reason = input.action === "ISSUE" ? null : clean(input.reason, 1000);
  const tenantId = getTenantId(ctx),
    actor = String(ctx.admin.id),
    locations = await listLocationsForUser(tenantId, actor);
  return inTenant(tenantId, actor, async (client) => {
    const lookup = await client.query(
      `SELECT order_id FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND id=$2 AND location_id=ANY($3::uuid[])`,
      [tenantId, input.id, locations.map((l) => l.id)]
    );
    if (!lookup.rows[0]) throw new TaxRequestError("ไม่พบคำขอ", 404);
    await client.query(
      `SELECT id FROM bms_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenantId, lookup.rows[0].order_id]
    );
    const result = await client.query(
      `SELECT * FROM bms_tax_invoice_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenantId, input.id]
    );
    const row = result.rows[0];
    if (row.status === "ISSUED" && input.action === "ISSUE")
      return { status: row.status, documentId: row.document_id };
    if (
      !["PENDING", "NEEDS_INFO"].includes(row.status) ||
      row.version !== input.version
    )
      throw new TaxRequestError(
        "คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่ก่อนยืนยัน",
        409
      );
    let documentId = null;
    if (input.action === "ISSUE") {
      if (row.status !== "PENDING")
        throw new TaxRequestError("รอลูกค้าส่งข้อมูลที่แก้ไขก่อน");
      await receiptOrder(client, tenantId, row.order_id, false);
      const issued = await issueFullTaxInvoiceInTx(client, {
        tenantId,
        orderId: row.order_id,
        buyer: row.buyer,
        issuedBy: actor,
      });
      if (issued.status !== "ISSUED")
        throw new TaxRequestError(
          "reason" in issued
            ? issued.reason
            : `ออกเอกสารไม่สำเร็จ: ${issued.status}`,
          409
        );
      documentId = issued.document.id;
    }
    const status =
      input.action === "ISSUE"
        ? "ISSUED"
        : input.action === "REJECT"
        ? "REJECTED"
        : "NEEDS_INFO";
    await client.query(
      `UPDATE bms_tax_invoice_requests SET status=$3,feedback=$4,document_id=$5,reviewed_by=$6,reviewed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantId, row.id, status, reason, documentId, actor]
    );
    await audit(client, tenantId, actor, row.id, input.action.toLowerCase());
    return { status, documentId };
  });
}
