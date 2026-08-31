// CREDIT = ขายเชื่อ (9.30) · route ตรวจสิทธิ์/PIN ผู้อนุมัติก่อนส่งต่อ และ
// recordPosSale ตรวจวงเงินอีกชั้นก่อนตัดสต็อก — ที่นี่แค่รับรูปแบบ
const POS_PAYMENT_METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH", "WALLET", "STORE_CREDIT", "CREDIT"] as const;

type ParsedPosSaleLine = {
  sku: string;
  size: string;
  packQty: number;
  packCode: string | null;
  unitName: string | null;
  baseQty: number | null;
  packPrice: number | null;
  /** เลขเครื่องต่อชิ้น (8.3) — ตัดตัวว่างและตัดช่องว่างหัวท้ายทิ้ง */
  serials: string[] | null;
};

type ParsedPosPaymentInput = {
  /** STORE_CREDIT ใช้ ref เป็นโค้ดบัตร (8.9) — ไม่ต้องเพิ่มฟิลด์ใหม่ในสัญญาเดิม */
  method: (typeof POS_PAYMENT_METHODS)[number];
  amount: number;
  cashTendered: number | null;
  ref: string | null;
};

export function normalizePosSearchQuery(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

export function isPosUuid(raw: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(raw ?? "").trim()
  );
}

export function isDistinctPosApprover(actorUserId: string, approverUserId: string): boolean {
  const actor = actorUserId.trim().toLowerCase();
  const approver = approverUserId.trim().toLowerCase();
  return Boolean(actor && approver && actor !== approver);
}

export function decoratePosSale(
  sale: Record<string, unknown>,
  extras: { storeName: string | null; branchCode: string | null; posLabel: string | null; vatRegistered: boolean }
) {
  const docNo = typeof sale.docNo === "string" && sale.docNo.trim() ? sale.docNo : null;
  return {
    ...sale,
    receiptNo: typeof sale.receiptNo === "string" && sale.receiptNo.trim() ? sale.receiptNo : docNo,
    billNo: typeof sale.billNo === "string" && sale.billNo.trim() ? sale.billNo : docNo,
    storeName: extras.storeName,
    branchCode: extras.branchCode,
    posLabel: extras.posLabel,
    vatRegistered: extras.vatRegistered,
  };
}

export function parsePosSaleLines(rawLines: unknown): ParsedPosSaleLine[] {
  const list = Array.isArray(rawLines) ? rawLines : [];
  return list
    .map((line: any) => ({
      sku: String(line?.sku ?? "").trim(),
      size: String(line?.size ?? "").trim(),
      packQty: Number(line?.packQty),
      packCode: line?.packCode ? String(line.packCode) : null,
      unitName: line?.unitName ? String(line.unitName) : null,
      baseQty: line?.baseQty == null ? null : Number(line.baseQty),
      packPrice: line?.packPrice == null ? null : Number(line.packPrice),
      // ตัดตัวว่างที่นี่ทีเดียว — จอส่ง array ที่มีช่องว่างมาได้ตอนพนักงานกรอกไม่ครบ
      // แล้ว validatePosSaleSerials จะได้ตอบว่า "ขาดกี่เลข" ตรง ๆ
      serials: Array.isArray(line?.serials)
        ? (line.serials as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean)
        : null,
    }))
    .filter((line) => line.sku && line.size && Number.isInteger(line.packQty) && line.packQty > 0);
}

export function parsePosPayments(rawPayments: unknown): { ok: true; payments: ParsedPosPaymentInput[] } | { ok: false; error: string } {
  const list = Array.isArray(rawPayments) ? rawPayments : [];
  const payments: ParsedPosPaymentInput[] = [];
  for (const payment of list as any[]) {
    const method = String(payment?.method ?? "").toUpperCase();
    if (!(POS_PAYMENT_METHODS as readonly string[]).includes(method)) {
      return { ok: false, error: `วิธีชำระเงินไม่ถูกต้อง: ${method || "(ว่าง)"}` };
    }
    const amount = Number(payment?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
    }
    const cashTendered = payment?.cashTendered == null ? null : Number(payment.cashTendered);
    if (method === "CASH" && cashTendered != null && (!Number.isFinite(cashTendered) || cashTendered < amount)) {
      return { ok: false, error: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดที่ชำระด้วยเงินสด" };
    }
    payments.push({
      method: method as ParsedPosPaymentInput["method"],
      amount,
      cashTendered,
      ref: payment?.ref ? String(payment.ref) : null,
    });
  }
  return payments.length > 0
    ? { ok: true, payments }
    : { ok: false, error: "ต้องระบุการชำระเงินอย่างน้อย 1 รายการ" };
}


/**
 * ค่าบริการ/ค่าถุง จาก body (8.6)
 *
 * คัดแถวที่ไม่ครบทิ้งเงียบ ๆ ไม่ทำให้บิลล้ม — จอส่งแถวว่างมาได้ตอนพนักงานกดเพิ่ม
 * บรรทัดแล้วยังไม่กรอก · จำกัดจำนวนแถวกันคนยิง payload ยาวผิดปกติ
 */
export function parsePosExtraLines(raw: unknown): Array<{ label: string; qty: number; unitAmount: number }> {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .slice(0, 20)
    .map((x: any) => ({
      label: String(x?.label ?? "").trim().slice(0, 120),
      qty: Number(x?.qty ?? 1),
      unitAmount: Math.round(Number(x?.unitAmount) * 100) / 100,
    }))
    .filter((x) => x.label
      && Number.isInteger(x.qty) && x.qty > 0
      && Number.isFinite(x.unitAmount) && x.unitAmount >= 0);
}
