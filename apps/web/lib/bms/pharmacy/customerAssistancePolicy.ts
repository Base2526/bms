/** Customer boundaries only; no diagnosis, dosing rule, protocol activation or clinical inference. */
import { normalizePharmacySafetyText, pharmacyEmergencyKind } from "./emergency";

/** Contextual short-reply expansion must never erase safety text or an explicit case selector. */
export function shouldPreservePharmacyCustomerMessage(message: string, isPharmacy: boolean): boolean {
  return Boolean(pharmacyEmergencyKind(message)) || (isPharmacy && (
    isPharmacyMedicationAdviceQuestion(message) || isPharmacySymptomAdviceQuestion(message) || Boolean(pharmacyCustomerReadIntent(message))
  ));
}

export function isPharmacyMedicationAdviceQuestion(message: string): boolean {
  message = normalizePharmacySafetyText(message);
  // Short suitability/stop/restart questions are still clinical even without a SKU.
  // Keep shopping uses of "ใช้" (coupon/payment) and alcohol-gel catalog reads outside this gate.
  if (/(?:กิน|ทาน).{0,30}(?:ได้ไหม|ได้มั้ย|ได้หรือเปล่า|ได้หรือไม่)|(?:ตัวนี้|ยานี้|อันนี้)(?:ใช้)?(?:ได้ไหม|ได้มั้ย|ปลอดภัย)|(?:หยุด|เลิก|เริ่ม|เปลี่ยน)(?:กิน|ทาน|ใช้|ขนาด)?ยา|(?:กิน|ทาน|ใช้).{0,25}พร้อมกัน|(?:กิน|ทาน).{0,30}(?:ดื่ม|กิน)(?:เหล้า|เบียร์|ไวน์|แอลกอฮอล์)/i.test(message)) return true;
  if (/\b(?:is|would|will) (?:it|this|that) (?:be )?(?:safe|okay|ok|suitable)\b|\b(?:stop|start|restart|continue|discontinue|double|halve|increase|reduce|skip)\b.{0,25}\b(?:taking|using|medicine|medication|pills?|tablets?|capsules?)\b|\b(?:drink|drinking)\b.{0,15}\b(?:alcohol|beer|wine)\b.{0,35}\b(?:tak\w*|medicine|medication|pills?)\b/i.test(message)) return true;
  // Explicit advice and adverse-effect wording, including follow-ups without a drug name.
  // Do not use the guidance classifier as this guard: it also matches ordinary catalog words.
  if (/(?:ผลข้างเคียง|อาการข้างเคียง|(?:กิน|ทาน|ใช้).{0,25}(?:แล้ว|ไป).{0,25}(?:ผื่น|คัน|เวียนหัว|มึน|คลื่นไส้|อาเจียน)|(?:อาการ|กิน|ทาน|ใช้).{0,25}(?:ไม่ดีขึ้น|ไม่ทุเลา)|ลืม(?:กิน|ทาน|ใช้|หยอด)|\bforgot.{0,20}(?:take|dose|pill)|\b(?:rash|itch\w*|dizz\w*|nause\w*|vomit\w*).{0,30}(?:after|since).{0,15}(?:taking|took|using)|\bside[- ]effects?\b|\bnot (?:getting )?better\b|\bstill (?:sick|hurts)\b)/i.test(message)) return true;
  if (/(?:หมอสั่ง|แพทย์สั่ง|ยาจากหมอ|ยาจากโรงพยาบาล|ยาโรงพยาบาล).{0,30}(?:ดีกว่า|เปลี่ยน|แทน|กิน|ใช้)|\b(?:better|replace|switch).{0,45}(?:prescribed|doctor)|\b(?:the|my) doctor gave me\b/i.test(message)) return true;
  if (/(?:โรคไต|เบาหวาน|ความดัน|โรคประจำตัว|ผู้สูงอายุ|คนแก่|คนท้อง|ตั้งครรภ์|ให้นม).{0,35}(?:กิน|ทาน|ใช้).{0,20}(?:ได้หรือเปล่า|ได้หรือไม่)|ให้ลูกอายุ.{0,20}ได้ไหม|\b(?:can|may|should).{0,20}(?:baby|child|toddler|puppy|kitten).{0,15}(?:have|take|use)|\b(?:ok|okay|safe|suitable).{0,15}(?:for|with).{0,15}(?:pets?|dogs?|cats?|puppy|kitten|asthma|diabetes|kidney disease)|หมากินยาคน/i.test(message)) return true;
  if (/เก็บรักษา|ต้องแช่เย็น/i.test(message)) return true;
  // Label-use quotations are NOT enabled: the catalog's label facts have no pharmacist
  // publication approval/version/withdrawal workflow. Do not let "quote the label" bypass this.
  if (/(?:ลืม(?:กิน|ทาน|ใช้)ยา|(?:ยา|ตัวนี้).{0,30}(?:รักษา|ใช้แก้|ง่วง|ขับรถ|แช่เย็น|ผลข้างเคียง)|เก็บ(?:รักษา)?ยา|ก่อนหรือหลังอาหาร|ห้ามขับรถ|(?:กิน|ทาน|ใช้).{0,25}(?:แล้ว|มา).{0,25}(?:ไม่หาย|ข้างเคียง|ง่วง|ผื่น|เวียนหัว)|(?:โรคไต|เบาหวาน|ความดัน|โรคประจำตัว|ผู้สูงอายุ|คนแก่).{0,35}(?:กิน|ทาน|ใช้).{0,20}(?:ไหม|มั้ย|ได้หรือ)|(?:ให้|สำหรับ).{0,15}(?:สัตว์เลี้ยง|สุนัข|หมา|แมว).{0,15}(?:กิน|ทาน|ใช้)|(?:medicine|medication|pill).{0,30}(?:drows|drive|driving|refrigerat|storag|treat)|side effects?|missed.{0,12}dose|(?:dog|cat|pet|kidney disease|diabet).{0,35}(?:take|use|safe))/i.test(message)) return true;
  // High-confidence usage questions may omit the word "medicine" or the product name.
  if (/(?:วิธี(?:ใช้|กิน|ทาน)ยา|(?:กิน|ทาน|ใช้).{0,20}(?:ยังไง|อย่างไร|ตอนไหน)|(?:ก่อน|หลัง)อาหาร.{0,12}(?:ไหม|มั้ย)|\b(?:dosage|dosing|dose)\b|\b(?:can|may|should) i take\b|\bhow (?:do|should|can) i (?:take|use)\b)/i.test(message)) return true;
  return /(?:วิธี(?:ใช้|กิน|ทาน)ยา|ขนาดยา|(?:กิน|ทาน|ใช้|ให้).{0,25}(?:กี่เม็ด|กี่ครั้ง|กี่มิล|กี่ซีซี|กี่หยด|กี่ช้อน|กี่วัน)|ยาตีกัน|(?:กิน|ทาน|ใช้).{0,35}(?:คู่กับ|ร่วมกับ|พร้อมกับ|ด้วยกัน)|(?:ท้อง|ตั้งครรภ์|ให้นม|เด็ก|ลูก|แพ้ยา).{0,35}(?:กินได้|ทานได้|ใช้ได้|ให้ยา|กินยา|ทานยา|ยาอะไร|ตัวไหน|แทน)|(?:ท้อง|ตั้งครรภ์|ให้นม|เด็ก|ลูก).{0,35}(?:กิน|ทาน|ใช้).{0,25}(?:ได้ไหม|ได้มั้ย|ดีไหม)|(?:ยา|พารา|ไอบู).{0,35}(?:กินได้ไหม|ทานได้ไหม|ใช้ได้ไหม|ให้เด็ก|ให้ลูก)|ยา.{0,25}(?:ตัวไหนดี|ตัวไหนเหมาะ|อะไรดี)|(?:ยา|ตัว)(?:ไหน|ใด).{0,20}(?:ดีกว่า|เหมาะ|แทน)|(?:what|which).{0,20}(?:dose|dosage|medicine.*(?:child|baby|pregnan|breastfeed))|how (?:much|many|often|long).{0,35}(?:take|tablet|pill|medicine|dose)|(?:can|may|safe).{0,45}(?:take|use|give).{0,40}(?:with|pregnan|breastfeed|child|baby)|drug interaction|allerg.{0,30}(?:instead|alternative))/i.test(message);
}

