// Deterministic conversation boundary used before the pharmacy state machine.
// The router recognizes messages that must not be treated as clinical answers.
// It deliberately does not mutate workflow state or infer medical facts.

const EMERGENCY_PATTERN =
  /(หมดสติ|ชัก|หายใจไม่ออก|หายใจลำบากมาก|หอบเหนื่อยมาก|เจ็บหน้าอก|แน่นหน้าอก|หน้าเบี้ยว|ปากเบี้ยว|แขนขาอ่อนแรง|พูดไม่ชัด|อาเจียนเป็นเลือด|ถ่ายดำ|ถ่ายเป็นเลือด|แพ้รุนแรง|คอบวม|ลิ้นบวม)/i;
const GREETING_PATTERN = /^(?:สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|hey)(?:\s*(?:ครับ|ค่ะ|คะ|นะครับ|นะคะ))?[\s!?.]*$/i;
const THANKS_PATTERN = /^(?:ขอบคุณ|ขอบใจ|thank\s*you|thanks)(?:\s*มาก)?(?:\s*(?:ครับ|ค่ะ|คะ|นะครับ|นะคะ))?[\s!?.]*$/i;
const SMALL_TALK_PATTERN = /^(?:เป็นอย่างไรบ้าง|สบายดีไหม|ทำอะไรอยู่|มีใครอยู่ไหม)(?:\s*(?:ครับ|ค่ะ|คะ))?[\s!?.]*$/i;
const HUMAN_HANDOFF_PATTERN =
  /^(?:(?:ขอ|อยาก|ต้องการ)?(?:คุย|พูด|ติดต่อ)(?:กับ)?เภสัชกร(?:หน่อย)?|(?:ขอ)?ปรึกษา(?:เภสัชกร|อาการ)|talk\s+to\s+(?:a\s+)?pharmacist)(?:ครับ|ค่ะ|คะ)?[\s!?.]*$/i;
const CORRECTION_PATTERN = /^(?:เมื่อกี้)?(?:ตอบผิด|ข้อมูลผิด|ขอแก้ไข|แก้ไขข้อมูล)(?:ครับ|ค่ะ|คะ)?$/i;
const CANCEL_PATTERN = /^(?:ไม่เอาแล้ว|ยกเลิก|หยุด|หยุดซักอาการ|เริ่มใหม่|อาการเปลี่ยน|เปลี่ยนอาการ)(?:ครับ|ค่ะ|คะ)?$/i;
const ORDER_STATUS_PATTERN = /(เช็ก|ตรวจ|ดู|ติดตาม|สถานะ).*(?:ออเดอร์|ออร์เดอร์|คำสั่งซื้อ|พัสดุ|จัดส่ง)|(?:ออเดอร์|ออร์เดอร์|คำสั่งซื้อ|พัสดุ).*(?:ถึงไหน|ส่งหรือยัง|สถานะ)/i;
const PRODUCT_SIDE_INTENT_PATTERN =
  /(?:ขอซื้อ|ต้องการซื้อ|อยากซื้อ|ขอสั่ง|สั่งซื้อ|มีขายไหม|ราคาเท่าไหร่|กี่บาท|มีสินค้า).+|^(?:มี|ขาย|หา|ขอ|ซื้อ|สั่ง|เอา).*(?:ไหม|มั้ย|ป่าว|หรือเปล่า|ราคาเท่าไหร่|กี่บาท)(?:ครับ|ค่ะ|คะ)?$/i;

export type PharmacyConversationIntent =
  | "EMERGENCY"
  | "HUMAN_HANDOFF"
  | "CANCEL_OR_RESTART"
  | "CORRECTION"
  | "ORDER_STATUS"
  | "PRODUCT_SIDE_INTENT"
  | "GREETING"
  | "THANKS"
  | "SMALL_TALK"
  | "CLINICAL_OR_UNKNOWN";

export type PharmacyConversationRoute = {
  intent: PharmacyConversationIntent;
  interruptsClinicalAnswer: boolean;
};

