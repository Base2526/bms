"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/lib/i18nContext";
import { flowEdges, flowNodes, flowScenarios, FLOW_STATUS_UPDATED_AT } from "./flowData";
import { FlowIcon } from "./FlowIcons";
import { FlowNodeDetail } from "./FlowNodeDetail";
import { FlowStepper } from "./FlowStepper";
import type { FlowNode, ShopScenario } from "./flowTypes";
import styles from "./BmsFlowDiagram.module.css";

type Variant = "compact" | "full";
type Point = { x: number; y: number };

const positions: Record<string, Point> = {
  "ch-line": { x: 80, y: 150 }, "ch-facebook": { x: 142, y: 150 }, "ch-instagram": { x: 204, y: 150 },
  "ch-tiktok": { x: 266, y: 150 }, "ch-web": { x: 328, y: 150 },
  "in-qr": { x: 448, y: 150 }, "in-grabfood": { x: 565, y: 150 }, "in-lineman": { x: 682, y: 150 },
  "pos-web": { x: 810, y: 150 }, "pos-desktop": { x: 900, y: 150 }, "pos-mobile": { x: 990, y: 150 },
  "ai-inbox": { x: 204, y: 275 }, "intake-accept": { x: 565, y: 275 }, "cloud-pos": { x: 900, y: 275 },
  confirm: { x: 540, y: 375 }, "bms-core": { x: 540, y: 560 },
  "m-crm": { x: 315, y: 475 }, "m-loyalty": { x: 280, y: 560 }, "m-stock": { x: 315, y: 645 },
  "m-payment": { x: 765, y: 475 }, "m-tax": { x: 800, y: 560 }, "m-purchase": { x: 765, y: 645 },
  "o-kds": { x: 120, y: 835 }, "o-shipping": { x: 330, y: 835 }, "o-live": { x: 540, y: 835 },
  "o-reports": { x: 750, y: 835 }, "o-action": { x: 960, y: 835 },
  "loop-retention": { x: 540, y: 990 },
};

const scenarioOrder: ShopScenario[] = ["all", "retail", "restaurant", "boardgame", "pharmacy"];

function edgePath(
  from: Point,
  to: Point,
  kind: "main" | "handoff" | "loop",
  fromId?: string,
  toId?: string,
) {
  // Keep the retention loop around the diagram perimeter. The former wide
  // cubic crossed the output row and collided with the Action Center edge.
  if (kind === "loop") return "M 50 990 C 30 990, 20 972, 20 940 L 20 225 C 20 180, 34 150, 50 150";

  // Join Action Center to the retention card along their right edges instead
  // of drawing a large curve through the middle of the output section.
  if (fromId === "o-action" && toId === "loop-retention") {
    return "M 1000 835 C 1025 848, 1028 920, 1000 952";
  }

  // Fan the output lines out from the lower edge of the hub. A quadratic arc
  // stays above the output cards and avoids the wide S-curves that looked
  // distorted when an output was highlighted.
  if (fromId === "bms-core" && toId?.startsWith("o-")) {
    const direction = Math.sign(to.x - from.x);
    const startX = from.x + direction * 22;
    const startY = from.y + 88;
    const endY = to.y - 40;
    const controlX = (startX + to.x) / 2;
    return `M ${startX} ${startY} Q ${controlX} 710, ${to.x} ${endY}`;
  }

  const midY = from.y + (to.y - from.y) * 0.52;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}
