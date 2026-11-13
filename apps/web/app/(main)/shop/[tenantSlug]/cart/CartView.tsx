"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCart, writeCart, type StoredCartLine } from "./cartStorage";
import styles from "./cart.module.css";

type Review = {
  lines: Array<{ sku: string; name: string; size: string; qty: number; unitPrice: number; lineAmount: number }>;
  subtotal: number; discount: number; shippingFee: number; amountDue: number;
};

function money(value: number, currency: string, lang: "th" | "en") {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency }).format(value);
}

export default function CartView({ slug, shopName, currency, lang }: {
  slug: string; shopName: string; currency: string; lang: "th" | "en";
}) {
  const [lines, setLines] = useState<StoredCartLine[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = lang === "en" ? {
    title: "Your cart", back: "Continue shopping", empty: "Your cart is empty.", remove: "Remove",
    review: "Review current price and stock", confirm: "Confirm order and continue to checkout",
    subtotal: "Subtotal", discount: "Discount", shipping: "Shipping estimate", due: "Current total",
    shippingNote: "Shipping can change after you enter your delivery address in checkout.",
    expires: "Review expires", changed: "Price or stock changed. Review your cart again.",
    failed: "We could not process this cart. Check the items and try again.",
    limits: "Up to 10 different items per order.",
  } : {
    title: "ตะกร้าสินค้า", back: "เลือกสินค้าต่อ", empty: "ตะกร้ายังว่าง", remove: "นำออก",
    review: "ตรวจราคาและสต็อกล่าสุด", confirm: "ยืนยันออร์เดอร์และไปหน้าชำระเงิน",
    subtotal: "ค่าสินค้า", discount: "ส่วนลด", shipping: "ค่าส่งเบื้องต้น", due: "ยอดรวมขณะนี้",
    shippingNote: "ค่าส่งอาจเปลี่ยนหลังกรอกที่อยู่จัดส่งในหน้าชำระเงิน",
    expires: "ยืนยันได้ถึง", changed: "ราคาหรือสต็อกเปลี่ยน กรุณาตรวจตะกร้าอีกครั้ง",
    failed: "ดำเนินการไม่สำเร็จ กรุณาตรวจสินค้าแล้วลองใหม่",
    limits: "สั่งได้สูงสุด 10 รายการต่างชนิดต่อออร์เดอร์",
  };
  useEffect(() => { setLines(readCart(slug)); }, [slug]);
  const update = (next: StoredCartLine[]) => {
    setLines(next); writeCart(slug, next); setReview(null); setQuoteToken(null); setError("");
  };
  const submit = async (action: "preview" | "confirm") => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/bms/retail-cart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "preview"
          ? { action, tenantSlug: slug, items: lines.map(({ sku, size, qty }) => ({ sku, size, qty })) }
          : { action, quoteToken }),
      });
      const data = await response.json();
      if (data.status === "READY") {
        setReview(data.review); setQuoteToken(data.quoteToken); setExpiresAt(data.expiresAt);
      } else if (data.status === "CREATED" && typeof data.checkoutUrl === "string") {
        writeCart(slug, []);
        window.location.assign(data.checkoutUrl);
      } else {
        setReview(null); setQuoteToken(null);
        setError(data.status === "REVIEW_REQUIRED" ? copy.changed : copy.failed);
      }
    } catch { setError(copy.failed); }
    finally { setBusy(false); }
  };

  return <main className={styles.page}>
    <Link href={`/shop/${encodeURIComponent(slug)}/products`} className={styles.back}>{copy.back}</Link>
    <h1>{copy.title} · {shopName}</h1>
    <p className={styles.muted}>{copy.limits}</p>
    {!lines.length ? <p>{copy.empty}</p> : <>
      <ul className={styles.list}>{lines.map((line) => <li key={`${line.sku}\0${line.size}`} className={styles.line}>
        <div><strong>{line.name}</strong><span>{line.size} · {line.sku}</span></div>
        <div className={styles.controls}>
          <input type="number" min="1" max="100" aria-label={`${line.name} ${line.size}`}
            value={line.qty} onChange={(event) => {
              const qty = Number(event.target.value);
              if (Number.isSafeInteger(qty) && qty >= 1 && qty <= 100)
                update(lines.map((item) => item === line ? { ...item, qty } : item));
            }} />
          <button type="button" onClick={() => update(lines.filter((item) => item !== line))}>{copy.remove}</button>
        </div>
      </li>)}</ul>
      {!review && <button type="button" disabled={busy} className={styles.primary} onClick={() => submit("preview")}>{copy.review}</button>}
      {review && <section className={styles.review} aria-live="polite">
        <h2>{copy.review}</h2>
        {review.lines.map((line) => <div className={styles.amount} key={`${line.sku}\0${line.size}`}>
          <span>{line.name} · {line.size} × {line.qty}</span><strong>{money(line.lineAmount, currency, lang)}</strong>
        </div>)}
        <div className={styles.amount}><span>{copy.subtotal}</span><strong>{money(review.subtotal, currency, lang)}</strong></div>
        {review.discount > 0 && <div className={styles.amount}><span>{copy.discount}</span><strong>-{money(review.discount, currency, lang)}</strong></div>}
        <div className={styles.amount}><span>{copy.shipping}</span><strong>{money(review.shippingFee, currency, lang)}</strong></div>
        <div className={`${styles.amount} ${styles.total}`}><span>{copy.due}</span><strong>{money(review.amountDue, currency, lang)}</strong></div>
        <p className={styles.muted}>{copy.shippingNote}</p>
        <p className={styles.muted}>{copy.expires}: {new Date(expiresAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-US")}</p>
        <button type="button" disabled={busy || !quoteToken} className={styles.primary} onClick={() => submit("confirm")}>{copy.confirm}</button>
      </section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </>}
  </main>;
}
