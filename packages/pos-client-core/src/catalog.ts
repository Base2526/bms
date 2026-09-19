export type PosCatalogVariant = {
  size: string;
  available: number;
  price?: number | null;
};

export type PosCatalogCardItem = {
  price: number;
  availableTotal: number;
  availableSizes: readonly PosCatalogVariant[];
};

export type PosCatalogCardSelection = {
  variant: PosCatalogVariant | null;
  price: number;
  available: number;
};

/**
 * Keep the price, size and stock shown on a catalog card tied to one sellable
 * variant. `availableTotal` is the sum of every size and must not be presented
 * as the stock of the variant that clicking the card will add to the bill.
 */
export function selectPosCatalogCardVariant(
  item: PosCatalogCardItem,
): PosCatalogCardSelection {
  const availableVariants = item.availableSizes.filter(
    (variant) => Number(variant.available) > 0,
  );
  const variant = availableVariants.length
    ? availableVariants.reduce((best, candidate) => {
        const bestPrice = Number.isFinite(Number(best.price))
          ? Number(best.price)
          : Number(item.price);
        const candidatePrice = Number.isFinite(Number(candidate.price))
          ? Number(candidate.price)
          : Number(item.price);
        if (candidatePrice !== bestPrice) {
          return candidatePrice < bestPrice ? candidate : best;
        }
        return candidate.size.localeCompare(best.size, "th") < 0 ? candidate : best;
      })
    : null;
  const price = Number(variant?.price ?? item.price);

  return {
    variant,
    price: Number.isFinite(price) ? Math.max(0, price) : 0,
    available: variant
      ? Math.max(0, Number(variant.available) || 0)
      : Math.max(0, Number(item.availableTotal) || 0),
  };
}
