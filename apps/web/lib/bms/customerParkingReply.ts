import type { CustomerStoreFacts } from "./customerStoreContext";

export function isParkingQuestion(message: string): boolean {
  return /ค่าจอด|(?:ที่จอด|จอดรถ).*(?:ไหม|มั้ย|หรือไม่|ตรงไหน|ที่ไหน|เท่า|กี่|อย่างไร|ยังไง|เวลา|ฟรี|ราคา|\?)|(?:ขอ|สอบถาม|รายละเอียด|มี).*(?:ที่จอด|จอดรถ)|^(?:ที่จอดรถ|จอดรถ)\s*$/i.test(message)
    || /^(?:parking|car\s*park)\b|\b(?:parking|car\s*park)\b.*(?:available|free|fee|cost|where|\?)|\b(?:where|what|is there|do you|does .*have|tell me|how much|can i)\b.*\b(?:parking|car\s*park)\b/i.test(message);
}

function mentionsBranch(message: string, name: string): boolean {
  if (!name.trim()) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // ASCII branch names must not match letters inside an unrelated word.
  return new RegExp(`${/^[a-z0-9]/i.test(name) ? "(?<![a-z0-9])" : ""}${escaped}${/[a-z0-9]$/i.test(name) ? "(?![a-z0-9])" : ""}`, "i").test(message);
}

function selectedBranch(facts: CustomerStoreFacts, message: string, lookupBranch?: string | null) {
  const result = facts.branchParking;
  if (facts.status !== "available" || !result || result.truncated) return null;
  const matches = result.branches.filter(branch => mentionsBranch(message, branch.name));
  if (matches.length === 1) return matches[0];
  // A model-filtered single result is not proof that the customer selected that branch.
  if (!matches.length && !lookupBranch && result.branches.length === 1 && !/สาขา|\bbranch\b/i.test(message)) return result.branches[0];
  return null;
}

/** Other branches' parking prose cannot exempt a price claim from the reply guard. */
export function scopeParkingFactsForReply(facts: CustomerStoreFacts, incoming: string, lookupBranch?: string | null): CustomerStoreFacts {
  const parkingQuestion = isParkingQuestion(incoming);
  const selected = parkingQuestion ? selectedBranch(facts, incoming, lookupBranch) : null;
  // Legacy about prose must not authorize a parking fee over the structured branch facts.
  return { ...facts, fields: parkingQuestion ? { ...facts.fields, about: null } : facts.fields, branchParking: facts.branchParking
    ? { ...facts.branchParking, branches: selected ? [selected] : [] } : undefined };
}

/** Missing/hidden/ambiguous evidence cannot support even a nonnumeric parking claim. */
export function needsParkingClarification(facts: CustomerStoreFacts, incoming: string, lookupBranch?: string | null): boolean {
  if (!isParkingQuestion(incoming)) return false;
  const parking = selectedBranch(facts, incoming, lookupBranch)?.parking;
  return !parking || parking.status === "UNKNOWN";
}

/** Read-only repair for a rejected numeric answer. Never infer fees or current vacancy. */
export function customerParkingFallback(
  facts: CustomerStoreFacts, incoming: string, english: boolean, lookupBranch?: string | null
): string | null {
  if (!isParkingQuestion(incoming)) return null;
  if (facts.status !== "available") return english
    ? "I could not verify the parking information right now. Please try again or contact the shop."
    : "ขณะนี้ตรวจสอบข้อมูลที่จอดรถไม่ได้ค่ะ กรุณาลองใหม่หรือติดต่อร้านโดยตรง";
  const branch = selectedBranch(facts, incoming, lookupBranch);
  if (!branch) {
    const names = facts.branchParking?.branches.map(item => item.name).slice(0, 5) ?? [];
    return english
      ? `Which branch would you like parking information for?${names.length ? ` Branch names include: ${names.join(", ")}.` : ""} I have not verified parking for the requested branch yet.`
      : `ต้องการข้อมูลที่จอดรถของสาขาไหนคะ${names.length ? ` เช่น ${names.join(", ")}` : ""} ตอนนี้ยังยืนยันข้อมูลที่จอดรถของสาขาที่ต้องการไม่ได้ค่ะ`;
  }
  const parking = branch.parking;
  if (!parking) return english
    ? `${branch.name}: Parking information has not been published. Please ask the shop; this does not mean there is no parking.`
    : `${branch.name}: ร้านยังไม่ได้เปิดเผยข้อมูลที่จอดรถค่ะ กรุณาสอบถามร้านโดยตรง ไม่ได้หมายความว่าไม่มีที่จอดรถนะคะ`;
  const lines = [english
    ? `${branch.name}: ${parking.status === "AVAILABLE" ? "Parking is provided." : parking.status === "NONE" ? "No shop-provided parking." : "Parking status is not specified."}`
    : `${branch.name}: ${parking.status === "AVAILABLE" ? "มีที่จอดรถค่ะ" : parking.status === "NONE" ? "ไม่มีที่จอดรถของร้านค่ะ" : "ยังไม่ระบุว่ามีที่จอดรถหรือไม่ค่ะ"}`];
  if (parking.carSpaces != null) lines.push(english ? `Total car spaces: ${parking.carSpaces}.` : `ช่องจอดรถยนต์ทั้งหมด ${parking.carSpaces} ช่อง`);
  if (parking.motorcycleSpaces != null) lines.push(english ? `Total motorcycle spaces: ${parking.motorcycleSpaces}.` : `ช่องจอดมอเตอร์ไซค์ทั้งหมด ${parking.motorcycleSpaces} ช่อง`);
  if (parking.details) lines.push(english ? `Published parking details: ${parking.details}` : `รายละเอียดที่ร้านระบุ: ${parking.details}`);
  if (parking.mapUrl) lines.push(english ? `Parking map: ${parking.mapUrl}` : `แผนที่ที่จอดรถ: ${parking.mapUrl}`);
  lines.push(english
    ? "Current free spaces are not verified; no parking space is reserved. Other details not listed here remain unverified."
    : "ยังไม่ทราบจำนวนช่องว่างขณะนี้ และยังไม่ได้จองที่จอดรถค่ะ รายละเอียดอื่นที่ไม่ได้ระบุยังยืนยันไม่ได้ค่ะ");
  return lines.join("\n");
}

/** A grounded status answer is progress even when it does not quote a long details field. */
export function answersWithParkingFacts(reply: string, facts: CustomerStoreFacts, incoming: string, lookupBranch?: string | null): boolean {
  if (!isParkingQuestion(incoming)) return false;
  const parking = selectedBranch(facts, incoming, lookupBranch)?.parking;
  if (!parking || parking.status === "UNKNOWN") return false;
  if (/แอดมิน|\badmin\b|ลองใหม่|try again|ไม่(?:พบ|มี)ข้อมูล|cannot confirm|could not/i.test(reply)) return false;
  if (parking.status === "NONE") return /ไม่มีที่จอดรถของร้าน|no shop-provided parking/i.test(reply);
  if (/ไม่มีที่จอด|no (?:shop-provided )?parking/i.test(reply)) return false;
  return /มีที่จอดรถ|parking is provided|parking (?:is )?available/i.test(reply);
}
