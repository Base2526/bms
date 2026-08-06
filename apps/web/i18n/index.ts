import th from "./th";
import en from "./en";

export type Lang = "th" | "en";

export const messages = {
  th,
  en,
};

export function getMessage(
  lang: Lang,
  path: string,
  vars?: Record<string, string | number>
): string {
  const parts = path.split(".");
  let obj: any = messages[lang];

  for (const p of parts) {
    if (obj && typeof obj === "object" && p in obj) {
      obj = obj[p];
    } else {
      return path; // fallback คืน key เอง
    }
  }

  if (typeof obj !== "string") return path;
  // {name} style placeholders — optional, most keys don't use it. th/en can put {var}
  // wherever fits each language's word order since substitution just does string replace.
  if (!vars) return obj;
  return obj.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
