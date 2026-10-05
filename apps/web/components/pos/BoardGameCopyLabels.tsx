"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Alert, Button, Checkbox, Modal, Space } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import styles from "./BoardGameCopyLabels.module.css";

export default function BoardGameCopyLabels({ title, onClose }: {
  title: { title: string; copies: Array<{ id: string; copyCode: string }> }; onClose: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>(title.copies.map((c) => c.id));
  const [images, setImages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all(title.copies.map(async (copy) => [copy.id, await QRCode.toDataURL(copy.copyCode, {
      width: 240, margin: 4, errorCorrectionLevel: "M",
    })] as const)).then((rows) => { if (live) setImages(Object.fromEntries(rows)); })
      .catch(() => { if (live) setError(t("admin_board_game.labels_failed")); });
    return () => { live = false; };
  }, [title, t]);
  const copies = title.copies.filter((c) => selected.includes(c.id));
  function print() {
    if (!copies.length || copies.some((c) => !images[c.id])) return;
    const popup = window.open("", "_blank", "width=800,height=700");
    if (!popup) { setError(t("admin_board_game.print_blocked")); return; }
    const doc = popup.document;
    doc.title = title.title;
    const style = doc.createElement("style");
    style.textContent = "@page{margin:8mm}body{margin:0;font-family:system-ui;color:#000;background:#fff}main{display:flex;flex-wrap:wrap;gap:2mm}.label{box-sizing:border-box;width:60mm;min-height:48mm;padding:3mm;text-align:center;break-inside:avoid;border:1px dashed #888}.label img{width:30mm;height:30mm;display:block;margin:auto}.label p{margin:0;font-size:10pt;overflow-wrap:anywhere}";
    doc.head.appendChild(style);
    const main = doc.createElement("main");
    const ready: Promise<void>[] = [];
    for (const copy of copies) {
      const label = doc.createElement("section"); label.className = "label";
      const name = doc.createElement("p"); name.textContent = title.title;
      const image = doc.createElement("img"); image.alt = copy.copyCode;
      ready.push(new Promise((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; }));
      image.src = images[copy.id];
      const code = doc.createElement("p"); code.textContent = copy.copyCode;
      label.append(name, image, code); main.appendChild(label);
    }
    doc.body.replaceChildren(main);
    void Promise.all(ready).then(() => { if (!popup.closed) { popup.focus(); popup.print(); } })
      .catch(() => { setError(t("admin_board_game.labels_failed")); popup.close(); });
  }
  return <Modal open width={680} title={`${t("admin_board_game.copy_labels")} · ${title.title}`} onCancel={onClose}
    footer={<Button type="primary" icon={<PrinterOutlined />} disabled={!copies.length || copies.some((c) => !images[c.id])} onClick={print}>{t("admin_board_game.print_labels")}</Button>}>
    {error && <Alert type="error" closable onClose={() => setError("")} message={error} />}
    <Space wrap>{title.copies.map((copy) => <Checkbox key={copy.id} checked={selected.includes(copy.id)} onChange={(e) =>
      setSelected((ids) => e.target.checked ? [...ids, copy.id] : ids.filter((id) => id !== copy.id))}>{copy.copyCode}</Checkbox>)}</Space>
    <div className={styles.labels}>{copies.map((copy) => <div key={copy.id} className={styles.label}>
      <strong>{title.title}</strong>{images[copy.id] && <img src={images[copy.id]} alt={`QR ${copy.copyCode}`} />}<span>{copy.copyCode}</span>
    </div>)}</div>
  </Modal>;
}
