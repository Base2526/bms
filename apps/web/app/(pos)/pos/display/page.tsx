'use client';
// จอแสดงผลฝั่งลูกค้า (8.6)
// -------------------------------------------------------------
// เปิดหน้านี้บนจอที่สองที่หันไปทางลูกค้า · ลูกค้าเห็นรายการที่กำลังยิงกับยอดที่ต้องจ่าย
// ตามเวลาจริง ซึ่งเป็นสิ่งที่กฎหมายคุ้มครองผู้บริโภคหลายประเทศบังคับ และเป็นวิธีที่
// ถูกที่สุดในการตัดปัญหา "คิดเงินเกิน" ออกไป เพราะลูกค้าเห็นทุกบรรทัดตอนมันเกิด
//
// ทำไมใช้ BroadcastChannel ไม่ใช่ WebSocket:
//   จอที่สองคือหน้าต่างที่สองของ "เบราว์เซอร์ตัวเดียวกันบนเครื่องเดียวกัน" (ต่อ HDMI)
//   BroadcastChannel ส่งข้อความระหว่างหน้าต่างที่ origin เดียวกันได้ทันทีโดยไม่ต้อง
//   วิ่งผ่านเซิร์ฟเวอร์เลย — แปลว่ายอดบนจอลูกค้าไม่มีทางค้างเพราะเน็ตร้านหลุด
//   ซึ่งเป็นสถานการณ์ที่จอลูกค้าค้างแสดงยอดผิดจะแย่ที่สุด
//
// จอนี้อ่านอย่างเดียว ไม่มีปุ่มอะไรเลย และไม่คุยกับ API — ลูกค้าเอื้อมมาแตะได้

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  CUSTOMER_DISPLAY_CHANNEL,
  EMPTY_CUSTOMER_DISPLAY,
  type CustomerDisplayPayload,
} from "@/lib/pos/customerDisplay";

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustomerDisplayPage() {
  const [state, setState] = useState<CustomerDisplayPayload>(EMPTY_CUSTOMER_DISPLAY);
  const [linked, setLinked] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    ch.onmessage = (event) => {
      const data = event.data as CustomerDisplayPayload | { type: "ping" } | null;
      if (!data) return;
      if ((data as any).type === "ping") { setLinked(true); return; }
      setLinked(true);
      setState({ ...EMPTY_CUSTOMER_DISPLAY, ...(data as CustomerDisplayPayload) });
    };
    // บอกจอขายว่ามีจอลูกค้าเปิดอยู่ เพื่อให้มันเริ่มส่งสถานะทันทีไม่ต้องรอยิงของชิ้นถัดไป
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, []);

  useEffect(() => {
    let active = true;
    const payload = state.paymentQr?.payload.trim();
    if (!payload) {
      setQrDataUrl(null);
      return () => { active = false; };
    }
    setQrDataUrl(null);
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 520,
      color: { dark: "#0b0b0cff", light: "#ffffffff" },
    }).then((url) => {
      if (active) setQrDataUrl(url);
    }).catch(() => {
      if (active) setQrDataUrl(null);
    });
    return () => { active = false; };
  }, [state.paymentQr?.payload]);

  return (
    <div style={{
      minHeight: "100vh", background: "#0b0b0c", color: "#fff",
      fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif",
      display: "flex", flexDirection: "column", padding: "3vh 4vw", boxSizing: "border-box",
    }}>
      {!linked && (
        <div style={{ opacity: 0.5, fontSize: "2vh" }}>
          รอเชื่อมกับจอขาย — เปิดหน้านี้บนหน้าต่างที่สองของเบราว์เซอร์เดียวกัน
        </div>
      )}

      {/* บิลที่ปิดแล้ว: โชว์เงินทอนตัวใหญ่สุด เพราะเป็นตัวเลขเดียวที่ลูกค้าต้องตรวจตอนนั้น */}
      {state.finished ? (
        <div style={{ margin: "auto", textAlign: "center" }}>
          <div style={{ fontSize: "3vh", opacity: 0.7 }}>ขอบคุณค่ะ</div>
          <div style={{ fontSize: "4vh", marginTop: "2vh" }}>ยอดชำระ ฿{baht(state.finished.total)}</div>
          {state.finished.tendered != null && (
            <div style={{ fontSize: "3vh", opacity: 0.8, marginTop: "1vh" }}>
              รับมา ฿{baht(state.finished.tendered)}
            </div>
          )}
          {state.finished.change != null && (
            <div style={{ fontSize: "9vh", fontWeight: 700, marginTop: "2vh", color: "#7ee787" }}>
              เงินทอน ฿{baht(state.finished.change)}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: state.paymentQr ? "minmax(0,1fr) minmax(280px,34vw)" : "1fr",
            gap: "4vw",
            overflow: "hidden",
          }}>
            <div style={{ overflow: "hidden" }}>
              {state.lines.length === 0 ? (
                <div style={{ margin: "auto", opacity: 0.35, fontSize: "3vh", paddingTop: "20vh", textAlign: "center" }}>
                  ยินดีต้อนรับ
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh" }}>
                  {/* แสดงเฉพาะรายการท้าย ๆ — ลูกค้าสนใจของที่เพิ่งยิง ไม่ใช่รายการแรกของบิล
                      และการเลื่อนอัตโนมัติบนจอที่แตะไม่ได้อ่านยากกว่า */}
                  {state.lines.slice(-8).map((line, i) => (
                    <div key={i} style={{ display: "flex", gap: "2vw", fontSize: "2.6vh" }}>
                      <span style={{ opacity: 0.6, minWidth: "4vw" }}>{line.qty}×</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {line.name}{line.size ? ` (${line.size})` : ""}
                      </span>
                      <span>฿{baht(line.amount)}</span>
                    </div>
                  ))}
                  {state.lines.length > 8 && (
                    <div style={{ opacity: 0.4, fontSize: "2vh" }}>
                      …และอีก {state.lines.length - 8} รายการ
                    </div>
                  )}
                </div>
              )}
            </div>

            {state.paymentQr && (
              <div style={{
                alignSelf: "center",
                background: "#fff",
                color: "#111",
                borderRadius: "2.4vh",
                padding: "2.4vh 2vw",
                textAlign: "center",
                boxShadow: "0 2vh 6vh rgba(0,0,0,.25)",
              }}>
                <div style={{ fontSize: "2.4vh", fontWeight: 700 }}>สแกนเพื่อชำระเงิน</div>
                <div style={{ fontSize: "4.8vh", fontWeight: 800, margin: ".7vh 0 1.3vh" }}>
                  ฿{baht(state.paymentQr.amount)}
                </div>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR สำหรับชำระเงิน"
                    style={{ display: "block", width: "min(26vw,42vh)", maxWidth: "100%", margin: "0 auto" }}
                  />
                ) : (
                  <div style={{ padding: "8vh 1vw", color: "#777", fontSize: "2vh" }}>กำลังเตรียม QR…</div>
                )}
                {state.paymentQr.accountName && (
                  <div style={{ fontSize: "2vh", fontWeight: 650, marginTop: "1.2vh" }}>{state.paymentQr.accountName}</div>
                )}
                {state.paymentQr.promptpayId && (
                  <div style={{ fontSize: "1.8vh", color: "#666", marginTop: ".4vh" }}>
                    พร้อมเพย์ {state.paymentQr.promptpayId}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid #333", paddingTop: "2vh" }}>
            {state.memberName && (
              <div style={{ fontSize: "2.2vh", opacity: 0.75 }}>สมาชิก {state.memberName}</div>
            )}
            {state.discountTotal > 0 && (
              <div style={{ fontSize: "2.6vh", color: "#7ee787" }}>
                ส่วนลด −฿{baht(state.discountTotal)}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "1vh" }}>
              <span style={{ fontSize: "3vh", opacity: 0.7 }}>{state.itemCount} ชิ้น</span>
              <span style={{ fontSize: "9vh", fontWeight: 700, lineHeight: 1 }}>฿{baht(state.amountDue)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
