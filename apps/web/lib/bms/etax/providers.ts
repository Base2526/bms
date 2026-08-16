// =============================================================
// e-Tax — ตัวเซ็นและช่องทางนำส่ง
// -------------------------------------------------------------
// ทั้งสองตัวในไฟล์นี้ยัง "ไม่ส่งอะไรจริง" โดยตั้งใจ
//
// การเซ็นต้องใช้ใบรับรองอิเล็กทรอนิกส์จาก CA ไทย ซึ่ง:
//   • ต้องซื้อและผูกกับนิติบุคคล
//   • ห้ามเก็บไว้ในโค้ดหรือ env ธรรมดา — ควรอยู่ใน HSM หรือ secret manager
//   • ยังไม่มีในระบบนี้
//
// การนำส่งต้องลงทะเบียนกับกรมสรรพากรก่อน แล้วเลือกว่าจะยิงตรงหรือผ่าน
// ผู้ให้บริการที่ RD รับรอง — ซึ่งแต่ละรายมี API คนละแบบ
//
// สิ่งที่ทำได้ตอนนี้คือทำให้ระบบ "พร้อมเสียบ" — เมื่อได้ใบรับรองและสัญญากับ
// ผู้ให้บริการแล้ว เขียน adapter เพิ่ม 1 ตัว แล้วลงทะเบียนที่ท้ายไฟล์นี้ จบ
// =============================================================

import crypto from "crypto";
import type { EtaxDocumentData, EtaxProvider, EtaxSigner, SubmitResult } from "./types";

/**
 * ตัวเซ็นหลอก — คำนวณ digest ของ XML แล้วแนบไว้เฉย ๆ
 *
 * ⚠️ ผลลัพธ์ **ไม่มีผลทางกฎหมาย** ใช้เพื่อให้ flow เดินได้ครบตอนพัฒนา
 * และเพื่อพิสูจน์ว่า XML ที่ประกอบไม่เปลี่ยนระหว่างทางเท่านั้น
 */
export const developmentSigner: EtaxSigner = {
  name: "dev-digest",
  async sign(xml: string) {
    const digest = crypto.createHash("sha256").update(xml, "utf8").digest("base64");
    const note =
      "<!-- DEV ONLY: ไม่ใช่ลายเซ็นดิจิทัลที่ใช้ได้จริง " +
      "ต้องเปลี่ยนเป็นการเซ็นด้วยใบรับรองจาก CA ก่อนใช้งานจริง -->";
    return {
      signedXml: `${note}\n<!-- sha256: ${digest} -->\n${xml}`,
      certificateRef: null,
    };
  },
};

/**
 * ช่องทางนำส่งหลอก — บันทึกว่า "ส่งแล้ว" โดยไม่ได้ส่งไปไหน
 * ใช้ทดสอบว่าคิว/สถานะ/การลองใหม่ทำงานถูก ก่อนมีผู้ให้บริการจริง
 */
export const noopProvider: EtaxProvider = {
  name: "noop",
  async submit(_signedXml: string, doc: EtaxDocumentData): Promise<SubmitResult> {
    return { status: "ACCEPTED", providerRef: `NOOP-${doc.docNo}` };
  },
};

/**
 * โครงสำหรับยิงตรงกรมสรรพากร — ยังไม่เปิดใช้
 *
 * ต้องมีก่อน: เลขทะเบียนผู้ประกอบการ e-Tax, ใบรับรอง, endpoint จริง,
 * และรูปแบบ request/response ตามเอกสาร RD ซึ่งยังไม่มีในเครื่องนี้
 * ปฏิเสธตรง ๆ ดีกว่าเดา endpoint แล้วส่งข้อมูลภาษีผิดที่
 */
export const rdDirectProvider: EtaxProvider = {
  name: "rd-direct",
  async submit(): Promise<SubmitResult> {
    throw new Error(
      "ยังไม่ได้ตั้งค่าการนำส่งตรงกรมสรรพากร — ต้องลงทะเบียน e-Tax, มีใบรับรอง " +
        "และใส่ endpoint จริงตามเอกสาร RD ก่อน"
    );
  },
};

const PROVIDERS: Record<string, EtaxProvider> = {
  [noopProvider.name]: noopProvider,
  [rdDirectProvider.name]: rdDirectProvider,
};

const SIGNERS: Record<string, EtaxSigner> = {
  [developmentSigner.name]: developmentSigner,
};

export function resolveProvider(name: string | null | undefined): EtaxProvider {
  const key = (name ?? process.env.ETAX_PROVIDER ?? noopProvider.name).trim();
  const found = PROVIDERS[key];
  if (!found) throw new Error(`ไม่รู้จักช่องทางนำส่ง e-Tax: ${key}`);
  return found;
}

export function resolveSigner(): EtaxSigner {
  const key = (process.env.ETAX_SIGNER ?? developmentSigner.name).trim();
  const found = SIGNERS[key];
  if (!found) throw new Error(`ไม่รู้จักตัวเซ็น e-Tax: ${key}`);
  return found;
}

/** ทั้ง env และค่าตั้งของร้านต้องเปิดพร้อมกัน — เหมือน pharmacy protocols */
export function etaxEnabledGlobally(): boolean {
  const v = String(process.env.ETAX_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
