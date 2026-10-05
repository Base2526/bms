"use client";

import { useEffect, useState } from "react";
import { Alert, Descriptions, Modal, Spin } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { POS_SCAN_QUERY, posGraphqlRequest, type PosScanHit } from "@/lib/pos/mobileFlowGraphql";
import styles from "./DesktopPosRenderer.module.css";

export default function ProductDetailsModal({ token, target, onClose }: {
  token: string; target: { code: string; size?: string; packCode?: string }; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [product, setProduct] = useState<PosScanHit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setProduct(null);
    void posGraphqlRequest<{ bmsPosScan: PosScanHit | null }>(token, POS_SCAN_QUERY, {
      code: target.code, size: target.size, packCode: target.packCode,
    }).then(({ bmsPosScan }) => { if (live) setProduct(bmsPosScan); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("admin_board_game.product_load_failed")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, target.code, target.size, target.packCode, t]);
  return <Modal open wrapClassName={styles.lightTheme} title={t("admin_board_game.product_details")} onCancel={onClose} footer={null} width={520}>
    {loading ? <div style={{ height: 240, display: "grid", placeItems: "center" }}><Spin /></div> : error
      ? <Alert type="error" showIcon closable message={error} /> : !product
        ? <Alert type="info" closable message={t("admin_board_game.product_not_found")} /> : <>
          {product.imageUrl && <img src={product.imageUrl} alt={product.productName} style={{ width: "100%", height: 220, objectFit: "contain" }} />}
          <h3 style={{ overflowWrap: "anywhere" }}>{product.productName}</h3>
          <Descriptions column={1} size="small" styles={{ content: { overflowWrap: "anywhere" } }} items={[
            { key: "sku", label: "SKU", children: product.sku },
            { key: "barcode", label: t("admin_board_game.product_barcode"), children: product.barcode || "-" },
            { key: "size", label: t("admin_board_game.product_size"), children: product.size || "-" },
            { key: "unit", label: t("admin_board_game.product_unit"), children: product.unitName },
            { key: "price", label: t("admin_board_game.product_price"), children: new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB" }).format(product.packPrice) },
            { key: "stock", label: t("admin_board_game.product_stock"), children: product.stockTracked ? product.available : t("admin_board_game.product_non_stock") },
          ]} />
        </>}
  </Modal>;
}
