/** Keep model prose readable in plain-text customer channels without changing verified values. */
export function formatGeneratedCustomerReply(reply: string): string {
  return String(reply || "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]{0,3}#{1,3}[ \t]+(.+)$/gm, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
