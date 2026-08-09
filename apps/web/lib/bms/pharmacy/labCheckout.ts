import { randomUUID } from "node:crypto";

import { listSellableProducts } from "../products";
import { createOrder, type CreateOrderResult } from "../orders";

export type PharmacyLabCartInput = {
  sku: string;
  qty: number;
  size?: string | null;
};

export type CreatePharmacyLabOrderResult =
  | (CreateOrderResult & { customerRef?: string })
  | { status: "SIZE_REQUIRED"; sku: string; name: string; availableSizes: string[] };

function normalizeSizeText(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

export async function createPharmacyLabOrder(
  tenantId: string,
  items: PharmacyLabCartInput[],
  editorId: string | null
): Promise<CreatePharmacyLabOrderResult> {
  const normalized = items
    .map((item) => ({
      sku: String(item.sku ?? "").trim(),
      qty: Number(item.qty),
      size: normalizeSizeText(item.size),
    }))
    .filter((item) => item.sku && Number.isInteger(item.qty) && item.qty > 0);

  if (normalized.length === 0) return { status: "EMPTY" };

  const resolvedItems: Array<{ sku: string; size: string; qty: number }> = [];

  for (const item of normalized) {
    const { items: sellable } = await listSellableProducts(tenantId, {
      search: item.sku,
      inStockOnly: true,
      sort: "relevance",
      limit: 5,
    });
    const product = sellable.find((candidate) => candidate.sku.toLowerCase() === item.sku.toLowerCase());
    if (!product) {
      return { status: "NOT_FOUND", sku: item.sku, size: item.size ?? "UNKNOWN" };
    }
    const availableSizes = product.availableSizes
      .filter((variant) => Number(variant.available) > 0)
      .map((variant) => String(variant.size).trim())
      .filter(Boolean);
    if (availableSizes.length === 0) {
      return { status: "NOT_FOUND", sku: item.sku, size: item.size ?? "UNKNOWN" };
    }
    const requestedSize = item.size ? availableSizes.find((size) => size.toUpperCase() === item.size) ?? null : null;
    if (requestedSize) {
      resolvedItems.push({ sku: item.sku, size: requestedSize, qty: item.qty });
      continue;
    }
    if (availableSizes.length === 1) {
      resolvedItems.push({ sku: item.sku, size: availableSizes[0], qty: item.qty });
      continue;
    }
    return {
      status: "SIZE_REQUIRED",
      sku: item.sku,
      name: product.name,
      availableSizes,
    };
  }

  const customerRef = `pharmacy-lab:product:${Date.now()}:${randomUUID().slice(0, 8)}`;
  const result = await createOrder({
    tenantId,
    channel: "test",
    customerRef,
    items: resolvedItems,
    editorId,
  });

  return result.status === "CREATED" ? { ...result, customerRef } : result;
}
