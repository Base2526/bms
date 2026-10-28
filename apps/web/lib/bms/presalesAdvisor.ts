import type { PublicPlan, PresalesLocale } from "./platformPresales";
import { BMS_LINE_OA_ID, BMS_LINE_OA_URL } from "./lineOfficialAccount";

type Capacity = "max_devices" | "max_branches" | "max_users" | "max_products" | "max_orders_month" | "max_channels" | "ai_credits_monthly";
export type PresalesNeeds = { counts: Partial<Record<Capacity, number>>; ambiguous: boolean; budgetMonthly?: number; features: Array<"REPORT_SCHEDULE" | "RETENTION_ENGINE"> };
const labels: Record<Capacity, [string, string]> = {
  max_devices: ["เครื่อง POS", "POS devices"], max_branches: ["สาขา", "branches"],
  max_users: ["บัญชีผู้ใช้", "user accounts"], max_products: ["สินค้า", "products"],
  max_orders_month: ["ออร์เดอร์/เดือน", "orders/month"], max_channels: ["ช่องทาง", "channels"],
  ai_credits_monthly: ["แต้ม AI/เดือน", "AI points/month"],
};

/** User statements only; assistant history is never evidence for capacity or price. */
export function extractPresalesNeeds(messages: readonly string[]): PresalesNeeds {
  const counts: PresalesNeeds["counts"] = {};
  let ambiguous = false;
  let budgetMonthly: number | undefined;
  const features = new Set<"REPORT_SCHEDULE" | "RETENTION_ENGINE">();
  const thai = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ"];
  const english = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  for (const message of messages) {
    let value = message.normalize("NFKC").toLowerCase().replace(/[๐-๙]/g, digit => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit))).replace(/(?<=\d),(?=\d{3}(?:,|\D|$))/g, "");
    // Word counts are accepted only next to a known capacity unit.
    for (let n = 10; n >= 0; n--) {
      value = value.replace(new RegExp(`${thai[n]}(?=\\s*(?:เครื่อง|สาขา|คน|ช่องทาง))`, "g"), String(n));
      value = value.replace(new RegExp(`\\b${english[n]}(?=\\s+(?:pos|devices?|registers?|branch(?:es)?|users?|channels?))`, "g"), String(n));
    }
    const patterns: Array<[Capacity, RegExp]> = [
      ["max_devices", /(?:pos|เครื่องคิดเงิน|เครื่องขาย)\s*(\d+)\s*(?:เครื่อง|devices?|registers?)|(?:\b|ใช้\s*)(\d+)\s*(?:pos\s*)?(?:devices?|registers?)\b|^\s*(\d+)\s*เครื่อง\s*(?:ครับ|ค่ะ|คะ)?\s*$/g],
      ["max_branches", /(\d+)\s*(?:สาขา|branch(?:es)?\b)/g],
      ["max_users", /(?:พนักงาน|ผู้ใช้|บัญชีผู้ใช้)\s*(\d+)\s*(?:คน|บัญชี)?|(\d+)\s*(?:users?|staff accounts?)\b/g],
      ["max_products", /สินค้า\s*(\d+)\s*(?:รายการ|ชนิด|sku)|(\d+)\s*(?:products?|skus?)\b/g],
      ["max_orders_month", /(\d+)\s*(?:ออร์เดอร์|orders?)\s*(?:ต่อเดือน|\/เดือน|per month|\/month)/g],
      ["max_channels", /(\d+)\s*(?:ช่องทาง|channels?\b)/g],
      ["ai_credits_monthly", /(\d+)\s*(?:แต้ม\s*ai|ai\s*(?:points?|credits?))\s*(?:ต่อเดือน|\/เดือน|per month|\/month)/g],
    ];
    // Ranges, per-branch quantities and corrections need a total, not a guessed multiplication.
    if (/(?:\d+\s*[-–.]\s*\d+|สาขาละ|ต่อสาขา|per branch|ไม่ใช่|แทนที่จะ|เปิดอีก|เพิ่มอีก|more branches|another branch)/.test(value)) ambiguous = true;
    else if (/(?:รวมทุกสาขา|รวมทั้งหมด|total|in total)/.test(value)) ambiguous = false;
    const budget = value.match(/(?:งบ(?:ประมาณ)?\s*(?:ไม่เกิน\s*)?(?:เดือนละ|ต่อเดือน)\s*(?:ไม่เกิน\s*)?|monthly budget\s*(?:of\s*)?)(\d+)(?![\d.])/)
      ?? value.match(/(?:งบ(?:ประมาณ)?\s*(?:ไม่เกิน\s*)?|budget(?: of)?\s*|under\s*)(\d+)\s*(?:บาท|thb)?\s*(?:ต่อเดือน|\/เดือน|per month|\/month)/);
    if (budget && !/\b(?:usd|eur|dollars?)\b|ดอลลาร์|ยูโร/.test(value)) budgetMonthly = Number(budget[1]);
    if (/(?:ไม่ต้องการ|ไม่เอา|do not need|don't need).*?(?:ตั้งเวลารายงาน|ตั้งเวลาส่งรายงาน|scheduled reports)/.test(value)) features.delete("REPORT_SCHEDULE");
    else if (/(?:ต้องการ|อยาก|need|want).*?(?:ตั้งเวลารายงาน|ตั้งเวลาส่งรายงาน|scheduled reports)/.test(value)) features.add("REPORT_SCHEDULE");
    if (/(?:ไม่ต้องการ|ไม่เอา|do not need|don't need).*?(?:retention|วิเคราะห์ลูกค้าที่หาย)/.test(value)) features.delete("RETENTION_ENGINE");
    else if (/(?:ต้องการ|อยาก|need|want).*?(?:retention|วิเคราะห์ลูกค้าที่หาย)/.test(value)) features.add("RETENTION_ENGINE");
    for (const [key, pattern] of patterns) {
      const found = [...value.matchAll(pattern)].map(match => Number(match[1] ?? match[2] ?? match[3]));
      if (new Set(found).size > 1) ambiguous = true;
      const count = found.at(-1);
      if (count !== undefined && Number.isSafeInteger(count) && count > 0) counts[key] = count;
    }
  }
  return { counts, ambiguous, budgetMonthly, features: [...features] };
}

export function presalesContact(locale: PresalesLocale, channel?: string | null): string {
  return locale === "th"
    ? `${channel === "line" ? "คุณอยู่ใน LINE ของ BMS แล้ว สามารถพิมพ์ว่าต้องการคุยเจ้าหน้าที่ พร้อมเรื่องที่ต้องการให้ช่วยได้ค่ะ" : `ติดต่อทีม BMS ทาง LINE ${BMS_LINE_OA_ID}: ${BMS_LINE_OA_URL}`} ยังไม่ได้สร้างคิวหรือนัดหมายเจ้าหน้าที่ และยังไม่มีเบอร์โทรที่ยืนยันไว้สำหรับแนะนำในแชทนี้ค่ะ`
    : `${channel === "line" ? "You are already in BMS LINE. You can request a person here and describe what you need." : `Contact BMS on LINE ${BMS_LINE_OA_ID}: ${BMS_LINE_OA_URL}`} This does not create a ticket or appointment. No verified telephone number is available in this chat.`;
}

/** Evaluate only fresh catalogue facts. Unknown needs remain explicitly conditional. */
export function composePresalesRecommendation(plans: readonly PublicPlan[], needs: PresalesNeeds, locale: PresalesLocale): string | null {
  const th = locale === "th";
  const entries = Object.entries(needs.counts) as Array<[Capacity, number]>;
  if (!entries.length && !needs.ambiguous && !needs.features.length && needs.budgetMonthly === undefined) return null;
  if (needs.ambiguous) return th
    ? "ขอจำนวนเครื่อง POS รวมทุกสาขาและจำนวนสาขารวมหลังขยายที่ต้องการใช้งาน เพื่อเลือกแพ็กเกจให้ตรงค่ะ ตัวเลขที่เป็นช่วง ต่อสาขา หรือจำนวนที่เพิ่มยังสรุปเป็นยอดรวมไม่ได้"
    : "Please confirm total POS devices across all branches and total branches after expansion. A range, per-branch count or additional count is not yet a confirmed total.";
  if (!plans.length) return th ? "ยังแนะนำแพ็กเกจพร้อมราคาไม่ได้ เพราะตรวจสอบรายการล่าสุดไม่สำเร็จค่ะ" : "I cannot recommend a priced plan until the current catalogue can be verified.";
  const valid = plans.filter(plan => Number.isFinite(plan.price_monthly) && plan.price_monthly >= 0 &&
    entries.every(([key]) => Number.isInteger(plan[key]) && plan[key] >= -1));
  const fits = (plan: PublicPlan) => entries.every(([key, count]) => plan[key] === -1 || plan[key] >= count) && needs.features.every(feature => plan.feature_keys?.includes(feature));
  const sorted = [...valid].sort((a, b) => a.price_monthly - b.price_monthly || a.code.localeCompare(b.code));
  const budgetOnly = needs.budgetMonthly !== undefined && !entries.length && !needs.features.length;
  const affordable = budgetOnly ? sorted.filter(plan => plan.price_monthly <= needs.budgetMonthly!) : [];
  // With no sizing evidence, offer an entry paid option plus Free, not an assertion of best fit.
  const chosen = budgetOnly
    ? affordable.find(plan => plan.price_monthly > 0) ?? affordable[0]
    : sorted.find(fits);
  const featureLabels = { REPORT_SCHEDULE: th ? "ตั้งเวลารายงาน" : "scheduled reports", RETENTION_ENGINE: th ? "วิเคราะห์ Retention" : "retention analysis" };
  const summary = [...entries.map(([key, count]) => `${count.toLocaleString("en-US")} ${labels[key][th ? 0 : 1]}`), ...needs.features.map(key => featureLabels[key])].join(" · ") || (th ? "งบประมาณที่แจ้ง" : "the stated budget");
  if (!chosen && budgetOnly) return th
    ? `จากงบ ${needs.budgetMonthly!.toLocaleString("en-US")} บาท/เดือน ยังไม่พบแพ็กเกจที่ตรวจสอบแล้วว่าอยู่ในงบค่ะ รบกวนติดต่อทีม BMS เพื่อทบทวนความต้องการและทางเลือกก่อน ไม่ถือว่ามีส่วนลดอัตโนมัติ`
    : `No verified plan fits your ${needs.budgetMonthly!.toLocaleString("en-US")} THB/month budget. Contact BMS to review requirements and options; no automatic discount is implied.`;
  if (!chosen) return th
    ? `จากความต้องการ ${summary} ยังไม่พบแพ็กเกจที่ยืนยันว่ารองรับครบค่ะ ให้ทีม BMS ประเมินขอบเขตและเสนอราคาเฉพาะก่อน ไม่ถือว่าขยายโควตาได้อัตโนมัติ`
    : `For ${summary}, no verified plan meets every stated capacity. Ask BMS to assess scope and pricing; additional capacity is not automatic.`;
  const price = chosen.price_monthly.toLocaleString("en-US");
  const enterprise = chosen.code.toLowerCase() === "enterprise";
  const limits = entries.map(([key, count]) => `${labels[key][th ? 0 : 1]} ${count} / ${chosen[key] === -1 ? (th ? "ไม่จำกัด" : "unlimited") : chosen[key]}`).join(" · ");
  const rejected = sorted.filter(plan => plan.price_monthly < chosen.price_monthly && !fits(plan)).map(plan => {
    const failures = entries.filter(([key, count]) => plan[key] !== -1 && plan[key] < count);
    return `${plan.name}: ${[...failures.map(([key, count]) => `${labels[key][th ? 0 : 1]} ${plan[key]} < ${count}`), ...needs.features.filter(key => !plan.feature_keys?.includes(key)).map(key => (th ? "ไม่มี " : "missing ") + featureLabels[key])].join(", ")}`;
  });
  const missing = (Object.keys(labels) as Capacity[]).filter(key => needs.counts[key] === undefined).slice(0, 3).map(key => labels[key][th ? 0 : 1]).join(", ");
  return [
    budgetOnly ? (th
      ? `งบ ${needs.budgetMonthly!.toLocaleString("en-US")} บาท/เดือน มี ${chosen.name} ${enterprise ? "เริ่ม " : ""}${price} บาท/เดือนเป็นตัวเลือกเริ่มต้นค่ะ ${chosen.price_monthly > 0 ? "เป็นแพ็กเกจแบบเสียเงินราคาเริ่มต้นที่อยู่ในงบจากรายการล่าสุด" : "เป็นตัวเลือกฟรีที่อยู่ในงบ"} แต่ต้องตรวจจำนวนเครื่องและขนาดการใช้งานก่อนยืนยันว่าเพียงพอกับร้านค่ะ`
      : `With ${needs.budgetMonthly!.toLocaleString("en-US")} THB/month, ${chosen.name} at ${enterprise ? "from " : ""}${price} THB/month is a starting option: ${chosen.price_monthly > 0 ? "the lowest-priced paid plan within budget" : "a free option within budget"}. Device counts and usage still need checking before confirming suitability.`)
      : th ? `จากข้อมูลที่แจ้ง ${summary} แนะนำเบื้องต้น ${chosen.name} ${enterprise ? "เริ่ม " : ""}${price} บาท/เดือน เพราะเป็นแพ็กเกจราคาต่ำสุดในรายการล่าสุดที่รองรับจำนวนที่ระบุได้ครบค่ะ`
      : `For ${summary}, the provisional recommendation is ${chosen.name}, ${enterprise ? "from " : ""}${price} THB/month: the lowest-priced current plan meeting every stated capacity.`,
    limits ? (th ? "เหตุผลด้านจำนวนที่รองรับ: " : "Capacity comparison (needed / included): ") + limits : "",
    (th ? "รายละเอียดแพ็กเกจ:\n" : "Plan details:\n") + (Object.keys(labels) as Capacity[])
      .filter(key => Number.isInteger(chosen[key]) && chosen[key] >= -1)
      .map(key => `• ${labels[key][th ? 0 : 1]} ${chosen[key] === -1 ? (th ? "ไม่จำกัด" : "unlimited") : chosen[key].toLocaleString("en-US")}`).join("\n"),
    (th ? "ฟีเจอร์เพิ่มเติมตามแพ็กเกจ: " : "Additional plan features: ") + (chosen.feature_keys?.length
      ? chosen.feature_keys.map(key => featureLabels[key]).filter(Boolean).join(", ")
      : (th ? "ไม่มีฟีเจอร์เสริมแบบเสียเงินในข้อมูลที่ตรวจสอบ" : "no paid extras in the verified catalogue")),
    budgetOnly && chosen.price_monthly > 0 && affordable.some(plan => plan.price_monthly === 0)
      ? (th ? "หากต้องการเริ่มทดลองโดยไม่เสียค่าแพ็กเกจ ยังมีตัวเลือกฟรีด้วย แต่ต้องตรวจโควตาของแผนฟรีกับงานของร้านก่อนค่ะ" : "A free option is also available for starting without a subscription charge; its limits still need checking against your workload.") : "",
    needs.features.length ? (th ? "รองรับฟีเจอร์ที่ขอ: " : "Requested features included: ") + needs.features.map(key => featureLabels[key]).join(", ") : "",
    needs.budgetMonthly !== undefined && chosen.price_monthly > needs.budgetMonthly
      ? (th ? `แต่ราคาเกินงบ ${needs.budgetMonthly.toLocaleString("en-US")} บาท/เดือนที่แจ้ง จึงยังไม่ใช่ตัวเลือกที่ตรงทั้งงานและงบค่ะ ควรให้ทีมช่วยทบทวนขอบเขตก่อน ไม่ถือว่ามีส่วนลดหรือเพิ่มโควตาให้ฟรี` : `This exceeds your ${needs.budgetMonthly.toLocaleString("en-US")} THB/month budget, so it does not meet both scope and budget. Ask the team to review scope; no discount or free capacity increase is implied.`) : "",
    rejected.length ? (th ? "แพ็กเกจที่ถูกกว่ายังไม่พอ: " : "Lower-priced plans fall short: ") + rejected.join("; ") : "",
    th ? `คำแนะนำนี้เทียบเฉพาะข้อมูลที่แจ้ง ยังไม่รับรองความเหมาะสมทุกด้าน${missing ? ` ขอทราบ ${missing} ที่ต้องการเพิ่มเติมค่ะ` : ""} จำนวนเครื่องไม่ใช่จำนวนผู้ใช้หรือแต้ม AI และแต้ม AI ไม่ใช่จำนวนข้อความ LINE ทั้งหมด`
      : `This compares stated needs only, not complete suitability.${missing ? ` Please also confirm ${missing}.` : ""} Devices, users and AI points are separate; AI points are not all LINE messages.`,
    enterprise ? (th ? "Enterprise ต้องให้ฝ่ายขายประเมินและทำสัญญารายปี ราคานี้เป็นราคาเริ่มต้นค่ะ" : "Enterprise requires sales assessment and an annual contract; this is a starting price.") : "",
    th ? "ราคานี้เป็นค่าแพ็กเกจตามรายการปัจจุบัน ไม่ใช่ใบเสนอราคารวมอุปกรณ์ ติดตั้ง ย้ายข้อมูล หรือภาษี และไม่ยืนยันสิทธิ์เดิมของร้านคุณค่ะ" : "Catalogue subscription price is not an all-inclusive quote for hardware, setup, migration or tax, nor verification of an existing shop's entitlements.",
  ].filter(Boolean).join("\n\n");
}
