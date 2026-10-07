/**
 * Pharmacist-approved guidance for clinical questions the customer AI must not answer itself.
 *
 * This module is pure on purpose (only the dependency-free emergency leaf): classifier and content
 * checks run in the pipeline, in the admin page and in tests, and every one must agree.
 *
 * What a template may contain (and what the default drafts below contain):
 *   1. red-flag screening that points to 1669,
 *   2. what to prepare for the pharmacist,
 *   3. when to see a doctor,
 *   4. how to reach the shop.
 * It must never name a medicine, give a dose, or call something safe. The text a customer sees
 * is always a body a licensed pharmacist approved; the model never writes or rephrases it.
 */
// Keep one safety normalizer and animal discriminator. The existing emergency leaf has no
// imports/IO, so sharing it preserves purity without another normalizer or a dependency cycle.
import { normalizePharmacySafetyText, isPharmacyAnimalMedicationQuestion } from "./emergency";

export const PHARMACY_GUIDANCE_CODES = [
  "SYMPTOM_TO_DRUG",
  "DRUG_INTERACTION",
  "ALLERGY_SUBSTITUTE",
  "SIDE_EFFECT",
  "MISSED_DOSE",
  "NOT_IMPROVING",
  "COMPARE_WITH_PRESCRIBED",
  "CHRONIC_CONDITION",
  "SPECIAL_POPULATION",
  "ANIMAL",
  "RESTRICTED_PRODUCT",
] as const;
export type PharmacyGuidanceCode = (typeof PHARMACY_GUIDANCE_CODES)[number];

export const PHARMACY_GUIDANCE_LOCALES = ["th", "en"] as const;
export type PharmacyGuidanceLocale = (typeof PHARMACY_GUIDANCE_LOCALES)[number];

export const PHARMACY_GUIDANCE_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;
export type PharmacyGuidanceStatus = (typeof PHARMACY_GUIDANCE_STATUSES)[number];

export const PHARMACY_GUIDANCE_MAX_BODY = 2000;

/** Values the server fills in. Anything else in {{...}} is not a placeholder the system knows. */
export const PHARMACY_GUIDANCE_PLACEHOLDERS = ["shop_phone", "business_hours", "shop_address"] as const;
export type PharmacyGuidancePlaceholder = (typeof PHARMACY_GUIDANCE_PLACEHOLDERS)[number];
export type PharmacyGuidanceValues = Partial<Record<PharmacyGuidancePlaceholder, string | null>>;

export function isPharmacyGuidanceCode(value: unknown): value is PharmacyGuidanceCode {
  return typeof value === "string" && (PHARMACY_GUIDANCE_CODES as readonly string[]).includes(value);
}

export function isPharmacyGuidanceLocale(value: unknown): value is PharmacyGuidanceLocale {
  return typeof value === "string" && (PHARMACY_GUIDANCE_LOCALES as readonly string[]).includes(value);
}

/**
 * Ordered most specific / most risky first. A message can match several rules ("my child is
 * allergic to X, what can she take instead") and the first match decides which pharmacist text
 * the customer reads, so the order is part of the contract, not a style choice.
 *
 * "ท้อง" alone is deliberately NOT a pregnancy signal: it is also in ท้องเสีย and ปวดท้อง.
 */
