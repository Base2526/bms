import { getMessage, type Lang } from "./index";

export type UiTranslator = ((key: string, values?: Record<string, unknown>) => string) & {
  readonly language: Lang;
  readonly locale: string;
};

/** A locale-aware facade over the shared dictionary, for explicit UI keys only. */
export function createUiTranslator(language: Lang): UiTranslator {
  return Object.assign(
    (key: string, values?: Record<string, unknown>) => getMessage(
      language,
      key,
      values && Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value)])),
    ),
    { language, locale: language === "en" ? "en-GB" : "th-TH" },
  );
}
