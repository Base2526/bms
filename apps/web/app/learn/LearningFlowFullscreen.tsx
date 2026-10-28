"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import s from "./learning.module.css";

type Props = {
  lang: "th" | "en";
  title: string;
  cueText: string;
  step: number;
  total: number;
  playing: boolean;
  canPlay: boolean;
  onTogglePlaying: () => void;
  onPrevious: () => void;
  onNext: () => void;
  renderDiagram: () => ReactNode;
};

export function LearningFlowFullscreen({
  lang, title, cueText, step, total, playing, canPlay, onTogglePlaying, onPrevious, onNext, renderDiagram,
}: Props) {
  const th = lang === "th";
  const [open, setOpen] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [zoom, setZoom] = useState(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !autoFollow) return;
    const frame = requestAnimationFrame(() => {
      const active = viewportRef.current?.querySelector<HTMLElement>("[data-flow-active='true']");
      active?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFollow, open, step]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !viewportRef.current) return;
    dragRef.current = { x: event.clientX, y: event.clientY, left: viewportRef.current.scrollLeft, top: viewportRef.current.scrollTop };
    viewportRef.current.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !viewportRef.current) return;
    viewportRef.current.scrollLeft = dragRef.current.left - (event.clientX - dragRef.current.x);
    viewportRef.current.scrollTop = dragRef.current.top - (event.clientY - dragRef.current.y);
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function fitDiagram() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const style = getComputedStyle(viewport);
    const width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    setZoom(Math.max(.1, Math.min(1, width / 1100)));
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  const canvasStyle = { "--flow-zoom": zoom } as CSSProperties;

  return <>
    <button ref={triggerRef} type="button" className={s.flowFullscreenTrigger} onClick={() => setOpen(true)}>
      <span aria-hidden="true">⛶</span> {th ? "ดู Flow เต็มจอ" : "View flow full screen"}
    </button>
    {open && <dialog ref={dialogRef} className={s.flowFullscreen} data-learning-fullscreen aria-modal="true" aria-labelledby="learning-flow-fullscreen-title" onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
      <header className={s.flowFullscreenHeader}>
        <div>
          <h2 id="learning-flow-fullscreen-title">{title}</h2>
          <span>{th ? `ขั้นตอน ${step + 1}/${total}` : `Step ${step + 1} of ${total}`}</span>
        </div>
        <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={th ? "ออกจากโหมดเต็มจอ" : "Exit full screen"}>
          <span aria-hidden="true">×</span> {th ? "ออกจากเต็มจอ" : "Exit"}
        </button>
      </header>
      <div className={s.flowFullscreenBody}>
        <div
          ref={viewportRef}
          className={s.flowFullscreenViewport}
          tabIndex={0}
          role="region"
          aria-label={th ? "แผนภาพ Flow ลากเพื่อเลื่อนดู" : "Flow diagram; drag to pan"}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <div className={s.flowFullscreenCanvas} style={canvasStyle}>{renderDiagram()}</div>
        </div>
        <aside className={s.flowFullscreenDetail} aria-live={playing ? "off" : "polite"}>
          <span>{th ? "กำลังอธิบาย" : "Now explaining"}</span>
          <p>{cueText}</p>
          <small>{th ? "AI ช่วยสรุปและใช้เครื่องมือที่อนุญาต ข้อมูลและการอนุมัติยังยึดระบบจริง" : "AI summarizes and uses approved tools; verified system data and human authority remain decisive."}</small>
        </aside>
      </div>
      <footer className={s.flowFullscreenControls}>
        <div>
          <button type="button" onClick={onPrevious} disabled={step === 0}>← {th ? "ก่อนหน้า" : "Previous"}</button>
          <button type="button" className={s.flowFullscreenPlay} onClick={onTogglePlaying} disabled={!canPlay}>{playing ? "❚❚" : "▶"} {playing ? (th ? "หยุด" : "Pause") : (th ? "เล่นเสียง" : "Play")}</button>
          <button type="button" onClick={onNext} disabled={step === total - 1}>{th ? "ถัดไป" : "Next"} →</button>
        </div>
        <div>
          <label className={s.flowAutoFollow}><input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} /> {th ? "ติดตามเสียง" : "Auto-follow"}</label>
          <button type="button" onClick={() => setZoom((value) => Math.max(.75, value - .25))} disabled={zoom <= .75} aria-label={th ? "ซูมออก" : "Zoom out"}>−</button>
          <output aria-label={th ? "ระดับการซูม" : "Zoom level"}>{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.75, value + .25))} disabled={zoom >= 1.75} aria-label={th ? "ซูมเข้า" : "Zoom in"}>+</button>
          <button type="button" onClick={fitDiagram}>{th ? "พอดีจอ" : "Fit"}</button>
        </div>
      </footer>
    </dialog>}
  </>;
}
