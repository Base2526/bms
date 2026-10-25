"use client";

import { useEffect, useState } from "react";
import { CheckOutlined, ShopOutlined, UserOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { displayMemberName, displayPhase, displayUrl, type CustomerDisplayPayload } from "@/lib/pos/customerDisplay";
import { createDynamicPromptPayQrPayload } from "@/lib/bms/promptPayQr";
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

function WelcomeBackground({ url }: { url?: string | null }) {
  const safeUrl = displayUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  if (!safeUrl || failed === safeUrl) return null;
  return <div className={styles.welcomeBackground} data-customer-display-background aria-hidden="true">
    <img src={safeUrl} alt="" onError={() => setFailed(safeUrl)} />
    <span />
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

function DynamicPaymentQr({ basePayload, amount }: { basePayload: string; amount: number }) {
  let payload: string | null = null;
  try {
    payload = createDynamicPromptPayQrPayload(basePayload, amount);
  } catch {
    // A malformed or amount-bearing base must fail closed: never fall back to a
    // static QR that would ask the customer to key a different amount.
  }
  return payload
    ? <DisplayQr payload={payload} label="Dynamic PromptPay QR พร้อมยอดชำระ" />
    : <div className={styles.qr}><span>ไม่สามารถสร้าง QR พร้อมยอดได้ กรุณาติดต่อพนักงาน</span></div>;
}

function Member({ state, showGuest = false }: { state: CustomerDisplayPayload; showGuest?: boolean }) {
  const name = displayMemberName(state.memberName);
  if (!name) return showGuest ? <section className={`${styles.member} ${styles.guest}`} data-customer-kind="guest">
    <UserOutlined aria-hidden /><div><strong>ลูกค้าทั่วไป</strong><p>รายการนี้ไม่ได้สะสมแต้ม</p></div>
  </section> : null;
  return <section className={styles.member} data-customer-kind="member">
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
    {phase === "idle" && <WelcomeBackground url={brand?.customerDisplayBackgroundUrl} />}
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
        <DynamicPaymentQr basePayload={state.paymentQr.payload} amount={state.paymentQr.amount} />
        <div><h2>สแกนชำระเงิน</h2><strong className={styles.qrAmount}>฿{baht(state.paymentQr.amount)}</strong>
          {state.paymentQr.accountName && <p>{state.paymentQr.accountName}</p>}
          <p>ยอดเงินถูกใส่ใน QR แล้ว โปรดตรวจสอบชื่อผู้รับและยอดก่อนยืนยัน</p><small>กรุณารอพนักงานยืนยันการชำระเงิน</small></div>
      </section> : <section className={styles.paymentWaiting}><h2>ชำระเงินกับพนักงาน</h2><p>กรุณาตรวจสอบยอดเงิน</p></section>}
    </div>}
    {phase === "finished" && state.finished && <div className={styles.finished}>
      <section className={styles.thanks} data-finished-primary><span className={styles.checkBadge}><CheckOutlined aria-hidden /></span>
        <div className={styles.thanksCopy}><h1>ชำระเงินเรียบร้อย</h1><p>ขอบคุณที่อุดหนุน</p></div>
      </section>
      <section className={`${styles.finishedSummary} ${state.finished.change == null ? styles.finishedSummaryNoChange : ""}`} data-finished-summary>
        <div className={styles.settlement} data-finished-settlement>
          <div className={`${styles.row} ${styles.totalRow}`}><span>ยอดชำระทั้งหมด</span><strong>฿{baht(state.finished.total)}</strong></div>
          {state.finished.tendered != null && <div className={styles.row}><span>รับเงินสด</span><strong>฿{baht(state.finished.tendered)}</strong></div>}
        </div>
        {state.finished.change != null && <><span className={styles.finishedDivider} aria-hidden /><div className={styles.change}><p>เงินทอน</p><strong className={styles.amount}>฿{baht(state.finished.change)}</strong></div></>}
        <span className={styles.finishedDivider} aria-hidden />
        <aside className={styles.finishAside}><Member state={state} showGuest />
          {taxUrl && <section className={styles.tax}><DisplayQr payload={taxUrl} label="QR ขอใบกำกับภาษีเต็มรูป" /><div className={styles.taxCopy}><h2>ขอใบกำกับภาษีเต็มรูป</h2><p>สแกน QR เพื่อกรอกข้อมูล</p></div></section>}
        </aside>
      </section>
    </div>}
    <footer className={styles.footer}><span>{brand?.branch || brand?.name || ""}</span><span>ขอบคุณที่ใช้บริการ</span></footer>
  </main>;
}
