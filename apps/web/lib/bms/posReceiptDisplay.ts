/**
 * Order snapshots from before product-name enforcement may contain a null or
 * blank name. GraphQL promises receipt lines always have a readable label, so
 * normalize legacy rows at the service boundary instead of letting one old
 * line null the entire receipt list.
 */
export function normalizePosReceiptName(
  receiptName: unknown,
  sku: unknown
): string {
  const name = typeof receiptName === "string" ? receiptName.trim() : "";
  if (name) return name;

  const fallbackSku = typeof sku === "string" ? sku.trim() : "";
  return fallbackSku || "สินค้า";
}
