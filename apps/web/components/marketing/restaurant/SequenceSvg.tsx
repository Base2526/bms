"use client";

import { useId } from "react";
import type { SequenceLayout, Shape } from "./sequence";
import styles from "./restaurant.module.css";

export default function SequenceSvg({ layout, title, width, start = 0, height = layout.height, activeEventIndex }: {
  layout: SequenceLayout; title: string; width?: number; start?: number; height?: number; activeEventIndex?: number;
}) {
  const id = useId().replace(/:/g, "");
  const arrow = `url(#${id}-arrow)`;
  const draw = (shape: Shape, index: number) => {
    const active = activeEventIndex === shape.eventIndex && shape.eventIndex !== undefined;
    if (shape.type === "text" && (shape.y + (shape.rows.length - 1) * 21 + 5 < start || shape.y - 16 > start + height)) return null;
    if (shape.type === "text") return <text key={index} x={shape.x} y={shape.y} textAnchor={shape.anchor} className={`${shape.muted ? styles.svgMuted : styles.svgText} ${active ? styles.activeText : ""}`} fontSize={shape.small ? 11 : 14}>
      {shape.rows.map((row, i) => <tspan key={i} x={shape.x} dy={i ? 21 : 0}>{row}</tspan>)}
    </text>;
    if (shape.type === "rect") return <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.radius} className={`${styles[`rect_${shape.tone}`]} ${active ? styles.activeRect : ""}`} />;
    if (shape.type === "self") return <path key={index} d={`M${shape.x},${shape.y} h32 v17 h-32`} className={`${styles.messageLine} ${active ? styles.activeLine : ""}`} markerEnd={arrow} />;
    return <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} className={`${shape.tone === "message" ? styles.messageLine : styles.guideLine} ${active ? styles.activeLine : ""}`} strokeDasharray={shape.tone === "lifeline" ? "3 6" : shape.reply ? "5 4" : undefined} markerEnd={shape.tone === "message" ? arrow : undefined} />;
  };
  return <svg className={styles.diagramSvg} style={{ width: width ?? "100%" }} viewBox={`0 ${start} ${layout.width} ${height}`} role="img" aria-labelledby={`${id}-title`}>
    <title id={`${id}-title`}>{title}</title>
    <defs><marker id={`${id}-arrow`} markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" className={styles.arrowHead} /></marker></defs>
    {layout.shapes.map(draw)}
  </svg>;
}
