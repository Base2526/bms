"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { paginateSequence, type SequenceLayout } from "./sequence";
import SequenceSvg from "./SequenceSvg";
import styles from "./restaurant.module.css";

export type PrintFlow = { id: number; title: string; description: string; note: string; pageLabel: string; continued: string; scope: string };

export default function PrintSequence({ layout, flow }: { layout: SequenceLayout; flow: PrintFlow }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  const pages = paginateSequence(layout);
  const url = new URL(window.location.href); url.hash = `flow-${flow.id}`;
  return createPortal(<div className={styles.printRoot} data-restaurant-print>
    {pages.map((page, i) => <section className={styles.printPage} key={page.start}>
      <header className={styles.printHeading}>
        <h1>BMS · FLOW {String(flow.id).padStart(2, "0")} · {flow.title}</h1>
        <p>{flow.description}</p>
        <p>{page.context.length ? `${flow.continued}: ${page.context.join(" / ")}` : "Sequence Diagram"}</p>
      </header>
      <div className={styles.printDiagram}>
        <SequenceSvg layout={layout} title={flow.title} height={layout.headerBottom} />
        <SequenceSvg layout={layout} title={flow.title} start={page.start} height={page.end - page.start} />
      </div>
      <footer className={styles.printFooter}>
        <p>{flow.note}</p><p>{flow.scope}</p>
        <div><a href={url.href}>{url.href}</a><span>{flow.pageLabel} {i + 1} / {pages.length}</span></div>
      </footer>
    </section>)}
  </div>, document.body);
}
