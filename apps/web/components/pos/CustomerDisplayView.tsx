"use client";

import { useEffect, useState } from "react";
import { CheckCircleOutlined, ShopOutlined, UserOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { displayMemberName, displayPhase, displayUrl, type CustomerDisplayPayload } from "@/lib/pos/customerDisplay";
import styles from "./CustomerDisplayView.module.css";

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Logo({ url, large = false }: { url?: string | null; large?: boolean }) {
  const safeUrl = displayUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  return <div className={large ? styles.largeLogo : styles.logo}>
    {safeUrl && failed !== safeUrl
      ? <img src={safeUrl} alt="โลโก้ร้าน" onError={() => setFailed(safeUrl)} />
      : <ShopOutlined aria-hidden />}
  </div>;
}

function DisplayQr({ payload, label }: { payload: string; label: string }) {
  const [result, setResult] = useState<{ payload: string; url: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 4, width: 520 })
      .then(url => { if (active) setResult({ payload, url }); })
      .catch(() => { if (active) setResult({ payload, url: null }); });
    return () => { active = false; };
  }, [payload]);
  const current = result?.payload === payload ? result : null;
  return <div className={styles.qr}>
    {current?.url ? <img src={current.url} alt={label} />
      : <span>{current ? "กรุณาติดต่อพนักงาน" : "กำลังเตรียม QR"}</span>}
  </div>;
}

function Member({ state }: { state: CustomerDisplayPayload }) {
  const name = displayMemberName(state.memberName);
  if (!name) return null;
  return <section className={styles.member}>
    <UserOutlined aria-hidden /><div><strong>สมาชิก {name}</strong>
      {state.pointsBalance != null && <p>แต้มคงเหลือ {state.pointsBalance.toLocaleString("th-TH")}</p>}
      {!state.finished && !state.pendingApproval && !state.pendingPricing && state.pointsWillEarn != null && <p className={styles.points}>แต้มที่คาดว่าจะได้รับ {state.pointsWillEarn}</p>}
      {state.finished && state.pointsEarned != null && <p className={styles.points}>ได้รับ {state.pointsEarned} แต้ม</p>}
    </div>
  </section>;
}

