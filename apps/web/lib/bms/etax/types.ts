// =============================================================
// e-Tax Invoice — สัญญาระหว่างระบบกับผู้ให้บริการนำส่ง
// -------------------------------------------------------------
// แยก interface ออกมาเป็นไฟล์ของตัวเอง เพราะสิ่งที่ยังไม่รู้ตอนนี้คือ
// "ใครจะเป็นคนส่ง" — ยิงตรงกรมสรรพากร หรือผ่านผู้ให้บริการที่ RD รับรอง
// ทั้งสองทางมี API คนละแบบ แต่ขั้นตอนเหมือนกันหมด:
//   ประกอบ XML → เซ็นด้วยใบรับรอง → ส่ง → รอผลตอบรับ
//
// ตราบใดที่ระบบคุยกับ interface นี้ การเปลี่ยนผู้ให้บริการคือการเขียน
// adapter ใหม่ 1 ไฟล์ ไม่ใช่รื้อระบบ
// =============================================================

export type EtaxDocumentType = "ABBREVIATED" | "FULL" | "CREDIT_NOTE";

/** ข้อมูลที่ต้องใช้ประกอบ XML — ดึงจาก bms_tax_documents + bms_orders */
export type EtaxDocumentData = {
  documentId: string;
  docType: EtaxDocumentType;
  docNo: string;
  issueDate: string; // YYYY-MM-DD
  /** เลขทะเบียนผู้ประกอบการ e-Tax ที่ RD ออกให้ */
  operatorId: string | null;

  seller: {
    name: string;
    taxId: string;
    branchCode: string;
    address: string | null;
  };
  buyer: {
    name: string | null;
    taxId: string | null;
    branchCode: string | null;
    address: string | null;
  };

  lines: Array<{
    lineNo: number;
    sku: string;
    name: string;
    qty: number;
    unitName: string | null;
    unitPrice: number;
    amount: number;
    vatCategory: "V" | "N" | "UNKNOWN";
  }>;

  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
  vatRate: number;
  grandTotal: number;

  /** ใบเต็มที่ออกแทนใบย่อ — ต้องอ้างเลขใบเดิมในเอกสาร */
  replacesDocNo: string | null;
};

export type SignResult = {
  signedXml: string;
  /** ชื่อ/ลายนิ้วมือของใบรับรองที่ใช้ ไว้ตรวจย้อนหลัง */
  certificateRef: string | null;
};

/**
 * ผู้เซ็นเอกสาร — ต้องใช้ใบรับรองอิเล็กทรอนิกส์จาก CA ไทย
 * ยังไม่มีตัวจริงในระบบ เพราะใบรับรองต้องซื้อและเก็บอย่างปลอดภัย
 * (ไม่ควรอยู่ในโค้ดหรือ env ธรรมดา — ควรอยู่ใน HSM หรือ secret manager)
 */
export interface EtaxSigner {
  readonly name: string;
  sign(xml: string, tenantId: string): Promise<SignResult>;
}

export type SubmitResult =
  | { status: "ACCEPTED"; providerRef: string | null }
  | { status: "REJECTED"; providerRef: string | null; reason: string }
  /** ส่งแล้วแต่ปลายทางยังไม่ตอบผล — ต้องตามถามทีหลัง */
  | { status: "PENDING_RESULT"; providerRef: string | null };

/** ช่องทางนำส่ง — RD โดยตรง หรือผู้ให้บริการที่ RD รับรอง */
export interface EtaxProvider {
  readonly name: string;
  submit(signedXml: string, doc: EtaxDocumentData, tenantId: string): Promise<SubmitResult>;
  /** ถามผลของเอกสารที่ยังค้าง — ผู้ให้บริการบางรายตอบผลแบบ async */
  poll?(providerRef: string, tenantId: string): Promise<SubmitResult>;
}
