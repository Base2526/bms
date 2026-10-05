"use client";

import { GiftOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { isFixedPricePack, type Promotion } from "@pos-core/cartPricing";
import styles from "./GiftPromotionSummary.module.css";

type Line = { sku: string; size: string; qty: number; baseQty?: number; packCode?: string | null; modifierCodes?: string[]; promotion?: Promotion | null };

export default function GiftPromotionSummary({ lines, disabled, onAdd }: {
  lines: Line[]; disabled?: boolean; onAdd?: (sku: string, size: string) => void;
}) {
  const { t } = useI18n();
  const rules = [...new Map(lines.flatMap((l) => l.promotion?.kind === "BUY_A_GET_B" ? [[l.promotion.id, l.promotion] as const] : [])).values()];
  if (!rules.length) return null;
  const qty = (sku: string, size: string) => lines.reduce((n, l) => n +
    (l.sku === sku && l.size === size && !isFixedPricePack(l.packCode) && !l.modifierCodes?.length ? l.qty * (l.baseQty ?? 1) : 0), 0);
  return <section className={styles.root} aria-label={t("pos_gifts.title")}>
    {rules.map((rule) => {
      const allowed = Math.floor(qty(rule.buySku, rule.buySize) / rule.buyQty) * rule.getQty;
      const present = qty(rule.giftSku, rule.giftSize);
      return <div key={rule.id} className={styles.row}>
        <GiftOutlined aria-hidden="true" />
        <div><strong>{rule.giftSku} · {rule.giftSize}</strong>
          <span>{allowed > 0 ? t("pos_gifts.quantity").replace("{qty}", String(Math.min(allowed, present))).replace("{allowed}", String(allowed)) : t("pos_gifts.not_qualified")}</span>
        </div>
        {onAdd && allowed > present && <button type="button" disabled={disabled} onClick={() => onAdd(rule.giftSku, rule.giftSize)}>
          <GiftOutlined aria-hidden="true" /> {t("pos_gifts.add")}
        </button>}
      </div>;
    })}
  </section>;
}
