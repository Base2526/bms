'use client';
// จอขายหน้าร้าน
// -------------------------------------------------------------
// กฎที่ยึดตลอดทั้งไฟล์: เครื่องหน้าร้านห้ามคิดเลขเอง
//   • ราคา/สต็อก มาจาก /api/pos/scan เท่านั้น
//   • ยอดที่ส่งไปกับการชำระเงินเป็นยอดที่ "เครื่องเห็น" แต่ฝั่ง server คิดใหม่
//     และปฏิเสธถ้าไม่ตรง (PAYMENT_MISMATCH) — เครื่องไม่ใช่ผู้ตัดสิน
//   • ไม่มีโหมดออฟไลน์ตามที่ตกลงกันไว้: เน็ตหลุด = ขายไม่ได้ ไม่ใช่ขายแล้วค้างคิว
//
// idempotencyKey สร้างที่เครื่อง {device}-{shift}-{seq} — ยิงซ้ำเพราะ response
// หายกลางทางต้องได้บิลเดิม จำเป็นแม้จะไม่ทำโหมดออฟไลน์
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TOKEN_KEY = "bms.pos.deviceToken";
const SEQ_KEY = "bms.pos.seq";

type ScanHit = {
  sku: string;
  productName: string;
  receiptName: string;
  size: string;
  packCode: string;
  unitName: string;
  baseQty: number;
  packPrice: number;
  basePrice: number;
  available: number;
};

type CartLine = ScanHit & { packQty: number; key: string };

type Receipt = {
  docNo: string | null;
  lines: CartLine[];
  total: number;
  tendered: number | null;
  change: number | null;
  at: string;
  cashier: string;
};

type Session = {
  device: { id: string; code: string; name: string | null; registeredPosNo: string | null };
  location: { id: string; name: string; branchCode: string; pharmacistName: string | null } | null;
  shift: { id: string; openedAt: string; openingFloat: number } | null;
  cashiers: Array<{ id: string; name: string | null; email: string | null; isPharmacist: boolean; hasPin: boolean }>;
  vat: { registered: boolean; priceIncludesVat: boolean; rate: number; calendarEra: string };
};

const METHODS = [
  { key: "CASH", label: "เงินสด" },
  { key: "QR", label: "QR" },
  { key: "CARD", label: "บัตร" },
  { key: "WALLET", label: "วอลเล็ท" },
] as const;

