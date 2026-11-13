import english from "./pos-client.json";

export type PosLanguage = "th" | "en";
export type PosTranslator = ((
  source: string,
  values?: Record<string, unknown>
) => string) & { readonly locale: string; readonly language: PosLanguage };

/** Translate explicitly authored POS copy, never product/customer data or server evidence. */
export function createPosTranslator(language: PosLanguage): PosTranslator {
  return Object.assign(
    (source: string, values?: Record<string, unknown>) => {
      const translated =
        language === "en" &&
        Object.prototype.hasOwnProperty.call(english, source)
          ? (english as Record<string, string>)[source]
          : source;
      return values
        ? translated.replace(/\{(\w+)\}/g, (match, key) =>
            Object.prototype.hasOwnProperty.call(values, key)
              ? String(values[key])
              : match
          )
        : translated;
    },
    { language, locale: language === "en" ? "en-GB" : "th-TH" }
  );
}
