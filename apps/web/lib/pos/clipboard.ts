/**
 * Copy text from a direct user action without assuming the asynchronous Clipboard API is allowed.
 * Electron and some managed browsers expose `navigator.clipboard` but still reject `writeText()`;
 * that rejection must fall through to the selection-based browser copy path instead of escaping as
 * an unhandled promise rejection.
 */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // A present Clipboard API is not proof that this frame has write permission.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  try {
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