/**
 * Priority is intentional: an emergency always wins, even when the same
 * message also looks like a greeting, product request, or workflow command.
 */
export function routePharmacyConversationMessage(message: string): PharmacyConversationRoute {
  const text = String(message ?? "").trim();
  if (EMERGENCY_PATTERN.test(text)) return { intent: "EMERGENCY", interruptsClinicalAnswer: true };
  if (HUMAN_HANDOFF_PATTERN.test(text)) return { intent: "HUMAN_HANDOFF", interruptsClinicalAnswer: true };
  if (CANCEL_PATTERN.test(text)) return { intent: "CANCEL_OR_RESTART", interruptsClinicalAnswer: true };
  if (CORRECTION_PATTERN.test(text)) return { intent: "CORRECTION", interruptsClinicalAnswer: true };
  if (ORDER_STATUS_PATTERN.test(text)) return { intent: "ORDER_STATUS", interruptsClinicalAnswer: true };
  if (PRODUCT_SIDE_INTENT_PATTERN.test(text)) return { intent: "PRODUCT_SIDE_INTENT", interruptsClinicalAnswer: true };
  if (GREETING_PATTERN.test(text)) return { intent: "GREETING", interruptsClinicalAnswer: true };
  if (THANKS_PATTERN.test(text)) return { intent: "THANKS", interruptsClinicalAnswer: true };
  if (SMALL_TALK_PATTERN.test(text)) return { intent: "SMALL_TALK", interruptsClinicalAnswer: true };
  return { intent: "CLINICAL_OR_UNKNOWN", interruptsClinicalAnswer: false };
}

export function pharmacyRouterReply(
  route: PharmacyConversationRoute,
  options: { activeClinicalWorkflow: boolean; resumePrompt?: string | null }
): string | null {
  const resumePrompt = options.resumePrompt?.trim();
  const resume = resumePrompt ? `\n\nกลับมาที่คำถามเดิมนะคะ: ${resumePrompt}` : "";

  if (route.intent === "GREETING") {
    return options.activeClinicalWorkflow
      ? `สวัสดีค่ะ ยินดีช่วยนะคะ ข้อมูลที่ตอบไว้ยังอยู่ครบค่ะ${resume}`
      : "สวัสดีค่ะ ต้องการซื้อสินค้า ปรึกษาอาการ หรือตรวจสอบคำสั่งซื้อคะ?";
  }
  if (route.intent === "THANKS") {
    return options.activeClinicalWorkflow
      ? `ยินดีค่ะ ข้อมูลที่ตอบไว้ยังอยู่ครบค่ะ${resume}`
      : "ยินดีค่ะ หากต้องการซื้อสินค้าหรือปรึกษาอาการ แจ้งได้เลยนะคะ";
  }
  if (route.intent === "SMALL_TALK") {
    return options.activeClinicalWorkflow
      ? `ยินดีช่วยอยู่ค่ะ ข้อมูลการซักอาการยังไม่หายนะคะ${resume}`
      : "ยินดีช่วยค่ะ ต้องการซื้อสินค้า ปรึกษาอาการ หรือตรวจสอบคำสั่งซื้อคะ?";
  }
  if (route.intent === "PRODUCT_SIDE_INTENT" && options.activeClinicalWorkflow) {
    return `ตอนนี้กำลังเก็บข้อมูลอาการอยู่ค่ะ ข้อความนี้จึงยังไม่ถูกบันทึกเป็นคำตอบทางสุขภาพ หากต้องการออกไปซื้อสินค้า พิมพ์ “หยุดซักอาการ” ก่อนนะคะ${resume}`;
  }
  if (route.intent === "ORDER_STATUS" && options.activeClinicalWorkflow) {
    return `ข้อความนี้เป็นคำถามเรื่องคำสั่งซื้อ จึงยังไม่ถูกบันทึกเป็นคำตอบทางสุขภาพค่ะ กรุณาพิมพ์ “หยุดซักอาการ” ก่อน แล้วจึงตรวจสอบคำสั่งซื้อนะคะ${resume}`;
  }
  return null;
}
