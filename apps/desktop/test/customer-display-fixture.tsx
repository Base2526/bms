import React from "react";
import { createRoot } from "react-dom/client";
import CustomerDisplayPage from "../../web/app/(pos)/pos/display/page";
import { CUSTOMER_DISPLAY_CHANNEL, EMPTY_CUSTOMER_DISPLAY, type CustomerDisplayPayload } from "../../web/lib/pos/customerDisplay";

const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
const brand = { name: "FAKE Shop B", branch: "สาขาทดสอบ", logoUrl: `${location.origin}/logo.png`, businessHours: "ทุกวัน 09:00 - 20:00", website: "https://example.com/FAKE-shop" };
const cart: CustomerDisplayPayload = { ...EMPTY_CUSTOMER_DISPLAY, brand,
  lines: [{ name: "ข้าวเหนียวมะม่วง", size: "ชุดอิ่มคุ้ม", qty: 1, unitName: "ชุด", amount: 89 },
    { name: "ข้าวเหนียวมะม่วง", size: "สูตรพิเศษ", qty: 1, unitName: "ชุด", amount: 89 }],
  itemCount: 2, total: 178, amountDue: 168, discountTotal: 10,
  memberName: "Somchai PrivateSurname", pointsBalance: 120, pointsWillEarn: 3 };
const fixtures = {
  idle: { ...EMPTY_CUSTOMER_DISPLAY, brand },
  cart,
  payment: { ...cart, checkout: true, paymentQr: { payload: "FAKE-provider-payload-not-a-payment", amount: 68, accountName: "FAKE Shop B", promptpayId: null } },
  cash: { ...cart, checkout: true },
  finished: { ...cart, pointsEarned: 3, pointsBalance: 123, finished: { id: "FAKE-1", total: 168, tendered: 200, change: 32, taxRequestUrl: "https://example.com/FAKE-tax-request" } },
  pending: { ...cart, checkout: true, pendingApproval: true },
  repricing: { ...cart, checkout: true, pendingPricing: true, paymentQr: { payload: "FAKE-stale-QR", amount: 168, accountName: "FAKE Shop B", promptpayId: null } },
  long: { ...cart, lines: Array.from({ length: 9 }, (_, i) => ({ name: `สินค้า ${i + 1} ชื่อรายการยาวสำหรับทดสอบการแสดงผล`, size: "สูตรพิเศษ", qty: 1, unitName: "ชุด", amount: 89 })), itemCount: 9 },
};
let current: CustomerDisplayPayload | null = fixtures.idle;
let receiptSequence = 0;
channel.onmessage = event => { if (event.data?.type === "hello" && current) channel.postMessage(current); };
Object.assign(window, {
  displayFixture(name: keyof typeof fixtures) {
    current = name === "finished" ? { ...fixtures.finished, finished: { ...fixtures.finished.finished, id: `FAKE-${++receiptSequence}`, completedAt: Date.now() } } : fixtures[name];
    channel.postMessage(current);
  },
  stopDisplayFixture() { current = null; },
});
createRoot(document.getElementById("root")!).render(<CustomerDisplayPage />);
