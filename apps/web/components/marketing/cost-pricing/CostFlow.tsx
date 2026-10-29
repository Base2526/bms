"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Lang } from "@/i18n";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { RecordedNarration } from "../restaurant/recordedNarration";
import { costCopy } from "./content";
import steps from "./flow.json";
import styles from "./cost-pricing.module.css";

export default function CostFlow({ lang }: { lang: Lang }) {
  const c = resolveBilingual(costCopy, lang);
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true), [rate, setRate] = useState(1), [failed, setFailed] = useState(false);
  const element = useRef<HTMLAudioElement>(null), player = useRef<RecordedNarration>();
  const current = steps[step][lang];
  const start = useCallback((target: number) => {
    if (!element.current) return;
    player.current ??= new RecordedNarration(element.current);
    player.current.play(`${target}:${rate}`, steps[target].audio, rate, () => {
      if (target === steps.length - 1) setPlaying(false);
      else setStep(target + 1);
    }, () => { setFailed(true); setPlaying(false); });
  }, [rate]);
  useEffect(() => {
    if (!playing) return;
    if (sound) { start(step); return () => player.current?.stop(); }
    const timer = setTimeout(() => {
      if (step === steps.length - 1) setPlaying(false); else setStep(step + 1);
    }, 6000 / rate);
    return () => clearTimeout(timer);
  }, [playing, sound, step, rate, start]);
  useEffect(() => {
    const stop = () => { if (document.hidden) { player.current?.stop(); setPlaying(false); } };
    document.addEventListener("visibilitychange", stop);
    return () => { document.removeEventListener("visibilitychange", stop); player.current?.stop(); };
  }, []);
  const select = (next: number) => { player.current?.stop(); setPlaying(false); setFailed(false); setStep(next); };
  return <section id="cost-flow" className={styles.section} aria-labelledby="cost-flow-title">
    <div className={styles.sectionHead}><p className={styles.eyebrow}>FOLLOW THE COST</p><h2 id="cost-flow-title">{c.diagramTitle}</h2><p>{c.diagramDescription}</p></div>
    <div className={styles.player} data-cost-player>
      <audio ref={element} preload="none" />
      <div className={styles.playerHeading}><strong>{step + 1} · {current.title}</strong><span data-step-counter>{step + 1} / {steps.length}</span></div>
      <p className={styles.caption} aria-live={playing && sound ? "off" : "polite"}>{current.speech}</p>
      <div className={styles.controls}>
        <button className={styles.primary} data-play onClick={() => {
          if (playing) { player.current?.stop(); setPlaying(false); return; }
          setFailed(false);
          if (sound) start(step);
          setPlaying(true);
        }}>{playing ? c.pause : sound ? c.play : c.silentPlay}</button>
        <button onClick={() => select(step - 1)} disabled={step === 0}>{c.previous}</button>
        <button onClick={() => select(step + 1)} disabled={step === steps.length - 1}>{c.next}</button>
        <button onClick={() => select(0)}>{c.restart}</button>
        <label><input type="checkbox" checked={sound} onChange={e => { select(step); setSound(e.target.checked); }} />{c.sound}</label>
        <label>{c.speed}<select value={rate} onChange={e => { select(step); setRate(Number(e.target.value)); }}>
          {[1, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×</option>)}
        </select></label>
        <a href="/audio/cost-pricing/th/summary.mp3" download="bms-cost-pricing-th.mp3">{c.download}</a>
      </div>
      <p className={styles.note} role="status">{failed ? c.failed : c.voice}{lang === "en" ? ` · ${c.englishVoice}` : ""}</p>
    </div>
    <p className={styles.legend}>{c.legend}</p>
    <div className={styles.actors}>{c.actors.map(actor => <div key={actor}>{actor}</div>)}</div>
    <div>{steps.map((s, i) => <Fragment key={i}>
      {s.phase !== null && <p className={styles.phase}>{c.phases[s.phase]}</p>}
      <button className={styles.sequenceRow} data-flow-step={i} aria-pressed={i === step} onClick={() => select(i)} aria-label={`${i + 1} · ${s[lang].title}`}
        style={{ "--start": `${12.5 + Math.min(s.from, s.to) * 25}%`, "--length": `${Math.abs(s.from - s.to) * 25}%` } as CSSProperties}>
        <span className={styles.rowNumber}>{String(i + 1).padStart(2, "0")}</span>
        <span className={styles.lifelines} aria-hidden="true"><i /><i /><i /><i /></span>
        <span className={styles.message}>
          <span className={styles.mobileActors}>{c.actors[s.from]} → {c.actors[s.to]}</span>
          <span className={styles.messageLabel}>{s[lang].label}<small>{s[lang].sub}</small></span>
          <span aria-hidden="true" className={styles.arrow} data-reverse={s.to < s.from} data-reply={s.reply} />
        </span>
      </button>
    </Fragment>)}</div>
  </section>;
}