const RULES: ReadonlyArray<readonly [PharmacyGuidanceCode, RegExp | ((text: string) => boolean)]> = [
  ["ANIMAL", isPharmacyAnimalMedicationQuestion],
  ["ALLERGY_SUBSTITUTE", /(?:แพ้ยา|แพ้(?!อากาศ|ฝุ่น|อาหาร|เกสร).{0,25}(?:แทน|ตัวไหน|อะไร)|\ballerg(?!ic\s+(?:rhinitis|to\s+(?:dust|pollen|food))))/i],
  ["SIDE_EFFECT", /(?:ผลข้างเคียง|อาการข้างเคียง|(?:กิน|ทาน|ใช้).{0,25}(?:แล้ว|ไป).{0,25}(?:ผื่น|คัน|เวียนหัว|มึน|ง่วงมาก|ใจสั่น|คลื่นไส้|อาเจียน|ปวดท้อง|ท้องเสีย)|side[- ]?effects?|(?:took|taking|after).{0,30}(?:rash|itch|dizzy|nause|vomit|palpitation)|(?:rash|itch|dizzy|nause|vomit|palpitation).{0,30}(?:after|since).{0,15}(?:taking|took|using))/i],
  ["DRUG_INTERACTION", /(?:ยาตีกัน|(?:กิน|ทาน|ยา|พารา|ไอบู).{0,25}สลับกัน|\balternate\b.{0,35}\b(?:ibuprofen|paracetamol|acetaminophen|medicines?|medications?|pills?|tablets?)\b|(?:กิน|ทาน|ใช้).{0,35}(?:คู่กับ|ร่วมกับ|พร้อมกับ|ด้วยกัน|พร้อมกัน)|(?:คู่กับ|ร่วมกับ)ยา|interaction|(?:take|use|mix).{0,30}(?:with|together)|together with)/i],
  ["SPECIAL_POPULATION", /(?:ตั้งครรภ์|คนท้อง|ท้องอยู่|ตอนท้อง(?!ว่าง|อืด|ผูก|เสีย)|กำลังท้อง|ให้นม(?:ลูก|บุตร)?|ทารก|เด็ก|ลูก(?:อายุ|\s*\d|ชาย|สาว|น้อย)|ผู้สูงอายุ|คนแก่|pregnan|breast-?feed|nursing|infant|baby|toddler|\bchild(?:ren)?\b|\bkids?\b|elderly)/i],
  ["CHRONIC_CONDITION", /(?:โรคประจำตัว|โรคไต|ไตวาย|เบาหวาน|ความดัน|โรคหัวใจ|โรคตับ|หอบหืด|ไทรอยด์|kidney|renal|diabet|blood pressure|hypertension|heart (?:disease|condition)|liver|asthma|thyroid)/i],
  ["MISSED_DOSE", /(?:ลืม(?:กิน|ทาน|ใช้|หยอด)|missed.{0,12}dose|forgot.{0,15}(?:take|dose|pill))/i],
  ["COMPARE_WITH_PRESCRIBED", /(?:หมอสั่ง|แพทย์สั่ง|ยาจากหมอ|ยาจากโรงพยาบาล|ยาโรงพยาบาล|prescribed|doctor (?:gave|prescribed)|from (?:the|my) doctor)/i],
  ["NOT_IMPROVING", /(?:ไม่หาย(?!ใจ)|ไม่ดีขึ้น|ไม่ทุเลา|not (?:getting )?better|still (?:sick|hurts|have)|hasn't improved|not improving)/i],
  ["RESTRICTED_PRODUCT", /(?:ใบสั่งแพทย์|ยาคุมฉุกเฉิน|ยานอนหลับ|ยาลดน้ำหนัก|ยาควบคุม|ยาแก้อักเสบ|ยาฆ่าเชื้อ|antibiotic|prescription|sleeping pill|morning.?after|emergency contracepti|weight.?loss pill|controlled (?:drug|medicine))/i],
  ["SYMPTOM_TO_DRUG", /(?:กินอะไรดี|ทานอะไรดี|ใช้ยาอะไร|ยาอะไร|แนะนำยา|ควร(?:กิน|ทาน|ใช้)|ตัวไหนดี|ตัวไหนเหมาะ|ปวดหัว|ปวดท้อง|ท้องเสีย|มีไข้|เจ็บคอ|(?:^|[^ก-๙])(?:ไอ(?!บู)|ไข้)(?=$|[\s!?.]|ครับ|ค่ะ|คะ|มา|ไม่หาย|ทำไง|กิน|ทาน|ควร)|น้ำมูก|(?:what|which).{0,25}(?:medicine|medication|take)|recommend.{0,20}(?:medicine|medication)|i have (?:a )?(?:headache|cough|fever|diarrh|sore throat|cold))/i],
];

/** Deterministic. The model never chooses which pharmacist text a customer reads. */
export function classifyPharmacyGuidanceQuestion(message: string): PharmacyGuidanceCode | null {
  const text = normalizePharmacySafetyText(message);
  if (!text) return null;
  for (const [code, pattern] of RULES) if (typeof pattern === "function" ? pattern(text) : pattern.test(text)) return code;
  return null;
}

export function pharmacyGuidanceLocaleOf(message: string): PharmacyGuidanceLocale {
  return /[ก-๙]/.test(String(message ?? "")) ? "th" : "en";
}

/** Server-appended on every rendered reply, so no template can drop it. */
export const PHARMACY_GUIDANCE_FOOTER: Record<PharmacyGuidanceLocale, string> = {
  th: "ข้อความนี้ไม่ใช่การอนุมัติยาหรือยืนยันการขายนะคะ",
  en: "This reply does not approve medication or confirm a sale.",
};

const PLACEHOLDER = /\{\{[ \t]*([a-zA-Z_]+)[ \t]*\}\}/g;

/**
 * Fill known placeholders from server values. A line that still contains a placeholder after
 * filling (unknown name, or a value the shop has not set) is dropped entirely: a customer must
 * never read "{{shop_phone}}" or a sentence with a hole in it.
 */
export function renderPharmacyGuidance(
  body: string,
  values: PharmacyGuidanceValues,
  locale: PharmacyGuidanceLocale,
): string {
  const known = new Set<string>(PHARMACY_GUIDANCE_PLACEHOLDERS);
  const lines = String(body ?? "").replace(/\r\n?/g, "\n")
    .replace(/\{\{[^{}]*\n[^{}]*\}\}/g, "{{invalid_multiline}}")
    .split("\n").flatMap((line) => {
    let unresolved = /\{\{\{|\}\}\}/.test(line);
    const filled = line.replace(PLACEHOLDER, (_match, rawName: string) => {
      const name = rawName.toLowerCase();
      const value = known.has(name) ? values[name as PharmacyGuidancePlaceholder] : null;
      const text = typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
      if (!text) { unresolved = true; return ""; }
      return text;
    });
    return unresolved || /\{\{|\}\}/.test(filled) ? [] : [filled.trimEnd()];
  });
  const collapsed: string[] = [];
  for (const line of lines) {
    if (!line.trim() && (!collapsed.length || !collapsed[collapsed.length - 1].trim())) continue;
    collapsed.push(line);
  }
  while (collapsed.length && !collapsed[collapsed.length - 1].trim()) collapsed.pop();
  return [...collapsed, PHARMACY_GUIDANCE_FOOTER[locale]].join("\n");
}

export type PharmacyGuidanceWarning =
  | "DOSE_NUMBER"
  | "MEDICINE_NAME"
  | "SAFETY_CLAIM"
  | "UNKNOWN_PLACEHOLDER"
  | "TOO_LONG"
  | "EMPTY";

const DOSE_NUMBER = /\d+(?:[.,]\d+)?\s*(?:mg|มก\.?|มิลลิกรัม|ml|มล\.?|มิลลิลิตร|ซีซี|cc|เม็ด|แคปซูล|capsules?|tablets?|ช้อน(?:ชา|โต๊ะ)?|teaspoons?|หยด|drops?|ครั้ง\s*(?:ต่อ|\/)\s*วัน|times? (?:a|per) day)/i;
// "ไม่ปลอดภัย" is caught on purpose: a template must not make a safety judgement in either direction.
const SAFETY_CLAIM = /(?:ปลอดภัย|กินได้|ทานได้|ใช้ได้เลย|กินคู่กันได้|ไม่เป็นไร|ไม่อันตราย|\bsafe\b|\bsafely\b|you can take|it'?s fine to|no problem|harmless)/i;
// Bounded examples, not an exhaustive drug dictionary or a clinical classifier.
export const PHARMACY_GUIDANCE_MEDICINE_NAME_PATTERN = /(?:พารา|paracetamol|acetaminophen|ibuprofen|ไอบู|aspirin|แอสไพริน|loratadine|cetirizine|amoxicillin|อะม็อก|domperidone|omeprazole|diclofenac|antacid|ยาแก้แพ้|ยาลดกรด)/i;

/**
 * Content checks shown to the pharmacist before approval. They are warnings, not a gate: the
 * pharmacist is the authority on the text. The default drafts must raise none (pinned by tests).
 */
export function pharmacyGuidanceWarnings(body: string): PharmacyGuidanceWarning[] {
  const text = String(body ?? "");
  const out: PharmacyGuidanceWarning[] = [];
  if (!text.trim()) out.push("EMPTY");
  if (text.length > PHARMACY_GUIDANCE_MAX_BODY) out.push("TOO_LONG");
  if (DOSE_NUMBER.test(text)) out.push("DOSE_NUMBER");
  if (PHARMACY_GUIDANCE_MEDICINE_NAME_PATTERN.test(text)) out.push("MEDICINE_NAME");
  if (SAFETY_CLAIM.test(text)) out.push("SAFETY_CLAIM");
  const known = new Set<string>(PHARMACY_GUIDANCE_PLACEHOLDERS);
  const unrecognized = text.replace(PLACEHOLDER, (match, name: string) => known.has(name.toLowerCase()) ? "" : match);
  if (/\{\{|\}\}/.test(unrecognized) || /\{\{\{|\}\}\}/.test(text)) out.push("UNKNOWN_PLACEHOLDER");
  return out;
}

const CONTACT_TH = [
  "ติดต่อเภสัชกรของร้านได้ที่ {{shop_phone}}",
  "เวลาทำการของร้าน: {{business_hours}}",
].join("\n");
const CONTACT_EN = [
  "You can reach the shop's pharmacist at {{shop_phone}}",
  "Shop hours: {{business_hours}}",
].join("\n");
const RED_FLAG_TH = "หากมีอาการรุนแรง เช่น หายใจลำบาก เจ็บหน้าอก หน้าหรือปากบวม ผื่นขึ้นทั้งตัว หรือซึมลง ให้โทร 1669 หรือไปห้องฉุกเฉินทันทีค่ะ";
const RED_FLAG_EN = "If there are severe symptoms such as difficulty breathing, chest pain, a swollen face or lips, a rash all over the body, or drowsiness that is hard to wake from, call 1669 or go to an emergency department now.";
const PREPARE_TH = "เพื่อให้เภสัชกรตอบได้ตรง กรุณาเตรียม: ชื่อยาหรือรูปฉลากยาที่ใช้อยู่ทุกตัว ประวัติแพ้ยา อายุ น้ำหนัก โรคประจำตัว และตั้งครรภ์หรือให้นมบุตรหรือไม่";
const PREPARE_EN = "So the pharmacist can answer accurately, please have ready: the name or a photo of the label of every medicine in use, any drug allergies, age, weight, existing conditions, and whether pregnant or breastfeeding.";

/**
 * Starting drafts only. They are never shown to a customer until a licensed pharmacist copies
 * one into the shop's table, edits it as needed and approves it.
 */
export const PHARMACY_GUIDANCE_DEFAULT_DRAFTS: Record<PharmacyGuidanceCode, Record<PharmacyGuidanceLocale, string>> = {
  SYMPTOM_TO_DRUG: {
    th: ["การเลือกยาให้เหมาะกับอาการต้องให้เภสัชกรประเมินจากข้อมูลของคุณก่อนค่ะ", RED_FLAG_TH, PREPARE_TH, "หากอาการเป็นมาหลายวันหรือแย่ลง ควรพบแพทย์", CONTACT_TH].join("\n"),
    en: ["Choosing a medicine for a symptom needs the pharmacist to assess your details first.", RED_FLAG_EN, PREPARE_EN, "If the symptom has lasted several days or is getting worse, please see a doctor.", CONTACT_EN].join("\n"),
  },
  DRUG_INTERACTION: {
    th: ["การใช้ยาหลายตัวร่วมกันต้องให้เภสัชกรตรวจจากรายชื่อยาจริงทุกตัวค่ะ", "กรุณาเตรียมชื่อยาหรือรูปฉลากของยาทุกตัวที่ใช้อยู่ รวมถึงวิตามิน อาหารเสริม และสมุนไพร เพื่อปรึกษาเภสัชกร", CONTACT_TH].join("\n"),
    en: ["Using several medicines together needs the pharmacist to check the full list.", "Please prepare the name or a photo of the label of every medicine in use, including vitamins, supplements and herbal products, for the pharmacist.", CONTACT_EN].join("\n"),
  },
  ALLERGY_SUBSTITUTE: {
    th: ["เรื่องแพ้ยาและการเลือกยาทดแทนต้องให้เภสัชกรประเมินค่ะ", RED_FLAG_TH, "กรุณาเตรียมชื่อยาที่แพ้ อาการที่เคยเกิด และเกิดเมื่อไร เพื่อปรึกษาเภสัชกร", CONTACT_TH].join("\n"),
    en: ["A drug allergy and the choice of an alternative need the pharmacist's assessment.", RED_FLAG_EN, "Please prepare the name of the medicine, the reaction you had and when it happened, for the pharmacist.", CONTACT_EN].join("\n"),
  },
  SIDE_EFFECT: {
    th: [RED_FLAG_TH, "กรุณาปรึกษาเภสัชกรหรือแพทย์เรื่องอาการที่เกิด พร้อมเตรียมชื่อยา เวลาที่เริ่มใช้ และรายละเอียดอาการ", CONTACT_TH].join("\n"),
    en: [RED_FLAG_EN, "Please contact a pharmacist or doctor about the reaction. Have the medicine name, when you started it and what happened ready.", CONTACT_EN].join("\n"),
  },
  MISSED_DOSE: {
    th: ["เรื่องการจัดการเมื่อลืมใช้ยาต้องให้เภสัชกรประเมินค่ะ", "เตรียมชื่อยา เวลาที่ใช้จริงครั้งล่าสุด และเวลาที่ลืมใช้ เพื่อปรึกษาเภสัชกร", CONTACT_TH].join("\n"),
    en: ["Please ask a pharmacist what to do about a missed dose.", "Have the medicine name, when you last took it and when the missed dose was due ready.", CONTACT_EN].join("\n"),
  },
  NOT_IMPROVING: {
    th: ["หากใช้ยามาแล้วอาการไม่ดีขึ้นหรือแย่ลง ควรพบแพทย์ค่ะ", RED_FLAG_TH, "แจ้งเภสัชกรได้ว่าใช้ยาอะไรมาและนานเท่าไร", CONTACT_TH].join("\n"),
    en: ["If the symptoms have not improved, or are getting worse, please see a doctor.", RED_FLAG_EN, "You can tell the pharmacist which medicine you used and for how long.", CONTACT_EN].join("\n"),
  },
  COMPARE_WITH_PRESCRIBED: {
    th: ["กรุณาเตรียมชื่อยา รูปฉลาก และใบสั่งแพทย์ถ้ามี เพื่อให้เภสัชกรตรวจสอบ", "หากมีข้อสงสัยหรืออยากเปลี่ยนยา กรุณาปรึกษาแพทย์ผู้สั่งยาหรือเภสัชกร", CONTACT_TH].join("\n"),
    en: ["Please prepare the medicine names, label photos and prescription if available for the pharmacist to review.", "If you have a question or want to change it, please ask the prescribing doctor or a pharmacist.", CONTACT_EN].join("\n"),
  },
  CHRONIC_CONDITION: {
    th: ["ผู้ที่มีโรคประจำตัวควรให้เภสัชกรตรวจก่อนใช้ยาทุกครั้งค่ะ", PREPARE_TH, CONTACT_TH].join("\n"),
    en: ["People with an existing condition should have the pharmacist check before using any medicine.", PREPARE_EN, CONTACT_EN].join("\n"),
  },
  SPECIAL_POPULATION: {
    th: ["การใช้ยาในเด็ก ผู้ตั้งครรภ์ ผู้ให้นมบุตร และผู้สูงอายุ ต้องให้เภสัชกรประเมินเป็นรายคนค่ะ", "กรุณาแจ้งอายุ น้ำหนัก (สำหรับเด็ก) อายุครรภ์ หรือโรคประจำตัว", CONTACT_TH].join("\n"),
    en: ["Medicine for children, pregnancy, breastfeeding and older adults needs the pharmacist to assess each person.", "Please share the age, the weight (for a child), the stage of pregnancy, or any existing conditions.", CONTACT_EN].join("\n"),
  },
  ANIMAL: {
    th: ["เรื่องการให้ยาแก่สัตว์ กรุณาปรึกษาสัตวแพทย์ค่ะ", "หากสัตว์เลี้ยงกินยาของคนเข้าไปโดยไม่ตั้งใจ ให้ติดต่อสัตวแพทย์ทันที"].join("\n"),
    en: ["Please ask a veterinarian about giving medicine to an animal.", "If a pet has swallowed a human medicine by accident, contact a veterinarian now."].join("\n"),
  },
  RESTRICTED_PRODUCT: {
    th: ["ยากลุ่มนี้ต้องให้เภสัชกรซักถามก่อนจ่าย และบางชนิดต้องมีใบสั่งแพทย์ค่ะ จึงไม่สามารถยืนยันทางแชทได้", "กรุณาติดต่อหรือมาที่ร้านในเวลาที่เภสัชกรอยู่", CONTACT_TH].join("\n"),
    en: ["Medicines in this group need the pharmacist to ask some questions before dispensing, and some need a doctor's prescription, so this cannot be confirmed in chat.", "Please contact or visit the shop while the pharmacist is available.", CONTACT_EN].join("\n"),
  },
};