export function isPharmacySymptomAdviceQuestion(message: string): boolean {
  message = normalizePharmacySafetyText(message);
  // Disclosures may still be collected by an active, approved intake. Without one, hand off.
  if (/\bi(?:'m|’m| am) (?:pregnant|breastfeeding)\b|\bi have (?:kidney disease|diabetes|asthma)\b/i.test(message)) return true;
  return /(?:กินอะไรดี|ใช้ยาอะไร|ควร(?:กิน|ทาน|ใช้)|แนะนำยา|(?:ปวดหัว|ปวดท้อง|ท้องเสีย|มีไข้|เจ็บคอ|ไอ).{0,35}(?:ทำไง|ทำอย่างไร|เป็นมา|มา\s*\d|ไม่หาย)|^(?:ปวดหัว|ปวดท้อง|ท้องเสีย|มีไข้|เจ็บคอ|ไอ)(?:ครับ|ค่ะ|คะ)?$|(?:what|which).{0,25}(?:medicine|medication).{0,25}(?:for|should)|recommend.{0,20}(?:medicine|medication)|i have (?:a )?(?:headache|cough|fever|diarrhea))/i.test(message);
}

export function pharmacyClinicalHandoffReply(english = false, message = ""): string {
  if (/(?:สัตว์เลี้ยง|สุนัข|หมา|แมว|\b(?:dogs?|cats?|pets?|puppy|kitten)\b)/i.test(normalizePharmacySafetyText(message))) {
    return english
      ? "Please contact a veterinarian about giving medicine to an animal. I cannot assess suitability or convert a human dose for a pet. This reply does not approve medication or confirm a sale."
      : "เรื่องการให้ยาแก่สัตว์เลี้ยง กรุณาติดต่อสัตวแพทย์ค่ะ AI ประเมินความเหมาะสมหรือแปลงขนาดยาคนให้สัตว์ไม่ได้ ข้อความนี้ไม่ใช่การอนุมัติยาหรือยืนยันการขายนะคะ";
  }
  return english
    ? "A licensed pharmacist must assess medicine choice, dosage, interactions and safe use. I cannot provide that advice or quote usage instructions without an approved publication workflow. Please contact the shop's pharmacist. This reply does not approve medication or confirm a sale."
    : "เรื่องการเลือกยา วิธีใช้ ขนาดยา ยาตีกัน และความปลอดภัยในการใช้ยา ต้องให้เภสัชกรผู้มีใบอนุญาตประเมินค่ะ AI ให้คำแนะนำนี้ไม่ได้ และยังไม่มีระบบเผยแพร่ข้อความวิธีใช้จากฉลากที่ผ่านการอนุมัติ กรุณาติดต่อเภสัชกรของร้าน ข้อความนี้ไม่ใช่การอนุมัติยาหรือยืนยันการขายนะคะ";
}

export function pharmacyCustomerReadIntent(message: string): "service" | "case" | null {
  // A status/presence query in the same message must not swallow a clinical question.
  if (pharmacyEmergencyKind(message) || isPharmacyMedicationAdviceQuestion(message) || isPharmacySymptomAdviceQuestion(message)) return null;
  if (pharmacyCaseReferenceFromMessage(message)) return "case";
  if (/(?:เภสัชกร).{0,35}(?:ช่วงไหน|เวลาไหน|ตารางเวร)/i.test(message)) return "service";
  if (/(?:เภสัชกร|pharmacist).{0,35}(?:อยู่ไหม|อยู่มั้ย|อยู่ร้าน|อยู่กี่โมง|มากี่โมง|ถึงกี่โมง|พร้อมไหม|available|on duty)|(?:มีเภสัชกร|ไปปรึกษาได้กี่โมง|is.{0,15}pharmacist|when.{0,20}pharmacist)/i.test(message)) return "service";
  if (/(?:เคส|คำขอ|เภสัชกร).{0,30}(?:ถึงไหน|รอนาน|รอกี่|ตอบเมื่อ|ตอบหรือยัง|หมดอายุ|สถานะ)|(?:สถานะ|ติดตาม|เช็ก|ตรวจ).{0,20}เคส|(?:case status|pharmacist.{0,20}(?:reply|respond)|how long.{0,20}(?:case|pharmacist))/i.test(message)) return "case";
  return null;
}

/** A reference narrows this identity's own cases; it is never an access credential. */
export function pharmacyCaseReferenceFromMessage(message: string): string | undefined {
  return /(?:เคส|case|#)\s*#?\s*([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)(?![0-9a-z-])/i.exec(message)?.[1]?.toLowerCase();
}

export type PharmacyCaseStatus = {
  caseReference: string; status: string; expiresAt: string | null;
  requiresReevaluation: boolean; createdAt: string;
};

export function pharmacyCaseStatusReply(cases: PharmacyCaseStatus[], english = false): string {
  if (!cases.length) return english ? "No pharmacy case was found for this chat identity. Please contact the shop's pharmacist."
    : "ไม่พบเคสเภสัชกรของตัวตนแชทนี้ค่ะ กรุณาติดต่อเภสัชกรของร้าน";
  const labels: Record<string, string> = {
    DRAFT: "รอเริ่มเก็บข้อมูล", COLLECTING_INFORMATION: "กำลังเก็บข้อมูล",
    PENDING_CONFIRMATION: "รอลูกค้ายืนยันข้อมูล", WAITING_FOR_PHARMACIST: "รอเภสัชกร",
    PHARMACIST_REVIEWING: "เภสัชกรกำลังตรวจ", NEED_MORE_INFORMATION: "ต้องการข้อมูลเพิ่มเติม",
    APPROVED: "เภสัชกรบันทึกผลแล้ว กรุณาอ่านคำตอบเดิมจากเภสัชกร",
    REJECTED: "เภสัชกรไม่อนุมัติ", REFER_TO_DOCTOR: "ส่งต่อแพทย์",
    EMERGENCY_REFERRAL: "ส่งต่อฉุกเฉิน", CLOSED: "ปิดเคสแล้ว",
  };
  return cases.map((row) => {
    const status = row.requiresReevaluation
      ? (english ? "Expired; contact the pharmacist for re-evaluation" : "หมดอายุ ต้องติดต่อเภสัชกรเพื่อประเมินข้อมูลใหม่")
      : (english ? row.status : labels[row.status] ?? "กรุณาติดต่อร้านเพื่อตรวจสอบ");
    return `#${row.caseReference}: ${status}${row.expiresAt ? ` (${english ? "recorded expiry" : "เวลาหมดอายุที่บันทึก"}: ${row.expiresAt})` : ""}`;
  }).join("\n") + (english
    ? "\nThe system has no verified response-time estimate. Case expiry is not a promised reply time; please contact the shop if you are still waiting."
    : "\nระบบยังไม่มีเวลาตอบที่ยืนยันได้ เวลาหมดอายุไม่ใช่เวลาที่รับรองว่าจะตอบ หากยังรออยู่กรุณาติดต่อร้านโดยตรงค่ะ");
}
