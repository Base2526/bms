"use client";

import { usePosText } from "@/lib/pos/usePosText";

import { useEffect, useState } from "react";
import { CheckOutlined, ShopOutlined, UserOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { displayMemberKind, displayMemberName, displayPhase, displayUrl, type CustomerDisplayPayload } from "@/lib/pos/customerDisplay";
import { createDynamicPromptPayQrPayload } from "@/lib/bms/promptPayQr";
import styles from "./CustomerDisplayView.module.css";

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Logo({ url, large = false }: { url?: string | null; large?: boolean }) {
  const posText = usePosText();
  const safeUrl = displayUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  return <div className={large ? styles.largeLogo : styles.logo}>
    {safeUrl && failed !== safeUrl
      ? <img src={safeUrl} alt={posText("โลโก้ร้าน")} onError={() => setFailed(safeUrl)} />
      : <ShopOutlined aria-hidden />}
  </div>;
}

function WelcomeBackground({
  url,
  promos = [],
  intervalSeconds = 8,
}: {
  url?: string | null;
  promos?: string[];
  intervalSeconds?: number;
}) {

  const fallback = displayUrl(url);
  const safePromos = Array.from(new Set(promos.map(displayUrl).filter((value): value is string => Boolean(value)))).slice(0, 8);
  const [failed, setFailed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const activePromos = safePromos.filter((value) => !failed.includes(value));
  const safeUrl = activePromos.length > 0 ? activePromos[index % activePromos.length] : fallback;

  useEffect(() => {
    setIndex(0);
    setFailed([]);
  }, [promos.join("\n"), url]);

  useEffect(() => {
    if (activePromos.length < 2) return;
    const next = activePromos[(index + 1) % activePromos.length];
    const preload = new window.Image();
    preload.src = next;
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % activePromos.length),
      Math.min(30, Math.max(4, Math.trunc(intervalSeconds))) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [activePromos.join("\n"), index, intervalSeconds]);

  if (!safeUrl || failed.includes(safeUrl)) return null;
  return <div className={styles.welcomeBackground} data-customer-display-background aria-hidden="true">
    <img key={safeUrl} src={safeUrl} alt="" onError={() => setFailed((values) => values.includes(safeUrl) ? values : [...values, safeUrl])} />
    <span />
    {activePromos.length > 1 && <div className={styles.promoDots}>
      {activePromos.map((value, dot) => <i key={value} data-active={dot === index % activePromos.length} />)}
    </div>}
  </div>;
}

function DisplayQr({ payload, label }: { payload: string; label: string }) {
  const posText = usePosText();
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
      : <span>{current ? posText("กรุณาติดต่อพนักงาน") : posText("กำลังเตรียม QR")}</span>}
  </div>;
}

function DynamicPaymentQr({ basePayload, amount }: { basePayload: string; amount: number }) {
  const posText = usePosText();
  let payload: string | null = null;
  try {
    payload = createDynamicPromptPayQrPayload(basePayload, amount);
  } catch {
    // A malformed or amount-bearing base must fail closed: never fall back to a
    // static QR that would ask the customer to key a different amount.
  }
  return payload
    ? <DisplayQr payload={payload} label={posText("Dynamic PromptPay QR พร้อมยอดชำระ")} />
    : <div className={styles.qr}><span>{posText("ไม่สามารถสร้าง QR พร้อมยอดได้ กรุณาติดต่อพนักงาน")}</span></div>;
}

function Member({ state, showGuest = false }: { state: CustomerDisplayPayload; showGuest?: boolean }) {
  const posText = usePosText();
  const name = displayMemberName(state.memberName);
  const kind = displayMemberKind(state);
  if (kind === "unknown") return null;
  if (kind === "guest") return showGuest ? <section className={`${styles.member} ${styles.guest}`} data-customer-kind="guest">
    <UserOutlined aria-hidden /><div><strong>{posText("ลูกค้าทั่วไป")}</strong><p>{posText("รายการนี้ไม่ได้สะสมแต้ม")}</p></div>
  </section> : null;
  return <section className={styles.member} data-customer-kind="member">
    <UserOutlined aria-hidden /><div><strong>{name ? posText("สมาชิก {v0}", { v0: name }) : posText("สมาชิก")}</strong>
      {state.pointsBalance != null && <p>{posText("แต้มคงเหลือ") + " "}{state.pointsBalance.toLocaleString("th-TH")}</p>}
      {!state.finished && !state.pendingApproval && !state.pendingPricing && state.pointsWillEarn != null && <p className={styles.points}>{posText("แต้มที่คาดว่าจะได้รับ") + " "}{state.pointsWillEarn}</p>}
      {state.finished && state.pointsEarned != null && <p className={styles.points}>{posText("ได้รับ") + " "}{state.pointsEarned} {" " + posText("แต้ม")}</p>}
    </div>
  </section>;
}

export function CustomerDisplayView({ state, linked }: { state: CustomerDisplayPayload; linked: boolean }) {
  const posText = usePosText();
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
  const name = brand?.name || posText("ยินดีต้อนรับ");
  const labels = { idle: posText("ยินดีต้อนรับ"), cart: posText("รายการของคุณ"), payment: posText("ชำระเงิน"), finished: posText("ชำระเงินเรียบร้อย") };
  return <main className={styles.screen} data-phase={phase}>
    {phase === "idle" && <WelcomeBackground
      url={brand?.customerDisplayBackgroundUrl}
      promos={brand?.customerDisplayPromoSlides}
      intervalSeconds={brand?.customerDisplayPromoIntervalSeconds}
    />}
    <header className={styles.header}>
      <div className={styles.brand}><Logo url={brand?.logoUrl} /><div><strong>{name}</strong>
        {brand?.branch && brand.branch !== name && <p>{brand.branch}</p>}</div></div>
      <span className={styles.status}>{linked ? labels[phase] : posText("กรุณารอสักครู่")}</span>
    </header>
    {phase === "idle" && <div className={styles.idle}>
      <section className={styles.welcome}><Logo url={brand?.logoUrl} large />
        <p className={styles.eyebrow}>{posText("ยินดีต้อนรับ")}</p><h1>{brand?.name || posText("พร้อมให้บริการ")}</h1>
        {brand?.branch && brand.branch !== name && <p>{brand.branch}</p>}
      </section>
      {(brand?.businessHours || website) && <aside className={styles.info}>
        {brand?.businessHours && <section><h2>{posText("เวลาเปิดทำการ")}</h2><p>{brand.businessHours}</p></section>}
        {website && <section><h2>{posText("ช่องทางของร้าน")}</h2><DisplayQr payload={website} label={posText("QR ช่องทางของร้าน")} /></section>}
      </aside>}
    </div>}
    {phase === "cart" && <div className={styles.cart}>
      <section className={styles.items}><div className={styles.sectionHeading}><h1>{posText("รายการของคุณ")}</h1><span>{state.itemCount} {" " + posText("ชิ้น")}</span></div>
        <div className={styles.lines}>{state.lines.slice(-visibleLimit).map((line, i, lines) => <div key={i} className={`${styles.line} ${i === lines.length - 1 ? styles.latest : ""}`}>
          <span className={styles.quantity}>{line.qty}×</span><div className={styles.itemName}><span>{line.name}</span>
            {(line.size || line.unitName) && <small>{[line.size, line.unitName].filter(Boolean).join(" · ")}</small>}</div>
          <strong>{baht(line.amount)}</strong>
        </div>)}</div>
        {state.lines.length > visibleLimit && <p className={styles.muted}>{posText("และอีก") + " "}{state.lines.length - visibleLimit} {" " + posText("รายการก่อนหน้า")}</p>}
      </section>
      <aside className={styles.summary}><Member state={state} /><div className={styles.totals}>
        {state.pendingApproval || state.pendingPricing ? <p>{posText("กรุณารอพนักงานยืนยันยอดชำระ")}</p> : <>
        <div className={styles.row}><span>{posText("ยอดสินค้า")}</span><span>฿{baht(state.total)}</span></div>
        {state.discountTotal > 0 && <div className={`${styles.row} ${styles.savings}`}><span>{posText("ส่วนลด")}</span><span>−฿{baht(state.discountTotal)}</span></div>}
        <p>{posText("ยอดชำระ")}</p><strong className={styles.amount}>฿{baht(state.amountDue)}</strong>
        </>}
      </div></aside>
    </div>}
    {phase === "payment" && <div className={styles.payment}>
      <section className={styles.paymentTotal}><p className={styles.eyebrow}>{posText("ยอดชำระทั้งหมด")}</p>
        <h1 className={styles.amount}>฿{baht(state.amountDue)}</h1><p>{state.itemCount} {" " + posText("ชิ้น")}</p>
        {state.discountTotal > 0 && <p className={styles.savings}>{posText("ส่วนลด ฿")}{baht(state.discountTotal)}</p>}
        <Member state={state} />
      </section>
      {state.paymentQr ? <section className={styles.paymentQr}>
        <DynamicPaymentQr basePayload={state.paymentQr.payload} amount={state.paymentQr.amount} />
        <div><h2>{posText("สแกนชำระเงิน")}</h2><strong className={styles.qrAmount}>฿{baht(state.paymentQr.amount)}</strong>
          {state.paymentQr.accountName && <p>{state.paymentQr.accountName}</p>}
          <p>{posText("ยอดเงินถูกใส่ใน QR แล้ว โปรดตรวจสอบชื่อผู้รับและยอดก่อนยืนยัน")}</p><small>{posText("กรุณารอพนักงานยืนยันการชำระเงิน")}</small></div>
      </section> : <section className={styles.paymentWaiting}><h2>{posText("ชำระเงินกับพนักงาน")}</h2><p>{posText("กรุณาตรวจสอบยอดเงิน")}</p></section>}
    </div>}
    {phase === "finished" && state.finished && <div className={styles.finished}>
      <section className={styles.thanks} data-finished-primary><span className={styles.checkBadge}><CheckOutlined aria-hidden /></span>
        <div className={styles.thanksCopy}><h1>{posText("ชำระเงินเรียบร้อย")}</h1><p>{posText("ขอบคุณที่อุดหนุน")}</p></div>
      </section>
      <section className={`${styles.finishedSummary} ${state.finished.change == null ? styles.finishedSummaryNoChange : ""} ${state.finished.pickupQueueLabel ? styles.finishedSummaryQueue : ""}`} data-finished-summary>
        <div className={styles.settlement} data-finished-settlement>
          <div className={`${styles.row} ${styles.totalRow}`}><span>{posText("ยอดชำระทั้งหมด")}</span><strong>฿{baht(state.finished.total)}</strong></div>
          {state.finished.tendered != null && <div className={styles.row}><span>{posText("รับเงินสด")}</span><strong>฿{baht(state.finished.tendered)}</strong></div>}
        </div>
        {state.finished.pickupQueueLabel && <><span className={styles.finishedDivider} aria-hidden />
          <div className={styles.pickupQueue}><p>{posText("เลขคิวรับของ")}</p><strong>{state.finished.pickupQueueLabel}</strong>
            <small>{posText("กรุณารอเรียกที่เคาน์เตอร์")}</small></div></>}
        {state.finished.change != null && <><span className={styles.finishedDivider} aria-hidden /><div className={styles.change}><p>{posText("เงินทอน")}</p><strong className={styles.amount}>฿{baht(state.finished.change)}</strong></div></>}
        <span className={styles.finishedDivider} aria-hidden />
        <aside className={styles.finishAside}><Member state={state} showGuest />
          {taxUrl && <section className={styles.tax}><DisplayQr payload={taxUrl} label={posText("QR ขอใบกำกับภาษีเต็มรูป")} /><div className={styles.taxCopy}><h2>{posText("ขอใบกำกับภาษีเต็มรูป")}</h2><p>{posText("สแกน QR เพื่อกรอกข้อมูล")}</p></div></section>}
        </aside>
      </section>
    </div>}
    <footer className={styles.footer}><span>{brand?.branch || brand?.name || ""}</span><span>{posText("ขอบคุณที่ใช้บริการ")}</span></footer>
  </main>;
}
