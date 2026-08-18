const POS_PAYMENT_METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH", "WALLET"] as const;

type ParsedPosSaleLine = {
  sku: string;
  size: string;
  packQty: number;
  packCode: string | null;
  unitName: string | null;
  baseQty: number | null;
  packPrice: number | null;
};

type ParsedPosPaymentInput = {
  method: (typeof POS_PAYMENT_METHODS)[number];
  amount: number;
  cashTendered: number | null;
  ref: string | null;
};

export function normalizePosSearchQuery(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
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
  return {
    ...sale,
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
