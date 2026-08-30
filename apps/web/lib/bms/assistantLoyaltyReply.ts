export type LoyaltyProgramStatus = {
  enabled: boolean;
  redeemPointsPerUnit: number;
  redeemBahtPerUnit: number;
  redeemMinPoints: number;
};

type DesiredRedemptionSetup = {
  pointsPerUnit: number;
  bahtPerUnit: number;
  minPoints: number | null;
};

const NUMBER = "([0-9]+(?:\\.[0-9]+)?)";

export function isLoyaltyRedemptionCalculationRequest(
  message: string,
  currentPath: string | null,
  pageId: string | null
): boolean {
  const onLoyaltyPage = currentPath === "/admin/loyalty" || pageId === "loyalty";
  const asksAboutPoints = /(แต้ม|loyalty|points?)/i.test(message);
  const asksAboutRedemption = /(แลก|กี่บาท|มูลค่าแต้ม|redeem|redemption|worth|point\s+value)/i.test(message);
  const asksForCalculation = /(คำนวณ|ตัวอย่าง|ต่อ\s*1|ขั้นต่ำ|สูตร|กรอก|rate|example|calculate|per\s*(?:point|unit)|how\s+to\s+set)/i.test(message);
  return asksAboutPoints && asksAboutRedemption && (asksForCalculation || onLoyaltyPage);
}

export function extractDesiredRedemptionSetup(message: string): DesiredRedemptionSetup | null {
  const normalized = message.replace(/,/g, "");
  const bahtFirst = normalized.match(
    new RegExp(`${NUMBER}\\s*(?:บาท|baht|฿)\\s*(?:ต่อ|=|per)\\s*${NUMBER}\\s*(?:แต้ม|points?)`, "i")
  );
  const pointsFirst = normalized.match(
    new RegExp(`${NUMBER}\\s*(?:แต้ม|points?)\\s*(?:ต่อ|=|แลก(?:เป็น|ได้)?|gives?|for)\\s*(?:฿\\s*)?${NUMBER}\\s*(?:บาท|baht)?`, "i")
  );
  const match = bahtFirst ?? pointsFirst;
  if (!match) return null;

  const bahtPerUnit = Number(bahtFirst ? match[1] : match[2]);
  const pointsPerUnit = Number(bahtFirst ? match[2] : match[1]);
  if (!(bahtPerUnit > 0) || !(pointsPerUnit > 0)) return null;

  const minMatch = normalized.match(
    new RegExp(`(?:ขั้นต่ำ|อย่างน้อย|minimum|min(?:imum)?)[^0-9]{0,30}${NUMBER}\\s*(?:แต้ม|points?)`, "i")
  );
  return {
    pointsPerUnit,
    bahtPerUnit,
    minPoints: minMatch ? Number(minMatch[1]) : null,
  };
}

function formatNumber(value: number, locale: "th" | "en"): string {
  return value.toLocaleString(locale === "en" ? "en-US" : "th-TH", {
    maximumFractionDigits: 4,
  });
}

function discountFor(settings: LoyaltyProgramStatus, requestedPoints: number): number {
  return pointsToDiscount(
    { ...DEFAULT_LOYALTY_SETTINGS, ...settings, enabled: true },
    requestedPoints
  ).discount;
}

export function formatLoyaltyRedemptionReply(
  settings: LoyaltyProgramStatus,
  message: string,
  locale: "th" | "en"
): string {
  const desired = extractDesiredRedemptionSetup(message);
  const firstEligiblePoints = Math.max(settings.redeemMinPoints, settings.redeemPointsPerUnit);
  const firstDiscount = discountFor(settings, firstEligiblePoints);
  const requestedSettings = desired
    ? {
        enabled: true,
        redeemPointsPerUnit: desired.pointsPerUnit,
        redeemBahtPerUnit: desired.bahtPerUnit,
        redeemMinPoints: desired.minPoints ?? settings.redeemMinPoints,
      }
    : null;

  if (locale === "en") {
    const lines = [
      `Current shop setting: ${formatNumber(settings.redeemPointsPerUnit, locale)} points = ฿${formatNumber(settings.redeemBahtPerUnit, locale)} discount.`,
      `Minimum redemption: ${formatNumber(settings.redeemMinPoints, locale)} points. At ${formatNumber(firstEligiblePoints, locale)} points, the discount is ฿${formatNumber(firstDiscount, locale)}.`,
    ];
    if (desired && requestedSettings) {
      lines.push(
        `For the rate you requested, enter ${formatNumber(desired.pointsPerUnit, locale)} in Points spent per redemption unit and ${formatNumber(desired.bahtPerUnit, locale)} in Discount per redemption unit.${desired.minPoints == null ? "" : ` Enter ${formatNumber(desired.minPoints, locale)} in Minimum redemption.`}`,
        `That setup makes ${formatNumber(requestedSettings.redeemMinPoints, locale)} points worth ฿${formatNumber(discountFor(requestedSettings, requestedSettings.redeemMinPoints), locale)} at the minimum. Confirm that discount amount before saving.`
      );
    } else {
      lines.push("The two rate fields define one redemption unit; the baht value is per individual point only when the points field is 1.");
    }
    lines.push(settings.enabled
      ? "The loyalty program is currently enabled."
      : "The loyalty program is currently off; these values will apply after it is enabled.");
    return lines.join("\n");
  }

  const lines = [
    `ค่าปัจจุบันของร้านคือ ${formatNumber(settings.redeemPointsPerUnit, locale)} แต้ม = ส่วนลด ${formatNumber(settings.redeemBahtPerUnit, locale)} บาท`,
    `แลกขั้นต่ำ ${formatNumber(settings.redeemMinPoints, locale)} แต้ม โดยเมื่อมี ${formatNumber(firstEligiblePoints, locale)} แต้ม จะแลกส่วนลดได้ ${formatNumber(firstDiscount, locale)} บาท`,
  ];
  if (desired && requestedSettings) {
    lines.push(
      `สำหรับอัตราที่ขอ ให้กรอก “แต้มที่ใช้ต่อ 1 หน่วยแลก” = ${formatNumber(desired.pointsPerUnit, locale)} และ “ส่วนลดที่ได้ต่อหน่วยแลก” = ${formatNumber(desired.bahtPerUnit, locale)}${desired.minPoints == null ? "" : ` พร้อมตั้ง “แลกขั้นต่ำ” = ${formatNumber(desired.minPoints, locale)} แต้ม`}`,
      `ค่านี้ทำให้เมื่อถึงขั้นต่ำ ${formatNumber(requestedSettings.redeemMinPoints, locale)} แต้ม ลูกค้าจะได้ส่วนลด ${formatNumber(discountFor(requestedSettings, requestedSettings.redeemMinPoints), locale)} บาท ควรยืนยันยอดส่วนลดนี้ก่อนบันทึก`
    );
  } else {
    lines.push("สองช่องอัตราแลกทำงานเป็นหนึ่งชุด มูลค่าบาทจะเท่ากับมูลค่าต่อแต้มก็ต่อเมื่อตั้งช่องแต้มเป็น 1");
  }
  lines.push(settings.enabled
    ? "โปรแกรมสะสมแต้มเปิดใช้อยู่ตอนนี้"
    : "โปรแกรมสะสมแต้มยังปิดอยู่ ค่านี้จะมีผลหลังเปิดใช้งาน");
  return lines.join("\n");
}
import { DEFAULT_LOYALTY_SETTINGS, pointsToDiscount } from "./loyaltyMath";
