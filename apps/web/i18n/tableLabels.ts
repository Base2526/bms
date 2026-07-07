import type { Lang } from "@/i18n";

export const translations = {
  en: {
    images: "Images",
    title: "Title",
    detail: "Detail",
    tel: "Tel",
    sellerAccounts: "Seller Accounts",
    action: "Action",
  },
  th: {
    images: "รูปภาพ",
    title: "หัวข้อ",
    detail: "รายละเอียด",
    tel: "เบอร์โทร",
    sellerAccounts: "บัญชีผู้ขาย",
    action: "การดำเนินการ",
  },
} as const;

export type TableLabelKey = keyof (typeof translations)["en"];

export function getTableLabels(lang: Lang | string) {
  const lng: Lang = lang === "en" || lang === "th" ? lang : "en";
  return translations[lng];
}

export function tTableLabel(lang: Lang | string, key: TableLabelKey): string {
  return getTableLabels(lang)[key];
}
