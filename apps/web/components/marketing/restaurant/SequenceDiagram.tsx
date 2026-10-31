"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lang } from "@/i18n";
import { layoutSequence, parseSequence, type DiagramLabels, type Measure } from "./sequence";
import SequenceSvg from "./SequenceSvg";
import PrintSequence, { type PrintFlow } from "./PrintSequence";
import PlaybackPlayer, { type PlayerCopy } from "./PlaybackPlayer";
import styles from "./restaurant.module.css";

const estimate: Measure = text => Array.from(text).reduce((width, c) => width + (/\s/.test(c) ? 4 : /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c) ? 0 : 9), 0);

export type FullscreenCopy = { open: string; close: string; rotateHint: string; dismiss: string };

export default function SequenceDiagram({ source, title, lang, labels, zoomLabel, fitLabel, hint, transcriptLabel, printFlow, playerCopy, fullscreenCopy }: {
  source: string; title: string; lang: Lang; labels: DiagramLabels; zoomLabel: string;
  fitLabel: string; hint: string; transcriptLabel: string; printFlow: PrintFlow; playerCopy: PlayerCopy;
  fullscreenCopy: FullscreenCopy;
}) {
  const id = useId().replace(/:/g, ""), holder = useRef<HTMLDivElement>(null);
  // One frame holds the player, zoom and diagram, so full screen never remounts playback or audio.
  const frame = useRef<HTMLDivElement>(null), openButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const fullscreenIntent = useRef(false), restoreFocus = useRef(false);
  // "native" = Fullscreen API; "overlay" = fixed layer for browsers without element full screen (iPhone Safari).
  const [expanded, setExpanded] = useState<"native" | "overlay" | null>(null);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [measure, setMeasure] = useState<Measure>(() => estimate);
  const [zoom, setZoom] = useState("fit"), [available, setAvailable] = useState<number | null>(null);
  const [activeEventIndex, setActiveEventIndex] = useState<number | undefined>();
  const sequence = useMemo(() => parseSequence(source), [source]);
  const layout = useMemo(() => layoutSequence(sequence, measure, lang, labels), [sequence, measure, lang, labels]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active || !holder.current) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = `14px ${getComputedStyle(holder.current).fontFamily}`;
      setMeasure(() => (text: string) => context.measureText(text).width);
    };
    refresh();
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => { active = false; document.fonts.removeEventListener("loadingdone", refresh); };
  }, [lang]);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const update = () => setAvailable(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const openFullscreen = async () => {
    fullscreenIntent.current = true;
    restoreFocus.current = true;
    const element = frame.current;
    if (element?.requestFullscreen && document.fullscreenEnabled) {
      // Some embedded browsers neither grant nor refuse; do not leave the button looking dead.
      let request: Promise<void>;
      try { request = element.requestFullscreen(); }
      catch { setExpanded("overlay"); return; }
      const outcome = await Promise.race([
        request.then(() => "granted" as const, () => "refused" as const),
        new Promise<"slow">(resolve => setTimeout(() => resolve("slow"), 1200)),
      ]);
      if (outcome === "granted") {
        if (fullscreenIntent.current) setExpanded("native");
        else if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
        return;
      }
      if (outcome === "slow") request.then(() => {
        if (fullscreenIntent.current) setExpanded("native");
        else if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
      }, () => undefined);
    }
    if (fullscreenIntent.current) setExpanded("overlay");
  };
  const closeFullscreen = () => {
    fullscreenIntent.current = false;
    if (document.fullscreenElement) {
      // Let fullscreenchange clear the UI after the browser has exited, then focus can return reliably.
      void document.exitFullscreen().catch(() => setExpanded(null));
      return;
    }
    setExpanded(null);
  };
  useEffect(() => {
    // Esc in native full screen exits without calling closeFullscreen.
    const sync = () => {
      if (document.fullscreenElement) return;
      fullscreenIntent.current = false;
      setExpanded(current => current === "native" ? null : current);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!expanded) {
      if (restoreFocus.current) openButton.current?.focus();
      restoreFocus.current = false;
      return;
    }
    closeButton.current?.focus();
    const overlay = expanded === "overlay";
    const scroll = document.body.style.overflow;
    if (overlay) document.body.style.overflow = "hidden";
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeFullscreen(); return; }
      if (!overlay || event.key !== "Tab" || !frame.current) return;
      const focusable = Array.from(frame.current.querySelectorAll<HTMLElement>("button:not([disabled]), select, input, a[href], [tabindex='0']")).filter(el => el.offsetParent);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keys);
    return () => { if (overlay) document.body.style.overflow = scroll; document.removeEventListener("keydown", keys); };
  }, [expanded]);
  useEffect(() => {
    // Keep the step being narrated in view; on the page itself this would scroll the reader away.
    if (!expanded || activeEventIndex === undefined || !holder.current) return;
    const active = holder.current.querySelector<SVGGraphicsElement>(`.${styles.activeRect}`);
    if (!active) return;
    const box = active.getBoundingClientRect(), view = holder.current.getBoundingClientRect();
    holder.current.scrollBy({ top: box.top - view.top - view.height / 2 + box.height / 2, behavior: "smooth" });
  }, [expanded, activeEventIndex]);
  const width = zoom === "fit" ? Math.max(layout.width * .8, available ?? layout.width) : layout.width * Number(zoom);
  const people = new Map(sequence.participants.map(p => [p.id, p.label]));
  return <div>
    <PrintSequence layout={layout} flow={printFlow} />
    <div ref={frame} className={expanded ? styles.fullscreenFrame : undefined} data-diagram-frame={expanded ?? "inline"}
      {...(expanded === "overlay" ? { role: "dialog", "aria-modal": true, "aria-label": title } : {})}>
    {expanded && <div className={styles.fullscreenBar}>
      <div><small>FLOW {String(printFlow.id).padStart(2, "0")}</small><strong>{printFlow.title}</strong></div>
      <button ref={closeButton} type="button" className={styles.button} onClick={closeFullscreen} data-close-fullscreen>✕ {fullscreenCopy.close}</button>
    </div>}
    {expanded && !rotateDismissed && <p className={styles.rotateHint}>{fullscreenCopy.rotateHint}
      <button type="button" onClick={() => setRotateDismissed(true)}>{fullscreenCopy.dismiss}</button></p>}
    <PlaybackPlayer sequence={sequence} lang={lang} copy={playerCopy} introduction={`${printFlow.title}. ${printFlow.description}`} conclusion={printFlow.note}
      downloadName={`bms-restaurant-flow-${String(printFlow.id).padStart(2, "0")}-${lang}.mp3`} onActive={setActiveEventIndex} />
    <div className={styles.diagramTools}>
      <p id={`${id}-hint`}>{hint}</p>
      <div className={styles.diagramActions}>
        <label>{zoomLabel}<select value={zoom} onChange={e => setZoom(e.target.value)} aria-label={zoomLabel}>
          <option value="fit">{fitLabel}</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option>
        </select></label>
        {!expanded && <button ref={openButton} type="button" className={styles.primaryButton} onClick={() => void openFullscreen()} data-open-fullscreen>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>{fullscreenCopy.open}
        </button>}
      </div>
    </div>
    <div ref={holder} className={styles.diagramScroll} tabIndex={0} role="region" aria-label={title} aria-describedby={`${id}-hint`}>
      <SequenceSvg layout={layout} title={title} width={width} activeEventIndex={activeEventIndex} />
    </div>
    </div>
    <details className={styles.transcript}><summary>{transcriptLabel}</summary>
      <ol>{sequence.events.map((e, i) => e.kind === "end" ? null : <li key={i}>
        {e.kind === "message" ? <><strong>{people.get(e.from)} → {people.get(e.to)}</strong><span>{e.label}</span></> : <em>{e.kind !== "note" ? `${labels[e.kind]}: ` : ""}{e.label}</em>}
      </li>)}</ol>
    </details>
  </div>;
}
