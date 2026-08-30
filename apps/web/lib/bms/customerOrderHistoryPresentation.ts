export type CustomerOrderHistoryPage = {
  orders?: Array<Record<string, unknown>>;
  totalCount?: number;
  successfulCount?: number;
  nextOffset?: number | null;
};

/** A short verified answer used only when provider prose is empty or token-truncated. */
export function formatCustomerOrderHistoryFallback(
  data: CustomerOrderHistoryPage | null | undefined,
  locale: "th" | "en" = "th"
): string {
  const history = data ?? {};
  const orders = Array.isArray(history.orders) ? history.orders.slice(0, 10) : [];
  const totalCount = Number(history.totalCount ?? 0);
  const successfulCount = Number(history.successfulCount ?? 0);
  const nextOffset = Number.isInteger(history.nextOffset) ? Number(history.nextOffset) : null;
  const en = locale === "en";
  const dateFormatter = new Intl.DateTimeFormat(en ? "en-GB" : "th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  const moneyFormatter = new Intl.NumberFormat(en ? "en-US" : "th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const lines = orders.map((order, index) => {
    const amount = Number(order.total_amount ?? 0);
    const date = new Date(String(order.created_at ?? ""));
    const dateText = Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "-";
    return `${index + 1}. #${String(order.id ?? "").slice(0, 8)} · ${String(order.status ?? "-")} · ${moneyFormatter.format(Number.isFinite(amount) ? amount : 0)} ฿ · ${dateText}`;
  });
  const heading = en
    ? `Purchase history: showing ${orders.length} of ${totalCount} orders (${successfulCount} successful).`
    : `ประวัติการซื้อ: แสดง ${orders.length} จาก ${totalCount} รายการ (สำเร็จ ${successfulCount} รายการ)`;
  const empty = en ? "No orders were found for this customer." : "ไม่พบออเดอร์ของลูกค้ารายนี้";
  const continuation = nextOffset == null
    ? null
    : en
      ? `More history is available. Ask "show the next orders" to continue from item ${nextOffset + 1}.`
      : `ยังมีประวัติเพิ่มเติม พิมพ์ "ดูรายการถัดไป" เพื่อดูต่อจากรายการที่ ${nextOffset + 1}`;
  const notice = en
    ? "The AI response was cut short, so these verified results are shown directly."
    : "คำตอบ AI ถูกตัดก่อนจบ ระบบจึงแสดงผลที่ยืนยันแล้วให้โดยตรง";
  return [notice, heading, ...(lines.length ? lines : [empty]), ...(continuation ? [continuation] : [])].join("\n");
}