export default function BmsFlowDiagram({ variant = "full" }: { variant?: Variant }) {
  const { lang, t } = useI18n();
  const [selectedScenario, setSelectedScenario] = useState<ShopScenario>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [scenarioStarted, setScenarioStarted] = useState(false);
  const [scenarioStep, setScenarioStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const detailRef = useRef<HTMLElement>(null);

  const nodes = useMemo(() => flowNodes.filter((node) => variant === "full" || node.compact), [variant]);
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const visibleEdges = useMemo(
    () => flowEdges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
    [visibleIds],
  );
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const scenario = flowScenarios.find((item) => item.id === selectedScenario);
  const scenarioSteps = useMemo(
    () => (scenario?.steps ?? []).filter((step) => visibleIds.has(step.nodeId)),
    [scenario, visibleIds],
  );
  const activeStep = scenarioStarted ? scenarioSteps[scenarioStep] : undefined;
  const activeNodeId = activeStep?.nodeId ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("shop") as ShopScenario | null;
    if (requested && scenarioOrder.includes(requested)) setSelectedScenario(requested);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    if (!playing || reducedMotion || !scenarioSteps.length) return;
    if (scenarioStep >= scenarioSteps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setScenarioStep((step) => step + 1), 2200);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, scenarioStep, scenarioSteps.length]);

  useEffect(() => {
    if (!activeNodeId || window.matchMedia("(min-width: 992px)").matches) return;
    document.querySelector(`[data-flow-node="${activeNodeId}"]`)?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [activeNodeId, reducedMotion]);

  const closeDetail = useCallback((restoreFocus = true) => {
    const previous = selectedNodeId;
    setSelectedNodeId(null);
    if (restoreFocus && previous) window.setTimeout(() => nodeRefs.current.get(previous)?.focus(), 0);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, selectedNodeId]);

  const changeScenario = (value: ShopScenario) => {
    setSelectedScenario(value);
    setScenarioStarted(false);
    setScenarioStep(0);
    setPlaying(false);
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete("shop");
    else url.searchParams.set("shop", value);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const startScenario = () => {
    setScenarioStep(0);
    setScenarioStarted(true);
    setPlaying(!reducedMotion);
  };

  const selectNode = (node: FlowNode) => {
    if (selectedNodeId === node.id) closeDetail(false);
    else setSelectedNodeId(node.id);
  };

  const handleNodeKey = (event: React.KeyboardEvent<SVGGElement>, node: FlowNode) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(node);
    }
  };

  const isRelevant = (node: FlowNode) => selectedScenario === "all" || node.scenarios.includes("all") || node.scenarios.includes(selectedScenario);
  const isConnected = (nodeId: string) => !hoveredNodeId || nodeId === hoveredNodeId || visibleEdges.some(
    (edge) => (edge.from === hoveredNodeId && edge.to === nodeId) || (edge.to === hoveredNodeId && edge.from === nodeId),
  );

  const renderStatus = (node: FlowNode) => {
    if (node.status === "pilot") return <g className={styles.svgPilot}><rect height="20" rx="10" width="52" x="-26" y="-58" /><text textAnchor="middle" y="-44">PILOT</text></g>;
    if (node.status === "config") {
      return (
        <g className={styles.svgConfig}>
          <title>{t("bmsFlow.configureTooltip")}</title>
          <text x="25" y="-23">⚙</text>
        </g>
      );
    }
    return null;
  };

  const renderNode = (node: FlowNode) => {
    const point = positions[node.id];
    if (!point) return null;
    const label = t(node.labelKey);
    const relevant = isRelevant(node);
    const dimmed = !relevant || !isConnected(node.id) || (activeNodeId != null && activeNodeId !== node.id);
    const active = activeNodeId === node.id || hoveredNodeId === node.id || selectedNodeId === node.id;
    const commonProps = {
      "aria-label": `${t(node.labelKey)}: ${t(node.shortKey)}`,
      className: `${styles.svgNode} ${styles[`group_${node.group}`]} ${dimmed ? styles.nodeDimmed : ""} ${active ? styles.nodeActive : ""}`,
      "data-flow-node": node.id,
      onBlur: () => setHoveredNodeId(null),
      onClick: () => selectNode(node),
      onFocus: () => setHoveredNodeId(node.id),
      onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => handleNodeKey(event, node),
      onMouseEnter: () => setHoveredNodeId(node.id),
      onMouseLeave: () => setHoveredNodeId(null),
      ref: (element: SVGGElement | null) => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); },
      role: "button",
      tabIndex: 0,
      transform: `translate(${point.x} ${point.y})`,
    };

    if (["ai-inbox", "cloud-pos", "intake-accept", "confirm"].includes(node.id)) {
      const width = node.id === "confirm" ? 420 : node.id === "intake-accept" ? 290 : 300;
      return <g key={node.id} {...commonProps}><rect className={styles.svgPill} height="58" rx="29" width={width} x={-width / 2} y="-29" /><FlowIcon name={node.icon} size={24} x={-width / 2 + 20} y={-12} /><text className={styles.svgPillLabel} textAnchor="middle" y="-2">{t(node.labelKey)}</text><text className={styles.svgShort} textAnchor="middle" y="18">{t(node.shortKey)}</text>{renderStatus(node)}</g>;
    }
    if (node.id === "bms-core") {
      return <g key={node.id} {...commonProps}><circle className={styles.svgHubHalo} r="112" /><circle className={styles.svgHub} fill={`url(#bms-flow-hub-${variant})`} r="90" /><FlowIcon name={node.icon} size={30} x={-15} y={-60} /><text className={styles.svgHubTitle} textAnchor="middle" y="5">BMS</text><text className={styles.svgHubShort} textAnchor="middle" y="34">{t(node.shortKey)}</text></g>;
    }
    if (node.group === "module") {
      const left = point.x < 540;
      return <g key={node.id} {...commonProps}><circle className={styles.svgModuleCircle} r="34" /><FlowIcon name={node.icon} size={26} x={-13} y={-13} /><text className={styles.svgModuleLabel} textAnchor={left ? "end" : "start"} x={left ? -50 : 50} y="-4">{t(node.labelKey)}</text><text className={styles.svgModuleShort} textAnchor={left ? "end" : "start"} x={left ? -50 : 50} y="18">{t(node.shortKey)}</text>{renderStatus(node)}</g>;
    }
    if (node.group === "output") {
      return <g key={node.id} {...commonProps}><circle className={styles.svgOutputCircle} r="40" /><FlowIcon name={node.icon} size={28} x={-14} y={-14} /><text className={styles.svgOutputLabel} textAnchor="middle" y="66">{t(node.labelKey)}</text><text className={styles.svgOutputShort} textAnchor="middle" y="86">{t(node.shortKey)}</text>{renderStatus(node)}</g>;
    }
    if (node.group === "loop") {
      return <g key={node.id} {...commonProps}><rect className={styles.svgRetention} height="76" rx="20" width="980" x="-490" y="-38" /><FlowIcon name={node.icon} size={30} x={430} y={-15} /><text className={styles.svgRetentionLabel} x="-455" y="-5">{t(node.labelKey)}</text><text className={styles.svgRetentionShort} x="-455" y="20">{t(node.shortKey)}</text></g>;
    }
    return <g key={node.id} {...commonProps}><circle className={styles.svgInputCircle} r="30" /><FlowIcon name={node.icon} size={24} x={-12} y={-12} /><text className={styles.svgInputLabel} lengthAdjust="spacingAndGlyphs" textAnchor="middle" textLength={label.length >= 8 ? 54 : undefined} y="51">{label}</text><text className={styles.svgInputShort} textAnchor="middle" y="69">{t(node.shortKey)}</text>{renderStatus(node)}</g>;
  };

  const formattedDate = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH", {
    calendar: "gregory",
    dateStyle: "medium",
  })
    .format(new Date(`${FLOW_STATUS_UPDATED_AT}T12:00:00Z`));

  return (
    <section className={`${styles.flowRoot} ${styles[variant]}`} id="workflow">
      <div className={styles.flowHeader}>
        {/* The product name appears once, inside the hub. The eyebrow and the
            heading say what the reader gets instead of naming BMS again. */}
        <span className={styles.eyebrow}>{t("bmsFlow.eyebrow")}</span>
        {/* Thai has no spaces between words, so the browser may break inside
            one ("สต็ / อก"). Each space-separated phrase is kept whole. */}
        <h2>{t("bmsFlow.subtitle").split(" ").map((phrase, index) => (
          // The space stays outside the nowrap span so it remains a break point.
          <Fragment key={index}>{index > 0 ? " " : null}<span className={styles.headingPhrase}>{phrase}</span></Fragment>
        ))}</h2>
        <p>{t("bmsFlow.intro")}</p>
      </div>

      <div aria-label={t("bmsFlow.title")} className={styles.scenarioBar} role="group">
        {scenarioOrder.map((id) => {
          const label = id === "all" ? t("bmsFlow.all") : t(flowScenarios.find((item) => item.id === id)!.labelKey);
          return <button aria-pressed={selectedScenario === id} className={selectedScenario === id ? styles.scenarioActive : ""} key={id} onClick={() => changeScenario(id)} type="button">{label}</button>;
        })}
      </div>

      {selectedScenario !== "all" && (
        <div className={styles.playerBar}>
          {!scenarioStarted ? <button className={styles.playButton} onClick={startScenario} type="button">▶ {t("bmsFlow.play")}</button> : (
            <>
              <button disabled={reducedMotion || !playing} onClick={() => setPlaying(false)} type="button">⏸ {t("bmsFlow.pause")}</button>
              <button disabled={scenarioStep === 0} onClick={() => { setPlaying(false); setScenarioStep((step) => Math.max(0, step - 1)); }} type="button">◀ {t("bmsFlow.previous")}</button>
              <button disabled={scenarioStep >= scenarioSteps.length - 1} onClick={() => { setPlaying(false); setScenarioStep((step) => Math.min(scenarioSteps.length - 1, step + 1)); }} type="button">▶ {t("bmsFlow.next")}</button>
              <button onClick={startScenario} type="button">↺ {t("bmsFlow.restart")}</button>
            </>
          )}
        </div>
      )}

      <div className={`${styles.diagramWithDetail} ${selectedNode ? styles.hasDetail : ""}`}>
        <div className={styles.desktopDiagram}>
          <svg
            aria-describedby="bms-flow-svg-desc"
            aria-label={t("bmsFlow.subtitle")}
            className={styles.flowSvg}
            onClick={(event) => { if (!(event.target as Element).closest("[data-flow-node]")) closeDetail(); }}
            role="group"
            viewBox="0 0 1080 1080"
          >
            <desc id="bms-flow-svg-desc">{t("bmsFlow.intro")}</desc>
            <defs>
              <linearGradient id={`bms-flow-hub-${variant}`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#0c2a7a" /><stop offset=".55" stopColor="#1747d1" /><stop offset="1" stopColor="#0fb5a6" /></linearGradient>
              <marker id={`bms-flow-arrow-${variant}`} markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0 0L7 3.5 0 7z" /></marker>
            </defs>
            <g className={styles.svgCards}>
              <rect height="245" rx="22" width="340" x="34" y="52" /><rect className={styles.cardAccentChat} height="5" rx="3" width="44" x="62" y="52" />
              <text className={styles.svgCardTitle} x="67" y="91">① {t("bmsFlow.groups.chat")}</text><text className={styles.svgCardHint} textAnchor="end" x="346" y="91">{t("bmsFlow.groups.chatHint")}</text>
              <rect height="245" rx="22" width="360" x="390" y="52" /><rect className={styles.cardAccentIntake} height="5" rx="3" width="44" x="418" y="52" />
              <text className={styles.svgCardTitle} x="423" y="91">① {t("bmsFlow.groups.intake")}</text><text className={styles.svgCardHint} textAnchor="end" x="722" y="91">{t("bmsFlow.groups.intakeHint")}</text>
              <rect height="245" rx="22" width="280" x="766" y="52" /><rect className={styles.cardAccentPos} height="5" rx="3" width="44" x="794" y="52" />
              <text className={styles.svgCardTitle} x="799" y="91">① {t("bmsFlow.groups.pos")}</text><text className={styles.svgCardHint} textAnchor="end" x="1018" y="91">{t("bmsFlow.groups.posHint")}</text>
            </g>
            <g className={styles.svgEdges}>
              {visibleEdges.map((edge) => {
                const connected = hoveredNodeId && (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
                const activeEdge = activeNodeId && (edge.from === activeNodeId || edge.to === activeNodeId);
                const retentionConnector = edge.to === "loop-retention";
                return <path className={`${edge.kind === "loop" ? styles.loopEdge : ""} ${connected || activeEdge ? styles.edgeActive : ""} ${hoveredNodeId && !connected ? styles.edgeDimmed : ""}`} d={edgePath(positions[edge.from], positions[edge.to], edge.kind, edge.from, edge.to)} key={`${edge.from}-${edge.to}`} markerEnd={edge.kind === "loop" || retentionConnector ? undefined : `url(#bms-flow-arrow-${variant})`} />;
              })}
            </g>
            <text className={styles.svgVerifyLabel} textAnchor="middle" x="540" y="337">② {t("bmsFlow.groups.verify")}</text>
            <rect className={styles.svgOutputHeadingBg} height="36" rx="18" width="250" x="415" y="716" />
            <text className={styles.svgOutputHeading} textAnchor="middle" x="540" y="740">③ {t("bmsFlow.groups.outputs")}</text>
            {scenarioStarted && scenarioStep > 0 && activeNodeId && !reducedMotion && (
              <circle className={styles.scenarioDot} key={`${selectedScenario}-${scenarioStep}`} r="6">
                <animateMotion
                  dur=".7s"
                  fill="freeze"
                  path={edgePath(positions[scenarioSteps[scenarioStep - 1].nodeId], positions[activeNodeId], "main")}
                />
              </circle>
            )}
            {nodes.map(renderNode)}
          </svg>
          <ol className={styles.visuallyHidden}>
            {nodes.map((node) => <li key={node.id}><strong>{t(node.labelKey)}</strong>: {t(node.detail.whatKey)}</li>)}
          </ol>
        </div>

        <FlowStepper activeNodeId={activeNodeId} nodes={nodes} onSelect={selectNode} selectedNodeId={selectedNodeId} selectedScenario={selectedScenario} t={t} />
        {selectedNode && <FlowNodeDetail node={selectedNode} onClose={() => closeDetail()} panelRef={detailRef} t={t} />}
      </div>

      {scenarioStarted && activeStep && (
        <div aria-live="polite" className={styles.scenarioCaption}>
          <span>{t("bmsFlow.stepCounter", { current: scenarioStep + 1, total: scenarioSteps.length })}</span>
          <strong>{t(activeStep.captionKey)}</strong>
          {selectedScenario === "pharmacy" && <><em>{t("bmsFlow.pharmacyPilot")}</em><em>{t("bmsFlow.pharmacistDecides")}</em></>}
        </div>
      )}

      {variant === "compact" ? (
        <div className={styles.compactFooter}>
          <Link className={styles.detailedCta} href="/how-it-works">{t("bmsFlow.detailedCta")}</Link>
          <small>{t("bmsFlow.supplements.updated", { date: formattedDate })}</small>
        </div>
      ) : (
        <div className={styles.fullExtras}>
          <div className={styles.extraCards}>
            <article className={styles.localCard}><div><h3>{t("bmsFlow.supplements.localTitle")} <span>PILOT</span></h3><p>{t("bmsFlow.supplements.localBody")}</p></div><Link href="/retail-local">{t("bmsFlow.learnMore")} →</Link></article>
            <article className={styles.connectingCard}><div><h3>{t("bmsFlow.supplements.connectingTitle")}</h3><small>{t("bmsFlow.supplements.connectingHint")}</small></div><p>{t("bmsFlow.supplements.connecting")}</p><Link href="/roadmap">{t("bmsFlow.learnMore")} →</Link></article>
          </div>
          <div className={styles.trustBar}><strong>{t("bmsFlow.supplements.trustTitle")}</strong>{[1, 2, 3, 4, 5].map((index) => <span key={index}><FlowIcon name={index === 1 ? "ucheck" : index === 2 ? "lock" : index === 3 ? "hist" : index === 4 ? "shield" : "doc"} /><span className={styles.trustItemText}>{t(`bmsFlow.supplements.trust${index}`)}</span></span>)}</div>
          <div className={styles.footnotes}><span>* {t("bmsFlow.supplements.pharmacyFootnote")}</span><span>* {t("bmsFlow.supplements.offlineFootnote")}</span><span>* {t("bmsFlow.supplements.updated", { date: formattedDate })}</span></div>
        </div>
      )}
    </section>
  );
}