function baht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PosPage() {
  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string>("");
  // token ที่เก็บไว้ใช้ไม่ได้แล้ว (เครื่องถูกปิด/ออก token ใหม่/ใส่ผิด)
  const [tokenRejected, setTokenRejected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [cashierId, setCashierId] = useState<string>("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanCode, setScanCode] = useState("");
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<string>("CASH");
  const [tendered, setTendered] = useState<string>("");
  // PIN อยู่ในหน่วยความจำเท่านั้น — ไม่ลง localStorage เพราะเครื่องหน้าร้าน
  // เปิดค้างทั้งวันและใครก็เปิด devtools ดูได้
  const [pin, setPin] = useState<string>("");
  const [openingFloat, setOpeningFloat] = useState<string>("");
  const [countedCash, setCountedCash] = useState<string>("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // จับคู่ผ่านลิงก์ได้: /pos?t=<token>
    // หน้าแอดมินให้ลิงก์เต็มไปเลย เพราะการก๊อป token เปล่า ๆ แล้วเอาไปวางในช่อง URL
    // เป็นสิ่งที่เกิดขึ้นจริง (เจอมาแล้ว) — วางลิงก์ในช่อง URL แล้วต้องทำงานเลย
    const url = new URL(window.location.href);
    const fromUrl = (url.searchParams.get("t") ?? url.searchParams.get("token") ?? "").trim();
    if (fromUrl) {
      window.localStorage.setItem(TOKEN_KEY, fromUrl);
      setToken(fromUrl);
      // ล้าง token ออกจาก URL ทันที — ไม่ให้ค้างใน history/แถบที่อยู่ให้ใครเห็น
      url.searchParams.delete("t");
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search);
      return;
    }
    setToken(window.localStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  const authHeaders = useMemo(() => ({ "x-pos-device-token": token }), [token]);

  const loadSession = useCallback(async () => {
    if (!token) {
      setLoadingSession(false);
      return;
    }
    setLoadingSession(true);
    try {
      const res = await fetch("/api/pos/session", { headers: authHeaders, cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSessionError(body?.error ?? `HTTP ${res.status}`);
        setTokenRejected(res.status === 401);
        setSession(null);
        return;
      }
      const data: Session = await res.json();
      setSession(data);
      setSessionError("");
      setTokenRejected(false);
      setCashierId((cur) => cur || data.cashiers.find((c) => c.hasPin)?.id || "");
    } catch (e: any) {
      // เน็ตหลุด ≠ token ผิด — อย่าไล่ให้ไปจับคู่ใหม่ทั้งที่แค่เน็ตสะดุด
      setSessionError(String(e?.message ?? e));
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, [token, authHeaders]);

  function unpair() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setSession(null);
    setTokenRejected(false);
    setSessionError("");
  }

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const anyCashierHasPin = (session?.cashiers ?? []).some((c) => c.hasPin);
  // ขายได้ก็ต่อเมื่อครบทั้ง 4: เชื่อมต่อได้ / มีคนตั้ง PIN / เลือกคน+ใส่ PIN / เปิดกะแล้ว
  const canSell = Boolean(session?.shift && cashierId && pin && anyCashierHasPin);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.packPrice * l.packQty, 0),
    [cart]
  );
  const itemCount = useMemo(() => cart.reduce((sum, l) => sum + l.packQty, 0), [cart]);
  const change = useMemo(() => {
    if (method !== "CASH") return null;
    const t = Number(tendered);
    if (!Number.isFinite(t) || t <= 0) return null;
    return Math.max(0, Math.round((t - total) * 100) / 100);
  }, [method, tendered, total]);

  async function handleScan(code: string) {
    const trimmed = code.trim();
    if (!trimmed || !token) return;
    setScanCode("");
    try {
      const res = await fetch(`/api/pos/scan?code=${encodeURIComponent(trimmed)}`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data?.error ?? "ยิงไม่สำเร็จ" });
        return;
      }
      const hit: ScanHit = data;
      const key = `${hit.sku}__${hit.size}__${hit.packCode}`;
      setCart((cur) => {
        const found = cur.find((l) => l.key === key);
        if (found) {
          return cur.map((l) => (l.key === key ? { ...l, packQty: l.packQty + 1 } : l));
        }
        return [...cur, { ...hit, packQty: 1, key }];
      });
      setNotice(null);
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      scanRef.current?.focus();
    }
  }

  function changeQty(key: string, delta: number) {
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, packQty: l.packQty + delta } : l))
        .filter((l) => l.packQty > 0)
    );
  }

  function nextIdempotencyKey(deviceCode: string, shiftId: string): string {
    const seq = Number(window.localStorage.getItem(SEQ_KEY) ?? "0") + 1;
    window.localStorage.setItem(SEQ_KEY, String(seq));
    return `${deviceCode}-${shiftId.slice(0, 8)}-${seq}`;
  }

  async function shiftAction(action: "open" | "close") {
    if (!cashierId || !pin || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pos/shift", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action,
          userId: cashierId,
          pin,
          openingFloat: action === "open" ? Number(openingFloat || 0) : undefined,
          countedCash: action === "close" ? Number(countedCash || 0) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data?.error ?? data?.reason ?? `HTTP ${res.status}` });
      } else if (action === "close" && data.status === "CLOSED") {
        const v = data.shift?.cashVariance ?? 0;
        setNotice({
          type: v === 0 ? "ok" : "error",
          text: `ปิดกะแล้ว · ควรมี ฿${baht(data.shift.expectedCash)} นับได้ ฿${baht(data.shift.countedCash)} · ${
            v === 0 ? "ตรงพอดี" : v > 0 ? `เกิน ฿${baht(v)}` : `ขาด ฿${baht(Math.abs(v))}`
          }`,
        });
        setCountedCash("");
      } else {
        setNotice({ type: "ok", text: action === "open" ? "เปิดกะแล้ว" : "ปิดกะแล้ว" });
        setOpeningFloat("");
      }
      await loadSession();
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!session?.shift || cart.length === 0 || !cashierId || !pin || busy) return;
    setBusy(true);
    setNotice(null);
    const idempotencyKey = nextIdempotencyKey(session.device.code, session.shift.id);
    try {
      const res = await fetch("/api/pos/sale", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          shiftId: session.shift.id,
          cashierUserId: cashierId,
          pin,
          idempotencyKey,
          lines: cart.map((l) => ({
            sku: l.sku,
            size: l.size,
            packQty: l.packQty,
            packCode: l.packCode,
            unitName: l.unitName,
            baseQty: l.baseQty,
            packPrice: l.packPrice,
          })),
          payments: [
            {
              method,
              amount: total,
              cashTendered: method === "CASH" && tendered ? Number(tendered) : null,
            },
          ],
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === "SOLD") {
        setReceipt({
          docNo: data.docNo ?? null,
          lines: cart,
          total,
          tendered: data.cashTendered ?? null,
          change: data.cashChange ?? null,
          at: new Date().toLocaleString("th-TH"),
          cashier:
            session.cashiers.find((c) => c.id === cashierId)?.name ??
            session.cashiers.find((c) => c.id === cashierId)?.email ??
            "",
        });
        setNotice({
          type: "ok",
          text: `ขายสำเร็จ${data.docNo ? ` · ใบเสร็จ ${data.docNo}` : ""}${
            data.cashChange != null ? ` · เงินทอน ฿${baht(data.cashChange)}` : ""
          }${data.replayed ? " (บิลเดิม ไม่ได้ขายซ้ำ)" : ""}`,
        });
        setCart([]);
        setTendered("");
      } else {
        setNotice({ type: "error", text: describeFailure(data) });
      }
    } catch (e: any) {
      // เน็ตหลุดกลางคำขอ: บิลอาจสร้างไปแล้ว → ห้ามให้พนักงานกดขายใหม่ทันที
      setNotice({
        type: "error",
        text: `ส่งไม่สำเร็จ (${String(e?.message ?? e)}) — เช็คบิลล่าสุดในระบบก่อนขายซ้ำ`,
      });
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  if (!token || tokenRejected) {
    return (
      <div style={{ maxWidth: 460, margin: "0 auto", padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>จับคู่เครื่องขาย</h1>
        {tokenRejected && (
          <div style={{ background: "#fdecea", color: "#611a15", padding: 12, borderRadius: 8, margin: "12px 0" }}>
            token ที่เครื่องนี้เก็บไว้ใช้ไม่ได้แล้ว — อาจถูกออกใหม่ให้เครื่องอื่น หรือเครื่องถูกปิดใช้งาน
            <br />ไปที่ <b>แอดมิน → ขายหน้าร้าน → เครื่องขาย + PIN</b> แล้วกด &quot;ออก token&quot; ใหม่
          </div>
        )}
        <p style={{ color: "#666", fontSize: 14 }}>
          ใส่ token ที่ออกจากหน้าแอดมิน (ออกให้ครั้งเดียว ถ้าหายต้องออกใหม่)
        </p>
        <input
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="pos_... หรือวางลิงก์จับคู่ทั้งลิงก์"
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 12 }}
        />
        <button
          disabled={!tokenInput.trim()}
          onClick={() => {
            // ก๊อปมาทั้งลิงก์ก็รับ — ดึงเฉพาะค่า token ออกมาให้เอง
            const raw = tokenInput.trim();
            let t = raw;
            const m = raw.match(/[?&](?:t|token)=([^&\s]+)/);
            if (m) t = decodeURIComponent(m[1]);
            else if (raw.includes("/")) t = raw.split("/").pop() ?? raw;
            window.localStorage.setItem(TOKEN_KEY, t);
            setToken(t);
            setTokenRejected(false);
            setSessionError("");
          }}
          style={{ width: "100%", padding: 14, fontSize: 16, marginTop: 12 }}
        >
          จับคู่
        </button>
        <p style={{ color: "#888", fontSize: 12, marginTop: 16 }}>
          เครื่องนี้จะจำ token ไว้จนกว่าจะกดเลิกจับคู่ — ไม่ต้องใส่ใหม่ทุกวัน
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: "100vh" }}>
      <header
        style={{
          background: "#fff", borderRadius: 12, padding: "10px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 500 }}>
            {loadingSession && !session ? "กำลังเชื่อมต่อ…" : session?.location?.name ?? "ยังไม่ทราบสาขา"}
            {session?.location && (
              <span style={{ color: "#888", fontWeight: 400 }}> (สาขา {session.location.branchCode})</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {session ? (
              <>
                {session.device.code}
                {session.device.registeredPosNo ? ` · POS#${session.device.registeredPosNo}` : ""}
                {session.shift ? " · กะเปิดอยู่" : " · ยังไม่เปิดกะ"}
              </>
            ) : (
              "ยังไม่ได้เชื่อมต่อกับระบบ"
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={cashierId}
            onChange={(e) => { setCashierId(e.target.value); setPin(""); }}
            style={{ padding: 8, fontSize: 14, minWidth: 160 }}
          >
            <option value="">เลือกผู้ขาย</option>
            {(session?.cashiers ?? []).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.hasPin}>
                {c.name || c.email}
                {c.isPharmacist ? " (ภก.)" : ""}
                {c.hasPin ? "" : " — ยังไม่ตั้ง PIN"}
              </option>
            ))}
          </select>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            style={{ padding: 8, fontSize: 14, width: 90 }}
          />
          <button onClick={unpair} title="เลิกจับคู่เครื่องนี้" style={{ padding: "8px 10px", fontSize: 12 }}>
            เลิกจับคู่
          </button>
        </div>
      </header>

      {sessionError && !tokenRejected && (
        <div style={{ background: "#fdecea", color: "#611a15", padding: 12, borderRadius: 8 }}>
          เชื่อมต่อไม่ได้: {sessionError} — ตรวจอินเทอร์เน็ตแล้วลอง{" "}
          <button onClick={() => void loadSession()} style={{ padding: "2px 10px" }}>เชื่อมต่อใหม่</button>
        </div>
      )}

      {/* บอกให้ชัดว่าขาดอะไรถึงยังขายไม่ได้ — เดิมจอเงียบ คนหน้าร้านเดาเองไม่ถูก */}
      {session && !canSell && (
        <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>ยังขายไม่ได้ — เหลืออีก:</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
            {!anyCashierHasPin && (
              <li>
                ยังไม่มีพนักงานคนไหนตั้ง PIN — ตั้งที่{" "}
                <a href="/admin/pos-devices">แอดมิน → เครื่องขาย + PIN</a>
              </li>
            )}
            {anyCashierHasPin && !cashierId && <li>เลือกผู้ขายมุมขวาบน</li>}
            {anyCashierHasPin && cashierId && !pin && <li>ใส่ PIN ของผู้ขาย</li>}
            {!session.shift && <li>เปิดกะ พร้อมระบุเงินตั้งต้นในลิ้นชัก</li>}
          </ol>
        </div>
      )}
      {session && !session.shift && (
        <div style={{ background: "#fff4e5", color: "#663c00", padding: 12, borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>ยังไม่ได้เปิดกะ</span>
          <input
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            inputMode="decimal"
            placeholder="เงินตั้งต้นในลิ้นชัก"
            style={{ padding: 8, fontSize: 14, width: 180 }}
          />
          <button disabled={busy || !cashierId || !pin} onClick={() => void shiftAction("open")} style={{ padding: "8px 16px" }}>
            เปิดกะ
          </button>
        </div>
      )}
      {session?.shift && cart.length === 0 && (
        <div style={{ background: "#fff", padding: 10, borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ color: "#666" }}>ปิดกะ:</span>
          <input
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            inputMode="decimal"
            placeholder="เงินที่นับได้"
            style={{ padding: 8, fontSize: 14, width: 160 }}
          />
          <button disabled={busy || !cashierId || !pin || !countedCash} onClick={() => void shiftAction("close")} style={{ padding: "8px 16px" }}>
            ปิดกะ + นับเงิน
          </button>
        </div>
      )}
      {notice && (
        <div
          style={{
            background: notice.type === "ok" ? "#edf7ed" : "#fdecea",
            color: notice.type === "ok" ? "#1e4620" : "#611a15",
            padding: 12, borderRadius: 8,
          }}
        >
          {notice.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 10, flex: 1 }}>
        <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
          <input
            ref={scanRef}
            autoFocus
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => {
              // เครื่องสแกนเป็นคีย์บอร์ด: ยิงเสร็จมันเคาะ Enter ให้เอง
              if (e.key === "Enter") void handleScan(scanCode);
            }}
            placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัสแล้วกด Enter"
            style={{ width: "100%", padding: 14, fontSize: 16 }}
          />
          <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
            {cart.length === 0 ? "ยังไม่มีรายการ" : `${cart.length} รายการในตะกร้า`}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {cart.map((l) => (
              <div
                key={l.key}
                style={{
                  border: "1px solid #eee", borderRadius: 8, padding: "8px 10px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.receiptName}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {l.packQty} {l.unitName} × ฿{baht(l.packPrice)} · คงเหลือ {l.available}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => changeQty(l.key, -1)} style={{ padding: "6px 12px", fontSize: 16 }}>−</button>
                  <button onClick={() => changeQty(l.key, 1)} style={{ padding: "6px 12px", fontSize: 16 }}>+</button>
                  <div style={{ minWidth: 84, textAlign: "right", fontWeight: 500 }}>
                    ฿{baht(l.packPrice * l.packQty)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, color: "#666" }}>{itemCount} ชิ้น</span>
            <span style={{ fontSize: 28, fontWeight: 500 }}>฿{baht(total)}</span>
          </div>
          {session?.vat.registered && (
            <div style={{ fontSize: 12, color: "#666", textAlign: "right" }}>
              ราคารวม VAT {session.vat.rate}% แล้ว
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 12 }}>
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                style={{
                  padding: "12px 0", fontSize: 14,
                  background: method === m.key ? "#1677ff" : "#fff",
                  color: method === m.key ? "#fff" : "#000",
                  border: "1px solid #d9d9d9", borderRadius: 8,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === "CASH" && (
            <div style={{ marginTop: 10 }}>
              <input
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                inputMode="decimal"
                placeholder="รับเงินมา"
                style={{ width: "100%", padding: 12, fontSize: 16 }}
              />
              {change != null && (
                <div style={{ marginTop: 6, fontSize: 15 }}>
                  เงินทอน <strong>฿{baht(change)}</strong>
                </div>
              )}
            </div>
          )}

          <div style={{ flex: 1 }} />
          <button
            disabled={busy || cart.length === 0 || !canSell}
            onClick={() => void pay()}
            style={{
              marginTop: 12, padding: "16px 0", fontSize: 18, borderRadius: 8,
              border: "none", color: "#fff",
              background: busy || cart.length === 0 || !canSell ? "#bbb" : "#237804",
            }}
          >
            {busy ? "กำลังบันทึก…" : `ชำระเงิน ฿${baht(total)}`}
          </button>
          <button
            onClick={() => { setCart([]); setTendered(""); setNotice(null); scanRef.current?.focus(); }}
            style={{ marginTop: 6, padding: "10px 0", fontSize: 14 }}
          >
            ล้างบิล
          </button>
        </section>
      </div>
      {receipt && (
        <>
          {/* ใบเสร็จ: พิมพ์ผ่าน print dialog ของเบราว์เซอร์ก่อน — ใช้ได้กับเครื่องพิมพ์
              ที่ลง driver ไว้แล้วโดยไม่ต้องเขียน ESC/POS · ESC/POS ผ่าน WebUSB
              (พร้อมคำสั่งเปิดลิ้นชัก) ค่อยทำเมื่อได้เครื่องจริงมาทดสอบ */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #pos-receipt, #pos-receipt * { visibility: visible; }
              #pos-receipt { position: absolute; left: 0; top: 0; width: 72mm; }
            }
          `}</style>
          <div
            id="pos-receipt"
            style={{
              background: "#fff", borderRadius: 12, padding: 16, maxWidth: 320,
              fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.55,
            }}
          >
            <div style={{ textAlign: "center" }}>{session?.location?.name}</div>
            <div style={{ textAlign: "center" }}>
              (สาขา {session?.location?.branchCode})
            </div>
            {session?.vat.registered && (
              <div style={{ textAlign: "center" }}>(VAT Included)</div>
            )}
            <div style={{ textAlign: "center" }}>
              POS#{session?.device.registeredPosNo ?? session?.device.code}
            </div>
            <div style={{ textAlign: "center", margin: "6px 0" }}>
              {session?.vat.registered ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน"}
            </div>
            <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
            {receipt.lines.map((l) => (
              <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.packQty} {l.receiptName}
                </span>
                <span>{baht(l.packPrice * l.packQty)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>ยอดสุทธิ {receipt.lines.reduce((n, l) => n + l.packQty, 0)} ชิ้น</span>
              <span>{baht(receipt.total)}</span>
            </div>
            {receipt.tendered != null && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>เงินสด/เงินทอน</span>
                <span>{baht(receipt.tendered)} / {baht(receipt.change ?? 0)}</span>
              </div>
            )}
            <div style={{ marginTop: 6 }}>{receipt.docNo ?? "(ไม่มีเลขใบกำกับ)"} · {receipt.at}</div>
            <div>แคชเชียร์ {receipt.cashier}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ padding: "10px 20px" }}>พิมพ์ใบเสร็จ</button>
            <button onClick={() => setReceipt(null)} style={{ padding: "10px 20px" }}>ปิด</button>
          </div>
        </>
      )}
    </div>
  );
}

/** แปลสถานะที่ server ปฏิเสธให้เป็นภาษาที่แคชเชียร์ทำอะไรต่อได้ */
function describeFailure(data: any): string {
  switch (data?.status) {
    case "SHIFT_NOT_OPEN":
      return "กะปิดไปแล้ว — เปิดกะใหม่ก่อน";
    case "PAYMENT_MISMATCH":
      return `ยอดไม่ตรง: ระบบคิด ฿${baht(data.expected)} แต่รับมา ฿${baht(data.received)} — ยิงรายการใหม่`;
    case "LOT_EXPIRED_OR_SHORT":
      return `${data.sku}: ของที่ยังไม่หมดอายุเหลือ ${data.sellable} ต้องการ ${data.requested} — หยิบกล่องใหม่`;
    case "INSUFFICIENT":
      return `${data.sku} เหลือ ${data.available} ต้องการ ${data.requested}`;
    case "NOT_FOUND":
      return `ไม่พบสินค้า ${data.sku ?? ""}`;
    case "PHARMACY_POLICY_UNKNOWN":
      return `${data.sku}: เภสัชกรยังไม่ได้อนุมัตินโยบายการขายของสินค้านี้`;
    case "PHARMACY_PRESCRIPTION_REQUIRED":
      return `${data.sku}: ต้องมีใบสั่งแพทย์ — ขายผ่านระบบไม่ได้`;
    case "PHARMACY_ONLINE_SALE_PROHIBITED":
      return `${data.sku}: สินค้านี้ถูกตั้งเป็นห้ามขายผ่านช่องทางนี้`;
    case "PHARMACY_REVIEW_REQUIRED":
    case "PHARMACY_SAFETY_CHECK_REQUIRED":
      return `${data.sku}: ต้องให้เภสัชกรซักประวัติและอนุมัติก่อน`;
    case "PHARMACY_QUANTITY_LIMIT_EXCEEDED":
      return `${data.sku}: เกินจำนวนสูงสุดต่อครั้ง (${data.maxQuantity})`;
    case "COUPON_INVALID":
      return `คูปองใช้ไม่ได้: ${data.reason}`;
    case "PAYMENT_FAILED":
      return `บันทึกการชำระเงินไม่สำเร็จ: ${data.reason}`;
    default:
      return data?.error ?? `ขายไม่สำเร็จ (${data?.status ?? "ไม่ทราบสาเหตุ"})`;
  }
}
