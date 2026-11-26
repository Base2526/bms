import { isMenuSellable, type MenuStockPolicy } from "./menuAvailability";

type Variant = { size: string; available: number; price: number };

/** Only active catalog variants are passed here; RECIPE/NON_STOCK do not hold own stock. */
export function restaurantMenuStartingPrice(input: {
  variants: Variant[]; stockPolicy: MenuStockPolicy | null;
  temporarilyUnavailable: boolean; fallbackPrice: number;
}) {
  const choices = input.variants.map((variant) => ({
    ...variant,
    sellable: isMenuSellable({ stockPolicy: input.stockPolicy,
      temporarilyUnavailable: input.temporarilyUnavailable, available: variant.available }).sellable,
  }));
  const prices = choices.filter((variant) => variant.sellable).map((variant) => variant.price);
  return { price: prices.length ? Math.min(...prices) : input.fallbackPrice, choices };
}
