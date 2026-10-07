/** Conservative routing only, not diagnosis or a complete clinical screening protocol.
 * Thai contact roles verified 2026-10-07:
 * https://dmh.go.th/ and https://mhc12.dmh.go.th/?page_id=1754
 * https://www.niems.go.th/1/UploadAttachFile/2023/EBook/418111_20230619083903.pdf
 */
const SELF_HARM_PATTERN = /(?:ฆ่าตัวตาย|ทำร้าย(?:ตัวเอง|ตนเอง)|อยากตาย|ไม่อยาก(?:มีชีวิต|อยู่)(?:ต่อ|แล้ว)|suicid\w*|kill myself|hurt myself|harm myself|end my life|(?:do not|don't|don’t) want to live)/i;
const MEDICAL_PATTERN = /(?:หมดสติ|ชัก|หายใจไม่ออก|หายใจลำบากมาก|หอบเหนื่อยมาก|เจ็บหน้าอก|แน่นหน้าอก|หน้าเบี้ยว|ปากเบี้ยว|แขนขาอ่อนแรง|พูดไม่ชัด|อาเจียนเป็นเลือด|ถ่ายดำ|ถ่ายเป็นเลือด|แพ้(?:ยา)?รุนแรง|คอบวม|ลิ้นบวม|ปากบวม|หน้าบวม|ผื่น(?:ขึ้น)?ทั้งตัว|chest pain|can(?:not|'t|’t) breathe|unconscious|vomiting blood|swollen (?:tongue|lips|face)|seizure|anaphylax)/i;
const POISONING_PATTERN = /(?:ยาเกินขนาด|(?:กิน|ทาน|กลืน|ดื่ม).{0,25}(?:ยาเกิน|สารเคมี|ยาฆ่าแมลง|น้ำยาล้าง|น้ำยาฟอก|ยาพิษ)|(?:เด็ก|ลูก|หลาน).{0,20}(?:เผลอ|แอบ|หยิบ).{0,20}(?:กิน|กลืน|ดื่ม).{0,20}(?:ยา|สาร)|(?:เด็ก|ลูก|หลาน).{0,15}(?:กิน|กลืน|ดื่ม).{0,15}(?:ยา|สารเคมี).{0,10}(?:เข้าไป|ผิด|เกิน)|overdos\w*|(?:swallowed|drank|ingested).{0,30}(?:chemical|poison|bleach|pesticide)|(?:child|baby|toddler).{0,30}(?:swallowed|ate).{0,20}(?:pills|tablets|medicine))/i;

export type EmergencyKind = "SELF_HARM" | "MEDICAL" | "POISONING";

/** Match a display-equivalent safety view only; never rewrite stored evidence or SKU input. */
export function normalizePharmacySafetyText(message: string): string {
  // NFKC decomposes Thai sara am (ำ), which would break literal ทำร้าย/ลำบาก matches.
  return String(message ?? "").normalize("NFC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\u0e4d\u0e32/g, "ำ")
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/\s+/g, " ").replace(/([ก-๙]) +(?=[ก-๙])/g, "$1").trim();
}

export function pharmacyEmergencyKind(message: string): EmergencyKind | null {
  const text = normalizePharmacySafetyText(message);
  if (SELF_HARM_PATTERN.test(text)) return "SELF_HARM";
  if (POISONING_PATTERN.test(text) || /(?:เด็ก|ลูก|หลาน).{0,15}(?:กิน|กลืน|ทาน).{0,20}ยา.{0,20}\d+\s*(?:เม็ด|แผง|ขวด)/i.test(text)) return "POISONING";
  if (/\b(?:took|taken|swallowed|ate)\s+too many\s+(?:pills|tablets|capsules)\b|\b(?:child|baby|toddler).{0,30}\b(?:drank|ingested)\s+(?:the |my |some )?(?:medicine|medication)\b/i.test(text)) return "POISONING";
  if (/\b(?:lips|tongue|face)\s+(?:(?:is|are)\s+)?(?:swelling|swollen)\b|\bshortness of breath\b/i.test(text)) return "MEDICAL";
  return MEDICAL_PATTERN.test(text) ? "MEDICAL" : null;
}

// Official contact sources verified 2026-10-07 (static data, never fetched during a reply):
// 1367: https://www.rama.mahidol.ac.th/poisoncenter/sites/default/files/public/pdf/books/Antidote_book4.pdf
// 1155: https://www.touristpolice.go.th/contact-us
export const EMERGENCY_CONTACTS = { medical: "1669", poisoning: "1367", mentalHealth: "1323", touristPolice: "1155" } as const;

export type EmergencyReplyFacility = {
  name: string; emergencyPhone: string; mapUrl?: string | null;
  has24hEmergency: boolean; active?: boolean;
};

/** Pure fixed copy. No imports, model, network, geolocation, or queue promises. */
export function composeEmergencyReply({ kind, english, facilities }: {
  kind: EmergencyKind; english: boolean; facilities: readonly EmergencyReplyFacility[];
}): string {
  const lines = [english
    ? "In Thailand, call 1669 or go to the nearest emergency department immediately. Do not wait for a pharmacist or this chat."
    : "หากอยู่ประเทศไทย กรุณาโทร 1669 หรือไปห้องฉุกเฉินของโรงพยาบาลใกล้ที่สุดทันที ไม่ต้องรอเภสัชกรหรือคำตอบในแชทค่ะ"];
  if (kind === "SELF_HARM") {
    lines.push(english
      ? "I'm sorry you are going through this. You do not have to face it alone. If you have harmed yourself, taken an overdose, or cannot stay safe, seek emergency help now. Ask someone you trust to stay with you. Thailand's mental health helpline 1323 is available 24 hours a day; it does not replace emergency care."
      : "เสียใจที่คุณกำลังเจอเรื่องหนักนะคะ คุณไม่ต้องรับมือคนเดียว หากทำร้ายตัวเอง กินยาเกินขนาด หรือไม่มั่นใจว่าจะปลอดภัย ให้ขอความช่วยเหลือฉุกเฉินทันที ขอให้คนที่ไว้ใจมาอยู่ด้วย และโทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ซึ่งไม่ใช้แทนบริการฉุกเฉินค่ะ");
  } else if (kind === "POISONING") {
    lines.push(english
      ? "For poisoning or overdose, also call Ramathibodi Poison Center 1367 (24 hours). Take the packaging or container and note the approximate time and amount. Do not induce vomiting unless instructed by medical staff or the poison center."
      : "กรณีได้รับสารพิษหรือยาเกินขนาด โทรศูนย์พิษวิทยารามาธิบดี 1367 ได้ตลอด 24 ชั่วโมง นำบรรจุภัณฑ์หรือภาชนะไปด้วย และจดเวลาและปริมาณโดยประมาณ ห้ามทำให้อาเจียนเอง เว้นแต่บุคลากรทางการแพทย์หรือศูนย์พิษวิทยาสั่งค่ะ");
  } else {
    lines.push(english ? "Do not drive yourself. Ask someone to stay with you."
      : "อย่าขับรถไปเอง ขอให้มีคนอยู่ด้วยระหว่างรอความช่วยเหลือค่ะ");
  }
  const eligible = facilities.filter((f) => f.has24hEmergency === true && f.active !== false).slice(0, 3);
  if (eligible.length) {
    lines.push(english ? "Near the shop — 24-hour emergency departments (shop-maintained information, not your location):"
      : "โรงพยาบาลใกล้ร้านที่มีห้องฉุกเฉิน 24 ชม. (ข้อมูลที่ร้านบันทึก ไม่ใช่ระยะจากตำแหน่งของคุณ):");
    for (const f of eligible) {
      const name = f.name.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 120);
      const phone = /^[+\d-]{1,30}$/.test(f.emergencyPhone) ? f.emergencyPhone : "";
      const map = /^https:\/\/[^\s]+$/i.test(f.mapUrl ?? "") ? f.mapUrl : null;
      lines.push(`- ${name}${phone ? ` · ${phone}` : ""}${map ? ` · ${map}` : ""}`);
    }
  }
  lines.push(english ? "Outside Thailand, call your local emergency or crisis service."
    : "หากอยู่นอกประเทศไทยให้ติดต่อหมายเลขฉุกเฉินหรือสายด่วนในพื้นที่ค่ะ");
  if (english) lines.push("For tourist assistance in Thailand, Tourist Police: 1155 (supplemental support, not a replacement for 1669).");
  return lines.join("\n");
}

/** The canonical standard fallback is exactly the empty-facility composition. */
export function pharmacyEmergencyReply(message = ""): string {
  return composeEmergencyReply({ kind: pharmacyEmergencyKind(message) ?? "MEDICAL",
    english: Boolean(message) && !/[ก-๙]/.test(message), facilities: [] });
}
