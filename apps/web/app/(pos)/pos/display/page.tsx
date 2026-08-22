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

type DisplayLine = { name: string; size: string | null; qty: number; unitName: string; amount: number };
type DisplayState = {
  lines: DisplayLine[];
  itemCount: number;
  total: number;
  discountTotal: number;
  amountDue: number;
  memberName: string | null;
  pointsEarned: number | null;
  /** ยอดที่รับมาและเงินทอนของบิลที่ปิดไปแล้ว — ค้างบนจอให้ลูกค้านับเงินทอนตาม */
  finished: { total: number; tendered: number | null; change: number | null } | null;
};

const EMPTY: DisplayState = {
  lines: [], itemCount: 0, total: 0, discountTotal: 0, amountDue: 0,
  memberName: null, pointsEarned: null, finished: null,
};

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState>(EMPTY);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("bms-pos-display");
    ch.onmessage = (event) => {
      const data = event.data as DisplayState | { type: "ping" } | null;
      if (!data) return;
      if ((data as any).type === "ping") { setLinked(true); return; }
      setLinked(true);
      setState({ ...EMPTY, ...(data as DisplayState) });
    };
    // บอกจอขายว่ามีจอลูกค้าเปิดอยู่ เพื่อให้มันเริ่มส่งสถานะทันทีไม่ต้องรอยิงของชิ้นถัดไป
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, []);

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
          <div style={{ flex: 1, overflow: "hidden" }}>
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
