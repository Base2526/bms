export const MIN_FORECAST_ORDERS = 7;
export const MIN_FORECAST_ACTIVE_DAYS = 3;

export type ForecastDataQuality = {
  status: "SUFFICIENT" | "INSUFFICIENT";
  paidOrderCount: number;
  activeSalesDays: number;
  requiredPaidOrders: number;
  requiredActiveSalesDays: number;
  reason: string | null;
};

export function forecastDataQualityFromCounts(
  paidOrderCount: number,
  activeSalesDays: number
): ForecastDataQuality {
  const sufficient = paidOrderCount >= MIN_FORECAST_ORDERS
    && activeSalesDays >= MIN_FORECAST_ACTIVE_DAYS;
  return {
    status: sufficient ? "SUFFICIENT" : "INSUFFICIENT",
    paidOrderCount,
    activeSalesDays,
    requiredPaidOrders: MIN_FORECAST_ORDERS,
    requiredActiveSalesDays: MIN_FORECAST_ACTIVE_DAYS,
    reason: sufficient
      ? null
      : `ข้อมูลยังไม่พอสำหรับคาดการณ์: ต้องมีอย่างน้อย ${MIN_FORECAST_ORDERS} ออเดอร์ที่ชำระแล้วใน ${MIN_FORECAST_ACTIVE_DAYS} วันขายที่ต่างกัน`,
  };
}
