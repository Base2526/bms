import { BMS_LINE_OA_ID, BMS_LINE_OA_URL } from "./lineOfficialAccount";
import type { PresalesLocale } from "./platformPresales";

/** Strong intent only: a contact-detail question is not authority to create Sales work. */
export function isExplicitPresalesCallbackRequest(message: string): boolean {
  // NFKC splits Thai sara am; compose it back so Thai guards such as "ทำไม" still match.
  const value = message.normalize("NFKC").replace(/\u0e4d\u0e32/g, "\u0e33").trim().toLowerCase();
  if (!value) return false;
  // This detector authorizes a write. Negated, reported, hypothetical and contact-location
  // questions must stay read-only, even when they contain an otherwise valid request.
  if (/(?:ไม่ต้อง|ไม่อยาก|ไม่ต้องการ|อย่า|ยกเลิก|ยังไม่|ไม่ให้|ไม่ขอ|ไม่สะดวก|ไม่เอา|ถ้า|หาก|สมมติ|ตัวอย่าง|แปลว่า|แปลเป็น|ข้อความว่า|บอกว่า|เขียนว่า|ที่ไหน|อย่างไร|ยังไง|แล้วหรือยัง|หรือยัง|หรือเปล่า|เมื่อไหร่|เมื่อไร|กี่โมง|ทำไม|เคย|ไปแล้ว|ขอไว้|ขอไป|สถานะ|แค่ถาม|ระบบ(?:สามารถ|จะ|ช่วย|ต้อง|ให้))/.test(value)
    || /\b(?:don['’]?t|do not|no need|not now|never|cancel|stop|if|example|translate|said|wrote|where|how|when|already|has|did)\b/i.test(value)
    || /["“”«»]/.test(value)) return false;
  const person = "(?:sale(?:s)?|เซล(?:ส์)?|ฝ่ายขาย|ทีมขาย|เจ้าหน้าที่|แอดมิน|คน)";
  const action = "(?:ติดต่อกลับ|โทรกลับ|ทักกลับ|ติดต่อ|โทรหา|คุย)";
  return new RegExp(`(?:ให้|รบกวน|ช่วย|ขอ|อยากให้|ต้องการให้)\\s*${person}\\s*(?:ช่วย\\s*)?${action}`, "i").test(value)
    || new RegExp(`(?:ขอ|อยาก|ต้องการ)\\s*(?:คุย|ติดต่อ|พูด)\\s*(?:กับ)?\\s*${person}`, "i").test(value)
    || /(?:ช่วย|รบกวน|ขอให้|กรุณา)\s*(?:ติดต่อกลับ|โทรกลับ|ทักกลับ)/.test(value)
    || /^(?:(?:sale(?:s)?|ฝ่ายขาย|ทีมขาย)\s*)?(?:ติดต่อกลับ|โทรกลับ|ทักกลับ)\s*(?:$|ด้วย|หน่อย|ได้ไหม|ได้มั้ย|ที|ครับ|ค่ะ|นะ|ทางไลน์|ทาง line)/.test(value)
    || /\b(?:have|ask)\s+(?:(?:a|the)\s+)?(?:sales(?:\s+representative)?|salesperson|representative|agent|human|person)\s+(?:to\s+)?(?:call|contact|reach out to)\s+me\b/i.test(value)
    || /\b(?:please\s+(?:call|contact)|(?:can|could|would)\s+you\s+(?:please\s+)?(?:call|contact))\s+me\b/i.test(value)
    || /\b(?:can|could|would)\s+(?:sales|a representative|an agent)\s+(?:please\s+)?(?:call|contact)\s+me\b/i.test(value)
    || /\b(?:want to|need to|would like to|can i|could i|please let me)\s+(?:speak|talk)\s+(?:to|with)\s+(?:(?:a|an|the)\s+)?(?:sales|salesperson|representative|agent|human|person)\b/i.test(value);
}

export function isPresalesLineContactQuestion(message: string): boolean {
  const value = message.normalize("NFKC").trim().toLowerCase();
  return /(?:line\s*id|ไลน์\s*(?:ไอดี|id)|ขอไลน์|ไลน์(?:ของ|ติดต่อ)|ช่องทางไลน์)/i.test(value)
    && /(?:มี|อะไร|ไหน|ขอ|ติดต่อ|what|which|do you have|contact)/i.test(value);
}

export function composePresalesLineContactReply(locale: PresalesLocale, channel?: string | null): string {
  if (locale === "th") {
    return channel === "line"
      ? `คุณกำลังคุยกับ LINE OA ของ BMS อยู่แล้วค่ะ LINE ID คือ ${BMS_LINE_OA_ID} ไม่ต้องส่ง LINE ID ของคุณซ้ำ หากต้องการให้ฝ่ายขายติดต่อกลับ พิมพ์ว่า “ให้ Sales ติดต่อกลับ” พร้อมชื่อบริษัทและเรื่องที่สนใจได้เลยค่ะ`
      : `LINE OA ของ BMS คือ ${BMS_LINE_OA_ID}: ${BMS_LINE_OA_URL} หากต้องการให้ฝ่ายขายติดต่อกลับ แจ้งชื่อบริษัท เรื่องที่สนใจ และช่องทางที่สะดวกได้เลยค่ะ`;
  }
  return channel === "line"
    ? `You are already chatting with the BMS LINE OA. Its LINE ID is ${BMS_LINE_OA_ID}; you do not need to send your LINE ID again. To request Sales, say “Please have Sales contact me” and include your company and topic.`
    : `The BMS LINE OA is ${BMS_LINE_OA_ID}: ${BMS_LINE_OA_URL}. To request Sales, include your company, topic, and preferred contact method.`;
}

export function composePresalesCallbackReply(input: {
  locale: PresalesLocale;
  channel?: string | null;
  saved: boolean;
  repeated?: boolean;
  reference?: string | null;
}): string {
  const { locale, channel, saved, repeated, reference } = input;
  if (!saved) {
    return locale === "th"
      ? `ตอนนี้ยังบันทึกคำขอให้ฝ่ายขายติดต่อกลับไม่สำเร็จค่ะ จึงยังไม่ถือว่าส่งเข้าคิว Sales แล้ว กรุณาลองอีกครั้ง หรือติดต่อ LINE OA ของ BMS ที่ ${BMS_LINE_OA_ID} ค่ะ`
      : `I could not save the Sales callback request, so it has not entered the Sales queue. Please try again or contact the BMS LINE OA at ${BMS_LINE_OA_ID}.`;
  }
  const ref = reference ? (locale === "th" ? ` เลขอ้างอิง ${reference}` : ` Reference ${reference}.`) : "";
  if (locale === "th") {
    const state = repeated ? "อัปเดตคำขอเดิมและเลื่อนเป็นงานด่วนในคิว Sales แล้วค่ะ" : "บันทึกคำขอเป็นงานด่วนในคิว Sales แล้วค่ะ";
    const route = channel === "line" ? "ทีมสามารถตอบกลับใน LINE แชทนี้ได้เลย ไม่ต้องส่ง LINE ID ซ้ำ" : "ทีมสามารถตอบกลับในแชทนี้ได้";
    return `${state}${ref}\n\n${route} เพื่อให้เตรียมข้อมูลได้ตรงเรื่อง หากยังไม่ได้แจ้ง รบกวนส่งชื่อหรือชื่อบริษัท ประเภทธุรกิจ เรื่องที่สนใจ และขนาดการใช้งาน เช่น จำนวนสาขาหรือเครื่อง POS หากต้องการให้โทรกลับและยังไม่ได้ส่งเบอร์ ให้แจ้งเบอร์กับช่วงเวลาที่สะดวกค่ะ`;
  }
  const state = repeated ? "I updated the existing request and moved it to the top-priority Sales queue." : "I saved this as a top-priority request in the Sales queue.";
  const route = channel === "line" ? "The team can reply in this LINE chat, so you do not need to send your LINE ID again." : "The team can reply in this chat.";
  return `${state}${ref}\n\n${route} If not already provided, please share your name or company, business type, what you are interested in, and expected scale such as branches or POS devices. If you prefer a phone call and have not sent the number, include it with a convenient time.`;
}
