// Native and desktop must calculate the cashier-facing preview from the same dependency-free core.
// The backend still recomputes every price and remains authoritative at settlement.
export * from '../../../../packages/pos-client-core/src/cartPricing';
