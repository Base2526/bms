import { createPosTranslator } from "../../i18n/posClient";
import { getLangCookie } from "../lang";

/** Read at call time so asynchronous device errors use the current operator language. */
export function posText(source: string, values?: Record<string, unknown>) {
  return createPosTranslator(getLangCookie() ?? "th")(source, values);
}
