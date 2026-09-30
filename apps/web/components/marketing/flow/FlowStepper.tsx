import type { FlowNode, ShopScenario } from "./flowTypes";
import { FlowIcon } from "./FlowIcons";
import styles from "./BmsFlowDiagram.module.css";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const stageGroups: Array<{ key: string; labelKey: string; nodeGroups: FlowNode["group"][] }> = [
  { key: "channels", labelKey: "bmsFlow.groups.channelsStage", nodeGroups: ["chat", "orderIntake", "pos"] },
  { key: "verify", labelKey: "bmsFlow.groups.verifyStage", nodeGroups: ["core"] },
  { key: "modules", labelKey: "bmsFlow.groups.systemStage", nodeGroups: ["module"] },
  { key: "outputs", labelKey: "bmsFlow.groups.outputStage", nodeGroups: ["output", "loop"] },
];

export function FlowStepper({
  activeNodeId,
  nodes,
  onSelect,
  selectedNodeId,
  selectedScenario,
  t,
}: {
  activeNodeId: string | null;
  nodes: FlowNode[];
  onSelect: (node: FlowNode) => void;
  selectedNodeId: string | null;
  selectedScenario: ShopScenario;
  t: Translate;
}) {
  return (
    <div className={styles.mobileStepper}>
      {stageGroups.map((stage, stageIndex) => {
        const stageNodes = nodes.filter((node) => stage.nodeGroups.includes(node.group));
        if (!stageNodes.length) return null;
        return (
          <section className={styles.mobileStage} key={stage.key}>
            <h3><span>{stageIndex + 1}</span>{t(stage.labelKey)}</h3>
            <div className={stage.key === "modules" ? styles.mobileModuleGrid : styles.mobileCardList}>
              {stageNodes.map((node) => {
                const expanded = selectedNodeId === node.id;
                const active = activeNodeId === node.id;
                const relevant = selectedScenario === "all" || node.scenarios.includes("all") || node.scenarios.includes(selectedScenario);
                return (
                  <article
                    className={`${styles.mobileNode} ${active ? styles.mobileNodeActive : ""} ${relevant ? "" : styles.nodeDimmed}`}
                    data-flow-node={node.id}
                    key={node.id}
                  >
                    <button
                      aria-expanded={expanded}
                      className={styles.mobileNodeButton}
                      onClick={() => onSelect(node)}
                      type="button"
                    >
                      <span className={`${styles.mobileNodeIcon} ${styles[`group_${node.group}`]}`}><FlowIcon name={node.icon} /></span>
                      <span className={styles.mobileNodeCopy}>
                        <strong>{t(node.labelKey)}</strong>
                        <small>{t(node.shortKey)}</small>
                      </span>
                      {node.status === "pilot" && <span className={`${styles.statusBadge} ${styles.status_pilot}`}>PILOT</span>}
                      {node.status === "config" && <span aria-label={t("bmsFlow.configureTooltip")} className={styles.mobileConfig}>⚙</span>}
                      <span aria-hidden="true" className={styles.mobileChevron}>{expanded ? "−" : "+"}</span>
                    </button>
                    {expanded && (
                      <div className={styles.mobileDetail}>
                        <p>{t(node.detail.whatKey)}</p>
                        {node.detail.exampleKey && <p className={styles.exampleBox}><strong>{t("bmsFlow.example")}</strong><span>{t(node.detail.exampleKey)}</span></p>}
                        {node.detail.noteKey && <p className={styles.noteBox}><strong>{t("bmsFlow.note")}</strong><span>{t(node.detail.noteKey)}</span></p>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {stageIndex < stageGroups.length - 1 && <div aria-hidden="true" className={styles.mobileArrow}>↓</div>}
          </section>
        );
      })}
    </div>
  );
}
