"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lang } from "@/i18n";
import { layoutSequence, parseSequence, type DiagramLabels, type Measure } from "./sequence";
import SequenceSvg from "./SequenceSvg";
import PrintSequence, { type PrintFlow } from "./PrintSequence";
import styles from "./restaurant.module.css";

const estimate: Measure = text => Array.from(text).reduce((width, c) => width + (/\s/.test(c) ? 4 : /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c) ? 0 : 9), 0);

export default function SequenceDiagram({ source, title, lang, labels, zoomLabel, fitLabel, hint, transcriptLabel, printFlow }: {
  source: string; title: string; lang: Lang; labels: DiagramLabels; zoomLabel: string;
  fitLabel: string; hint: string; transcriptLabel: string; printFlow: PrintFlow;
}) {
  const id = useId().replace(/:/g, ""), holder = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState<Measure>(() => estimate);
  const [zoom, setZoom] = useState("fit"), [available, setAvailable] = useState<number | null>(null);
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
  const width = zoom === "fit" ? Math.max(layout.width * .8, available ?? layout.width) : layout.width * Number(zoom);
  const people = new Map(sequence.participants.map(p => [p.id, p.label]));
  return <div>
    <PrintSequence layout={layout} flow={printFlow} />
    <div className={styles.diagramTools}>
      <p id={`${id}-hint`}>{hint}</p>
      <label>{zoomLabel}<select value={zoom} onChange={e => setZoom(e.target.value)} aria-label={zoomLabel}>
        <option value="fit">{fitLabel}</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option>
      </select></label>
    </div>
    <div ref={holder} className={styles.diagramScroll} tabIndex={0} role="region" aria-label={title} aria-describedby={`${id}-hint`}>
      <SequenceSvg layout={layout} title={title} width={width} />
    </div>
    <details className={styles.transcript}><summary>{transcriptLabel}</summary>
      <ol>{sequence.events.map((e, i) => e.kind === "end" ? null : <li key={i}>
        {e.kind === "message" ? <><strong>{people.get(e.from)} → {people.get(e.to)}</strong><span>{e.label}</span></> : <em>{e.kind !== "note" ? `${labels[e.kind]}: ` : ""}{e.label}</em>}
      </li>)}</ol>
    </details>
  </div>;
}
