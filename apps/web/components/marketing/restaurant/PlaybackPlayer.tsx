"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lang } from "@/i18n";
import { compilePlayback } from "./playback";
import type { Sequence } from "./sequence";
import styles from "./restaurant.module.css";

export type PlayerCopy = {
  heading: string; description: string; condition: string; optional: string; include: string;
  play: string; pause: string; previous: string; next: string; restart: string;
  sound: string; speed: string; step: string; of: string; voiceNotice: string; silentNotice: string;
  failedNotice: string; repeatOnce: string; resumeNotice: string;
};

export default function PlaybackPlayer({ sequence, lang, copy, introduction, conclusion, onActive }: {
  sequence: Sequence; lang: Lang; copy: PlayerCopy; introduction: string; conclusion: string;
  onActive: (index: number | undefined) => void;
}) {
  const [selections, setSelections] = useState<Record<number, number>>({});
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true), [speed, setSpeed] = useState(1);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const plan = useMemo(() => compilePlayback(sequence, selections), [sequence, selections]);
  const people = useMemo(() => new Map(sequence.participants.map(p => [p.id, p.label])), [sequence]);
  const cues = useMemo(() => [
    { index: -1, kind: "note" as const, label: introduction },
    ...plan.cues,
    { index: -1, kind: "note" as const, label: conclusion },
  ], [plan, introduction, conclusion]);
  const cue = cues[Math.min(step, cues.length - 1)];
  useEffect(() => {
    const synth = window.speechSynthesis;
    const refresh = () => setSpeechSupported(Boolean(synth && window.SpeechSynthesisUtterance &&
      synth.getVoices().some(voice => voice.lang.toLowerCase().startsWith(lang === "th" ? "th" : "en"))));
    refresh();
    synth?.addEventListener("voiceschanged", refresh);
    return () => synth?.removeEventListener("voiceschanged", refresh);
  }, [lang]);
  useEffect(() => { onActive(cue.index >= 0 ? cue.index : undefined); }, [cue.index, onActive]);
  useEffect(() => {
    if (!playing) return;
    let closed = false;
    let scheduled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const finish = () => {
      if (closed) return;
      closed = true;
      if (step >= cues.length - 1) setPlaying(false);
      else setStep(step + 1);
    };
    const advance = () => {
      if (closed || scheduled) return;
      scheduled = true;
      clearTimeout(watchdog);
      const remaining = Math.max(0, 1500 - (Date.now() - started));
      timer = setTimeout(finish, remaining);
    };
    const spoken = cue.kind === "message"
      ? `${people.get(cue.from ?? "") ?? ""}. ${cue.label}`
      : cue.kind === "loop" ? `${copy.repeatOnce}. ${cue.label}` : cue.label;
    const wait = Math.max(1800, Math.min(9000, spoken.length * 85 / speed));
    if (sound && speechSupported && !voiceFailed) {
      const synth = window.speechSynthesis;
      const failed = () => { if (!closed && !scheduled) setVoiceFailed(true); };
      try {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = lang === "th" ? "th-TH" : "en-US";
        utterance.rate = speed;
        const voice = synth.getVoices().find(item => item.lang.toLowerCase().startsWith(lang === "th" ? "th" : "en"));
        if (voice) utterance.voice = voice;
        // Some engines never report an error or completion. Fall back to caption timing.
        watchdog = setTimeout(failed, 5000);
        utterance.onstart = () => {
          if (closed || scheduled) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(failed, Math.max(20000, spoken.length * 250 / speed));
        };
        utterance.onend = advance;
        utterance.onerror = failed;
        synth.cancel();
        synth.speak(utterance);
      } catch { failed(); }
    } else timer = setTimeout(finish, wait);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      clearTimeout(watchdog);
      if (sound && speechSupported) window.speechSynthesis.cancel();
    };
  }, [playing, step, cues, sound, speechSupported, voiceFailed, speed, lang, people, copy.repeatOnce]);
  useEffect(() => {
    const stop = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", stop);
    return () => document.removeEventListener("visibilitychange", stop);
  }, []);
  const changeChoice = (id: number, value: number) => {
    setPlaying(false); setStep(0); setSelections(previous => ({ ...previous, [id]: value }));
  };
  const move = (next: number) => { setPlaying(false); setStep(Math.min(Math.max(next, 0), cues.length - 1)); };
  return <section className={styles.player} aria-label={copy.heading} data-restaurant-player>
    <div className={styles.playerHeading}><div><h4>{copy.heading}</h4><p>{copy.description}</p></div>
      <span className={styles.stepCount}>{copy.step} {step + 1} {copy.of} {cues.length}</span></div>
    {plan.choices.length > 0 && <div className={styles.playerChoices}>
      {plan.choices.map(choice => choice.kind === "alt" ? <label key={choice.id}>
        <span>{copy.condition}</span>
        <select value={choice.selected} onChange={event => changeChoice(choice.id, Number(event.target.value))}>
          {choice.options.map((option, index) => <option value={index} key={index}>{option}</option>)}
        </select>
      </label> : <label key={choice.id} className={styles.optionalChoice}>
        <input type="checkbox" checked={choice.selected === 1} onChange={event => changeChoice(choice.id, event.target.checked ? 1 : 0)} />
        <span>{copy.optional}: {choice.label}</span>
      </label>)}
    </div>}
    <div className={styles.currentCue} data-player-step={step} aria-live={playing && sound && speechSupported && !voiceFailed ? "off" : "polite"} aria-atomic="true">
      {cue.kind === "message" ? <div key={step} className={styles.cueActors} data-playing={playing}>
        <span>{people.get(cue.from ?? "")}</span><span className={styles.cueArrow} aria-hidden="true">{cue.from === cue.to ? "↻" : "→"}</span><span>{people.get(cue.to ?? "")}</span>
      </div> : <span className={styles.cueKind}>{cue.kind === "loop" ? copy.repeatOnce : cue.kind === "condition" ? copy.condition : copy.heading}</span>}
      <p>{cue.label}</p>
    </div>
    <div className={styles.playerControls}>
      <button type="button" className={styles.primaryButton} onClick={() => { if (!playing && step === cues.length - 1) setStep(0); setPlaying(!playing); }}>{playing ? copy.pause : copy.play}</button>
      <button type="button" className={styles.button} onClick={() => move(step - 1)} disabled={step === 0}>{copy.previous}</button>
      <button type="button" className={styles.button} onClick={() => move(step + 1)} disabled={step === cues.length - 1}>{copy.next}</button>
      <button type="button" className={styles.button} onClick={() => move(0)}>{copy.restart}</button>
      <label className={styles.playerSetting}><input type="checkbox" checked={sound && speechSupported && !voiceFailed} disabled={!speechSupported} onChange={event => { setSound(event.target.checked); setVoiceFailed(false); }} />{copy.sound}</label>
      <label className={styles.playerSetting}>{copy.speed}<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
        <option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option>
      </select></label>
    </div>
    <p className={styles.voiceNotice} role="status">{voiceFailed ? copy.failedNotice : speechSupported ? copy.voiceNotice : copy.silentNotice} {copy.resumeNotice}</p>
  </section>;
}
