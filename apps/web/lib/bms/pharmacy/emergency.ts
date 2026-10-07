/** Conservative routing only, not diagnosis or a complete clinical screening protocol.
 * Thai contact roles verified 2026-10-07:
 * https://dmh.go.th/ and https://mhc12.dmh.go.th/?page_id=1754
 * https://www.niems.go.th/1/UploadAttachFile/2023/EBook/418111_20230619083903.pdf
 */
const SELF_HARM_PATTERN = /(?:ฆ่าตัวตาย|ทำร้าย(?:ตัวเอง|ตนเอง)|อยากตาย|ไม่อยาก(?:มีชีวิต|อยู่)(?:ต่อ|แล้ว)|suicid\w*|kill myself|hurt myself|harm myself|end my life|(?:do not|don't|don’t) want to live)/i;
const MEDICAL_PATTERN = /(?:หมดสติ|ชัก|หายใจไม่ออก|หายใจลำบากมาก|หอบเหนื่อยมาก|เจ็บหน้าอก|แน่นหน้าอก|หน้าเบี้ยว|ปากเบี้ยว|แขนขาอ่อนแรง|พูดไม่ชัด|อาเจียนเป็นเลือด|ถ่ายดำ|ถ่ายเป็นเลือด|แพ้(?:ยา)?รุนแรง|คอบวม|ลิ้นบวม|ปากบวม|หน้าบวม|ผื่น(?:ขึ้น)?ทั้งตัว|chest pain|can(?:not|'t|’t) breathe|unconscious|vomiting blood|swollen (?:tongue|lips|face)|seizure|anaphylax)/i;
const POISONING_PATTERN = /(?:ยาเกินขนาด|(?:กิน|ทาน|กลืน|ดื่ม).{0,25}(?:ยาเกิน|สารเคมี|ยาฆ่าแมลง|น้ำยาล้าง|น้ำยาฟอก|ยาพิษ)|(?:เด็ก|ลูก|หลาน).{0,20}(?:เผลอ|แอบ|หยิบ).{0,20}(?:กิน|กลืน|ดื่ม).{0,20}(?:ยา|สาร)|(?:เด็ก|ลูก|หลาน).{0,15}(?:กิน|กลืน|ดื่ม).{0,15}(?:ยา|สารเคมี).{0,10}(?:เข้าไป|ผิด|เกิน)|overdos\w*|(?:swallowed|drank|ingested).{0,30}(?:chemical|poison|bleach|pesticide)|(?:child|baby|toddler).{0,30}(?:swallowed|ate).{0,20}(?:pills|tablets|medicine))/i;

export function pharmacyEmergencyKind(message: string): "SELF_HARM" | "MEDICAL" | null {
  // NFKC decomposes Thai sara am (ำ), which would break literal ทำร้าย/ลำบาก matches.
  const text = String(message ?? "").normalize("NFC").replace(/\u0e4d\u0e32/g, "ำ").replace(/\s+/g, " ").trim();
  if (SELF_HARM_PATTERN.test(text)) return "SELF_HARM";
  return MEDICAL_PATTERN.test(text) || POISONING_PATTERN.test(text) ? "MEDICAL" : null;
}

/** Fixed copy, no provider, clinical advice, queue promise or invented staff notification. */
export function pharmacyEmergencyReply(message = ""): string {
  const english = Boolean(message) && !/[ก-๙]/.test(message);
  if (pharmacyEmergencyKind(message) === "SELF_HARM") {
    return english
      ? "I'm sorry you are going through this. You do not have to face it alone. If you have harmed yourself, taken an overdose, or cannot stay safe, call 1669 in Thailand or go to the nearest emergency department now. Do not wait for this chat. Ask someone you trust to stay with you. Thailand's mental health helpline 1323 is available 24 hours a day; it does not replace emergency care. Outside Thailand, call your local emergency or crisis service."
      : "เสียใจที่คุณกำลังเจอเรื่องหนักนะคะ คุณไม่ต้องรับมือคนเดียว หากทำร้ายตัวเอง กินยาเกินขนาด หรือไม่มั่นใจว่าจะปลอดภัย ให้โทร 1669 ในประเทศไทยหรือไปห้องฉุกเฉินทันที ไม่ต้องรอคำตอบในแชท ขอให้คนที่ไว้ใจมาอยู่ด้วย และโทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ซึ่งไม่ใช้แทนบริการฉุกเฉิน หากอยู่นอกประเทศไทยให้ติดต่อฉุกเฉินหรือสายด่วนในพื้นที่ค่ะ";
  }
  return english
    ? "This message may indicate an emergency. In Thailand, call 1669 or go to the nearest emergency department immediately. Do not wait for a pharmacist or this chat. Outside Thailand, call your local emergency number."
    : "ข้อความนี้อาจเป็นเหตุฉุกเฉิน หากอยู่ประเทศไทย กรุณาโทร 1669 หรือไปห้องฉุกเฉินของโรงพยาบาลใกล้ที่สุดทันที ไม่ต้องรอเภสัชกรหรือคำตอบในแชท หากอยู่นอกประเทศไทยให้ติดต่อหมายเลขฉุกเฉินในพื้นที่ค่ะ";
}
