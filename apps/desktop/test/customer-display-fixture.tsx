import React from "react";
import { createRoot } from "react-dom/client";
import CustomerDisplayPage from "../../web/app/(pos)/pos/display/page";
import { promptPayQrCrc } from "../../web/lib/bms/promptPayQr";
import { CUSTOMER_DISPLAY_CHANNEL, EMPTY_CUSTOMER_DISPLAY, type CustomerDisplayPayload } from "../../web/lib/pos/customerDisplay";

const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
const brand = { name: "FAKE Shop B", branch: "สาขาทดสอบ", logoUrl: `${location.origin}/logo.png`, customerDisplayBackgroundUrl: `${location.origin}/background.jpg`, businessHours: "ทุกวัน 09:00 - 20:00", website: "https://example.com/FAKE-shop" };
const cart: CustomerDisplayPayload = { ...EMPTY_CUSTOMER_DISPLAY, brand,
  lines: [{ name: "ข้าวเหนียวมะม่วง", size: "ชุดอิ่มคุ้ม", qty: 1, unitName: "ชุด", amount: 89 },
    { name: "ข้าวเหนียวมะม่วง", size: "สูตรพิเศษ", qty: 1, unitName: "ชุด", amount: 89 }],
  itemCount: 2, total: 178, amountDue: 168, discountTotal: 10,
  memberAttached: true, memberName: "Somchai PrivateSurname", pointsBalance: 120, pointsWillEarn: 3 };
const staticQrWithoutCrc = "00020101021129370016A0000006770101110213000000000000053037645802TH6304";
const staticPromptPayQr = `${staticQrWithoutCrc}${promptPayQrCrc(staticQrWithoutCrc)}`;
const fixtures = {
  idle: { ...EMPTY_CUSTOMER_DISPLAY, brand },
  cart,
  payment: { ...cart, checkout: true, paymentQr: { payload: staticPromptPayQr, amount: 68, accountName: "FAKE Shop B", promptpayId: null } },
  cash: { ...cart, checkout: true },
  finished: { ...cart, pointsEarned: 3, pointsBalance: 123, finished: { id: "FAKE-1", total: 168, tendered: 200, change: 32, taxRequestUrl: "https://example.com/FAKE-tax-request" } },
  finishedMaskedMember: { ...cart, memberName: null, pointsEarned: 3, pointsBalance: 123,
    finished: { id: "FAKE-masked", total: 168, tendered: 200, change: 32 } },
  finishedSimple: { ...cart, memberAttached: false, memberName: null, pointsBalance: null, pointsWillEarn: null, pointsEarned: null,
    finished: { id: "FAKE-simple", total: 3831, tendered: null, change: null, taxRequestUrl: null } },
  pending: { ...cart, checkout: true, pendingApproval: true },
  repricing: { ...cart, checkout: true, pendingPricing: true, paymentQr: { payload: "FAKE-stale-QR", amount: 168, accountName: "FAKE Shop B", promptpayId: null } },
  long: { ...cart, lines: Array.from({ length: 9 }, (_, i) => ({ name: `สินค้า ${i + 1} ชื่อรายการยาวสำหรับทดสอบการแสดงผล`, size: "สูตรพิเศษ", qty: 1, unitName: "ชุด", amount: 89 })), itemCount: 9 },
};
let current: CustomerDisplayPayload | null = fixtures.idle;
let receiptSequence = 0;
channel.onmessage = event => { if (event.data?.type === "hello" && current) channel.postMessage(current); };
Object.assign(window, {
  displayFixture(name: keyof typeof fixtures) {
    const fixture: CustomerDisplayPayload = fixtures[name];
    current = fixture.finished ? { ...fixture, finished: { ...fixture.finished, id: `FAKE-${++receiptSequence}`, completedAt: Date.now() } } : fixture;
    channel.postMessage(current);
  },
  stopDisplayFixture() { current = null; },
});
createRoot(document.getElementById("root")!).render(<CustomerDisplayPage />);
