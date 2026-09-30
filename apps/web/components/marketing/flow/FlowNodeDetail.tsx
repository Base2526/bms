import Link from "next/link";
import type { RefObject } from "react";

import type { FlowNode } from "./flowTypes";
import { FlowIcon } from "./FlowIcons";
import styles from "./BmsFlowDiagram.module.css";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function FlowNodeDetail({
  node,
  onClose,
  panelRef,
  t,
}: {
  node: FlowNode;
  onClose: () => void;
  panelRef: RefObject<HTMLElement>;
  t: Translate;
}) {
  return (
    <aside
      aria-labelledby={`flow-detail-${node.id}`}
      className={styles.detailPanel}
      ref={panelRef}
      role="dialog"
    >
      <div className={styles.detailTop}>
        <span className={styles.detailIcon}><FlowIcon name={node.icon} /></span>
        <button aria-label={t("bmsFlow.close")} className={styles.closeButton} onClick={onClose} type="button">×</button>
      </div>
      <div className={styles.detailHeadingRow}>
        <h3 id={`flow-detail-${node.id}`}>{t(node.labelKey)}</h3>
        {node.status !== "ready" && (
          <span className={`${styles.statusBadge} ${styles[`status_${node.status}`]}`}>
            {node.status === "config" ? "⚙ " : ""}{t(`bmsFlow.status.${node.status}`)}
          </span>
        )}
      </div>
      <p>{t(node.detail.whatKey)}</p>
      {node.detail.exampleKey && (
        <div className={styles.exampleBox}>
          <strong>{t("bmsFlow.example")}</strong>
          <span>{t(node.detail.exampleKey)}</span>
        </div>
      )}
      {node.detail.noteKey && (
        <div className={styles.noteBox}>
          <strong>{t("bmsFlow.note")}</strong>
          <span>{t(node.detail.noteKey)}</span>
        </div>
      )}
      {node.href && <Link className={styles.detailLink} href={node.href}>{t("bmsFlow.learnMore")} →</Link>}
    </aside>
  );
}