export function CustomerDisplayView({ state, linked }: { state: CustomerDisplayPayload; linked: boolean }) {
  const [visibleLimit, setVisibleLimit] = useState(8);
  useEffect(() => {
    const resize = () => setVisibleLimit(window.innerHeight >= 1000 ? 8 : window.innerHeight >= 850 ? 6 : window.innerHeight >= 700 ? 5 : 3);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const phase = displayPhase(state);
  const brand = state.brand;
  const taxUrl = displayUrl(state.finished?.taxRequestUrl);
  const website = displayUrl(brand?.website);
  const name = brand?.name || "ยินดีต้อนรับ";
  const labels = { idle: "ยินดีต้อนรับ", cart: "รายการของคุณ", payment: "ชำระเงิน", finished: "ชำระเงินเรียบร้อย" };
  return <main className={styles.screen} data-phase={phase}>
    <header className={styles.header}>
      <div className={styles.brand}><Logo url={brand?.logoUrl} /><div><strong>{name}</strong>
        {brand?.branch && brand.branch !== name && <p>{brand.branch}</p>}</div></div>
      <span className={styles.status}>{linked ? labels[phase] : "กรุณารอสักครู่"}</span>
    </header>
    {phase === "idle" && <div className={styles.idle}>
      <section className={styles.welcome}><Logo url={brand?.logoUrl} large />
        <p className={styles.eyebrow}>ยินดีต้อนรับ</p><h1>{brand?.name || "พร้อมให้บริการ"}</h1>
        {brand?.branch && brand.branch !== name && <p>{brand.branch}</p>}
      </section>
      {(brand?.businessHours || website) && <aside className={styles.info}>
        {brand?.businessHours && <section><h2>เวลาเปิดทำการ</h2><p>{brand.businessHours}</p></section>}
        {website && <section><h2>ช่องทางของร้าน</h2><DisplayQr payload={website} label="QR ช่องทางของร้าน" /></section>}
      </aside>}
    </div>}
    {phase === "cart" && <div className={styles.cart}>
      <section className={styles.items}><div className={styles.sectionHeading}><h1>รายการของคุณ</h1><span>{state.itemCount} ชิ้น</span></div>
        <div className={styles.lines}>{state.lines.slice(-visibleLimit).map((line, i, lines) => <div key={i} className={`${styles.line} ${i === lines.length - 1 ? styles.latest : ""}`}>
          <span className={styles.quantity}>{line.qty}×</span><div className={styles.itemName}><span>{line.name}</span>
            {(line.size || line.unitName) && <small>{[line.size, line.unitName].filter(Boolean).join(" · ")}</small>}</div>
          <strong>{baht(line.amount)}</strong>
        </div>)}</div>
        {state.lines.length > visibleLimit && <p className={styles.muted}>และอีก {state.lines.length - visibleLimit} รายการก่อนหน้า</p>}
      </section>
      <aside className={styles.summary}><Member state={state} /><div className={styles.totals}>
        {state.pendingApproval || state.pendingPricing ? <p>กรุณารอพนักงานยืนยันยอดชำระ</p> : <>
        <div className={styles.row}><span>ยอดสินค้า</span><span>฿{baht(state.total)}</span></div>
        {state.discountTotal > 0 && <div className={`${styles.row} ${styles.savings}`}><span>ส่วนลด</span><span>−฿{baht(state.discountTotal)}</span></div>}
        <p>ยอดชำระ</p><strong className={styles.amount}>฿{baht(state.amountDue)}</strong>
        </>}
      </div></aside>
    </div>}
    {phase === "payment" && <div className={styles.payment}>
      <section className={styles.paymentTotal}><p className={styles.eyebrow}>ยอดชำระทั้งหมด</p>
        <h1 className={styles.amount}>฿{baht(state.amountDue)}</h1><p>{state.itemCount} ชิ้น</p>
        {state.discountTotal > 0 && <p className={styles.savings}>ส่วนลด ฿{baht(state.discountTotal)}</p>}
        <Member state={state} />
      </section>
      {state.paymentQr ? <section className={styles.paymentQr}>
        <DisplayQr payload={state.paymentQr.payload} label="QR ชำระเงิน" />
        <div><h2>สแกนชำระเงิน</h2><strong className={styles.qrAmount}>฿{baht(state.paymentQr.amount)}</strong>
          {state.paymentQr.accountName && <p>{state.paymentQr.accountName}</p>}
          <p>ตรวจสอบชื่อผู้รับและยอดเงินก่อนยืนยัน</p><small>กรุณารอพนักงานยืนยันการชำระเงิน</small></div>
      </section> : <section className={styles.paymentWaiting}><h2>ชำระเงินกับพนักงาน</h2><p>กรุณาตรวจสอบยอดเงิน</p></section>}
    </div>}
    {phase === "finished" && state.finished && <div className={styles.finished}>
      <section className={styles.thanks}><CheckCircleOutlined className={styles.check} aria-hidden />
        <h1>ขอบคุณที่อุดหนุน</h1><p>ชำระเงินเรียบร้อย</p>
        <div className={styles.settlement}>
          <div className={styles.row}><span>ยอดชำระ</span><strong>฿{baht(state.finished.total)}</strong></div>
          {state.finished.tendered != null && <div className={styles.row}><span>รับเงินสด</span><strong>฿{baht(state.finished.tendered)}</strong></div>}
        </div>
        {state.finished.change != null && <div className={styles.change}><p>เงินทอน</p><strong className={styles.amount}>฿{baht(state.finished.change)}</strong></div>}
      </section>
      {(state.memberName || taxUrl) && <aside className={styles.finishAside}><Member state={state} />
        {taxUrl && <section className={styles.tax}><DisplayQr payload={taxUrl} label="QR ขอใบกำกับภาษีเต็มรูป" /><h2>ขอใบกำกับภาษีเต็มรูป</h2></section>}
      </aside>}
    </div>}
    <footer className={styles.footer}><span>{brand?.branch || brand?.name || ""}</span><span>ขอบคุณที่ใช้บริการ</span></footer>
  </main>;
}
