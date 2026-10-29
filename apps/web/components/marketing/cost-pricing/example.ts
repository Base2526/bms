/** Public illustrative scenario only; never used to price or value an actual order. */
export function calculateExample(goods: number, freight: number, price: number, fixed: number) {
  if (![goods, freight, price, fixed].every(n => Number.isFinite(n) && n >= 0 &&
    n <= 1_000_000 && Number(n.toFixed(2)) === n)) return null;
  // Satang inputs / 100 cups require ten-thousandths of a baht per cup.
  // Keep the division exact: 21,060 / (65.10 - 30) must be 600, not 601.
  const satang = (n: number) => Math.round(n * 100);
  const unit = satang(goods) + satang(freight) + 80_000;
  const contribution = satang(price) * 100 - unit;
  const fixedUnits = satang(fixed) * 100;
  // All intermediate integers remain below Number.MAX_SAFE_INTEGER at the input limit.
  const required = (denominator: number) => Math.floor((fixedUnits + denominator - 1) / denominator);
  return { unit: unit / 10_000, contribution: contribution / 10_000,
    monthly: contribution > 0 ? required(contribution) : null,
    daily: contribution > 0 ? required(contribution * 30) : null };
}
