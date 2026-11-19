"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RecordedNarration } from "@/components/marketing/restaurant/recordedNarration";
import { twentyBahtFlow } from "@/lib/learning/twentyBahtGuide";
import recordings from "./twentyBahtThaiAudio.json";
import g from "./twenty-baht.module.css";

export function TwentyBahtOverview({ lang }: { lang: "th" | "en" }) {
  const th = lang === "th";
  const t = (thai: string, english: string) => th ? thai : english;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);
  const [supported, setSupported] = useState(th);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<RecordedNarration>();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(0);
  const currentCue = useRef("");

  const stop = useCallback(() => {
    active.current++;
    currentCue.current = "";
    player.current?.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const playCue = useCallback((index: number, rate: number) => {
    const cueId = `${lang}:${index}:${rate}`;
    if (currentCue.current === cueId) return;
    currentCue.current = cueId;
    const key = ++active.current;
    const failed = () => { if (active.current === key) { stop(); setPlaying(false); setPaused(false); setError(true); } };
    const ended = () => {
      if (active.current !== key) return;
      if (index === twentyBahtFlow.length - 1) { stop(); setPlaying(false); }
      else setStep(index + 1);
    };
    if (th) {
      const caption = twentyBahtFlow[index].caption.th;
      const clip = (recordings as Record<string, { file: string; duration: number }>)[caption];
      if (!clip || !audio.current) { failed(); return; }
      player.current ??= new RecordedNarration(audio.current);
      player.current.play(`twenty:${index}:${rate}`, clip.file, rate, ended, failed);
    } else {
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) { failed(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(twentyBahtFlow[index].caption.en);
      utterance.lang = "en-US";
      utterance.rate = rate;
      utterance.onend = ended;
      utterance.onerror = failed;
      const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("en"));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
  }, [lang, stop, th]);

  useEffect(() => {
    setSupported(th ? twentyBahtFlow.every((node) => Boolean((recordings as Record<string, unknown>)[node.caption.th])) : "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    setPlaying(false); setPaused(false); setError(false); setStep(0);
    return stop;
  }, [th, stop]);

  useEffect(() => {
    if (playing && !paused) playCue(step, speed);
  }, [playing, paused, playCue, speed, step]);

  function toggle() {
    if (!supported || error) return;
    if (playing) {
      if (paused) {
        if (th) void player.current?.resume().then(() => setPaused(false)).catch(() => { stop(); setPlaying(false); setError(true); });
        else { window.speechSynthesis.resume(); setPaused(false); }
      } else { if (th) player.current?.pause(); else window.speechSynthesis.pause(); setPaused(true); }
      return;
    }
    playCue(step, speed); // Keep the first media play inside the user's gesture on mobile.
    setPlaying(true); setPaused(false);
  }

  function move(index: number) {
    stop(); setPlaying(false); setPaused(false); setError(false);
    setStep(Math.max(0, Math.min(index, twentyBahtFlow.length - 1)));
  }

  function closeDialog() { dialog.current?.close(); stop(); setPlaying(false); setPaused(false); }

  const controls = <div className={g.controls}>
    <button type="button" onClick={toggle} disabled={!supported || error} aria-pressed={playing && !paused}>{playing && !paused ? t("หยุดชั่วคราว", "Pause") : paused ? t("เล่นต่อ", "Resume") : t("▶ เล่นพร้อมเสียง", "▶ Play with audio")}</button>
    <button type="button" onClick={() => move(step - 1)} disabled={step === 0}>{t("ก่อนหน้า", "Previous")}</button>
    <button type="button" onClick={() => move(step + 1)} disabled={step === twentyBahtFlow.length - 1}>{t("ถัดไป", "Next")}</button>
    <button type="button" onClick={() => move(0)}>{t("เริ่มใหม่", "Restart")}</button>
    <label>{t("ความเร็ว", "Speed")} <select value={speed} onChange={(event) => { stop(); setPlaying(false); setPaused(false); setSpeed(Number(event.target.value)); }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
  </div>;

  const diagram = <ol className={g.flow} aria-label={t("ขั้นตอนร้าน 20 บาท", "Twenty-baht shop flow")}>
    {twentyBahtFlow.map((node, index) => <li key={node.title.en} data-active={step === index}>
      <button type="button" onClick={() => move(index)} aria-current={step === index ? "step" : undefined}>
        <span aria-hidden="true">{node.icon}</span><strong>{node.title[lang]}</strong><small>{index + 1} / {twentyBahtFlow.length}</small>
      </button>
    </li>)}
  </ol>;

  return <section className={g.overview} id="overview" aria-labelledby="twenty-flow-title">
    <audio ref={audio} preload="none" data-twenty-narration />
    <div className={g.overviewHead}><div><span className={g.pilot}>PILOT · {t("ตัวอย่าง", "EXAMPLE")}</span><h2 id="twenty-flow-title">{t("สแกน → ขาย → รับเข้า → ตรวจยอด", "Scan → sell → receive → reconcile")}</h2><p>{t("เลือกขั้นเพื่ออ่านคำบรรยาย หรือกดเล่นพร้อมเสียง", "Select a step to read its transcript, or play the narrated guide.")}</p></div><button type="button" onClick={() => dialog.current?.showModal()} className={g.fullscreen}>{t("ขยายแผนภาพ", "Expand diagram")}</button></div>
    {controls}
    <p className={g.audioNote} role="status">{error || !supported ? t("ไฟล์เสียงหรือเสียงอุปกรณ์ไม่พร้อม อ่านคำบรรยายด้านล่างได้", "Audio unavailable. The transcript remains below.") : th ? t("เสียงไทยเป็นไฟล์บันทึกที่ส่งมากับเว็บ · สร้างด้วย thai_som", "Thai narration is a hosted recording generated with thai_som") : "English narration uses your device voice."}</p>
    {diagram}
    <div className={g.transcript}><strong>{t("คำบรรยาย", "Transcript")} · {step + 1}/{twentyBahtFlow.length}</strong><p aria-live={playing ? "off" : "polite"}>{twentyBahtFlow[step].caption[lang]}</p></div>
    <dialog ref={dialog} className={g.dialog} onClose={() => { stop(); setPlaying(false); setPaused(false); }} aria-label={t("แผนภาพร้าน 20 บาท", "Twenty-baht shop diagram")}>
      <div className={g.dialogHead}><h2>{t("ขั้นตอนร้าน 20 บาท", "Twenty-baht shop workflow")}</h2><button type="button" onClick={closeDialog}>{t("ปิด", "Close")} ×</button></div>
      {diagram}{controls}<div className={g.transcript}><strong>{t("คำบรรยาย", "Transcript")} · {step + 1}/{twentyBahtFlow.length}</strong><p>{twentyBahtFlow[step].caption[lang]}</p></div>
    </dialog>
  </section>;
}
