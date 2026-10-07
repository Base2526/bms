"use client";

import { useState } from "react";
import { ArrowLeftOutlined, CheckCircleOutlined, PictureOutlined, PlusOutlined } from "@ant-design/icons";
import type { PosScanHit, PosVariantSelection } from "@/lib/pos/mobileFlowGraphql";
import styles from "./DesktopPosRenderer.module.css";

export type ScannedProductResult =
  | { kind: "selection"; selection: PosVariantSelection }
  | { kind: "product"; product: PosScanHit; added: boolean };

const money = (value: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(value);

export default function ScannedProductPanel({ result, busy, onSelect, onClose }: {
  result: ScannedProductResult;
  busy: boolean;
  onSelect: (code: string, size: string) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<{ selection: PosVariantSelection; size: string } | null>(null);
  const selection = result.kind === "selection" ? result.selection : null;
  const product = result.kind === "product" ? result.product : null;
  const item = selection ?? product!;
  const size = choice?.selection === selection ? choice?.size ?? "" : "";
  const selected = selection?.variants.find(variant => variant.size === size);
  const canAdd = selected && (!selected.stockTracked || selected.available > 0);
  return <section className={styles.scannedProduct} aria-label="สินค้าที่สแกน">
    <header>
      <h2>{item.productName}</h2>
      <button type="button" onClick={onClose} disabled={busy} title="กลับแคตตาล็อก" aria-label="กลับแคตตาล็อก"><ArrowLeftOutlined /></button>
    </header>
    <div className={styles.scannedImage}>
      {item.imageUrl ? <img src={item.imageUrl} alt={item.productName} /> : <span><PictureOutlined /> ไม่มีรูปสินค้า</span>}
    </div>
    <p className={styles.scannedSku}>{item.sku}</p>
    {selection ? <>
      <fieldset className={styles.scanVariants} disabled={busy}>
        <legend>เลือกไซส์</legend>
        {selection.variants.map(variant => {
          const unavailable = variant.stockTracked && variant.available <= 0;
          return <label key={variant.size} data-disabled={unavailable}>
            <input type="radio" name="scanned-product-size" aria-label={`ไซส์ ${variant.size}`} checked={size === variant.size}
              disabled={unavailable} onChange={() => setChoice({ selection, size: variant.size })} />
            <strong>{variant.size}</strong>
            <span>{money(variant.price)}</span>
            <small>{variant.stockTracked ? unavailable ? "หมด" : `เหลือ ${variant.available}` : "พร้อมขาย"}</small>
          </label>;
        })}
      </fieldset>
      <button type="button" className={styles.primaryButton} disabled={busy || !canAdd}
        onClick={() => { if (canAdd) onSelect(selection.scanCode, selected.size); }}>
        <PlusOutlined /> {busy ? "กำลังเพิ่ม…" : "เพิ่มลงบิล"}
      </button>
    </> : product ? <div className={styles.scannedSummary}>
      <strong>ไซส์ {product.size} · {product.unitName} · {money(product.packPrice)}</strong>
      <span>{product.stockTracked ? `เหลือ ${product.available} หน่วยฐาน` : "พร้อมขาย"}</span>
      {result.kind === "product" && result.added ? <span className={styles.stockOk} role="status"><CheckCircleOutlined /> เพิ่มลงบิลแล้ว</span> : null}
    </div> : null}
  </section>;
}
