"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordedNarration } from "@/components/marketing/restaurant/recordedNarration";
import { LearningFlowFullscreen } from "../LearningFlowFullscreen";
import s from "../learning.module.css";
import g from "./factory-guide.module.css";
import audioManifest from "./factoryThaiAudio.json";
import { factoryLanes as lanes, factoryNodes as nodes, type Lang } from "@/lib/learning/factoryGuideFlow";

type Recording = { text: string; file: string; duration: number; sha256: string };
const recordings = audioManifest as Record<string, Recording>;

export function FactoryGuideOverview({ lang }: { lang: Lang }) {
  const th = lang === "th";
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const audioElement = useRef<HTMLAudioElement>(null);
  const audioPlayer = useRef<RecordedNarration>();
  const activeKey = useRef<string | null>(null);
  const recorded = lang === "th" && nodes.every((node, index) => recordings[String(index)]?.text === node.explanation.th);

  const stopAudio = useCallback(() => {
    activeKey.current = null;
    audioPlayer.current?.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const playStep = useCallback((target: number) => {
    const key = `${lang}:${target}:${speed}:${recorded ? "recorded" : "device"}`;
    if (activeKey.current === key) return;
    stopAudio();
    activeKey.current = key;
    const done = () => {
      if (activeKey.current !== key) return;
      activeKey.current = null;
      if (target === nodes.length - 1) setPlaying(false);
      else setStep(target + 1);
    };
    const failed = () => {
      if (activeKey.current !== key) return;
      stopAudio();
      setPlaying(false);
      setVoiceError(true);
    };
    if (recorded) {
      const clip = recordings[String(target)];
      if (!clip || !audioElement.current) { failed(); return; }
      audioPlayer.current ??= new RecordedNarration(audioElement.current);
      audioPlayer.current.play(key, clip.file, speed, done, failed);
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) { failed(); return; }
    const utterance = new SpeechSynthesisUtterance(nodes[target].explanation[lang]);
    utterance.lang = lang === "th" ? "th-TH" : "en-US";
    utterance.rate = speed;
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(lang));
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = failed;
    window.speechSynthesis.speak(utterance);
  }, [lang, recorded, speed, stopAudio]);

  useEffect(() => {
    setSpeechSupported(recorded || ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window));
    setVoiceError(false);
    setPlaying(false);
    return stopAudio;
  }, [lang, recorded, stopAudio]);

  useEffect(() => {
    if (!playing) return;
    playStep(step);
    return stopAudio;
  }, [playStep, playing, step, stopAudio]);

  useEffect(() => {
    if (!playing || document.querySelector("dialog[data-learning-fullscreen][open]")) return;
    const target = document.getElementById(`factory-flow-step-${step}`);
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }, [playing, step]);

  function move(next: number) {
    stopAudio();
    setPlaying(false);
    setVoiceError(false);
    setStep(Math.max(0, Math.min(next, nodes.length - 1)));
  }

  function togglePlaying() {
    if (playing) { stopAudio(); setPlaying(false); return; }
    if (!speechSupported) return;
    const target = step === nodes.length - 1 ? 0 : step;
    setVoiceError(false);
    if (target !== step) setStep(target);
    playStep(target);
    setPlaying(true);
  }

  function renderDiagram(fullscreen = false) {
    let offset = 0;
    return <div className={`${s.inventoryFlowDiagram} ${s.businessFlowDiagram} ${g.factoryFlowDiagram}`} data-track="factory">
      {lanes.map((lane, laneIndex) => {
        const start = offset;
        offset += lane.nodes.length;
        return <div className={`${s.inventoryFlowLane} ${s.businessFlowLane} ${g.factoryFlowLane}`} key={lane.label.en}>
          <span className={s.inventoryFlowBranch} aria-hidden="true">{laneIndex === 0 ? "" : "↳"}</span>
          <div className={g.laneContent}>
            <span className={g.laneLabel}>{lane.label[lang]}</span>
            <ol style={{ "--flow-columns": String(lane.nodes.length) } as CSSProperties}>
              {lane.nodes.map((node, index) => {
                const current = start + index;
                const active = step === current;
                return <li key={node.title.en} id={fullscreen ? undefined : `factory-flow-step-${current}`} data-tone={node.tone} data-active={active} data-flow-active={active}>
                  <button type="button" className={g.flowNode} onClick={() => move(current)} aria-current={active ? "step" : undefined}>
                    <span className={s.inventoryFlowIcon} aria-hidden="true">{node.icon}</span>
                    <span><strong>{node.title[lang]}</strong><small>{node.detail[lang]}</small></span>
                  </button>
                  {index < lane.nodes.length - 1 && <span className={s.inventoryFlowArrow} aria-hidden="true">→</span>}
                </li>;
              })}
            </ol>
          </div>
        </div>;
      })}
    </div>;
  }

  return <section className={`${s.inventoryOverview} ${s.businessOverview} ${g.factoryOverview}`} aria-labelledby="factory-overview-title">
    <div className={s.inventoryOverviewHeading}>
      <div>
        <span className={s.inventoryAiEyebrow}>FACTORY · PILOT</span>
        <h2 id="factory-overview-title">{th ? "จากสมัครกิจการถึงสต็อกโรงงาน" : "From signup to factory stock"}</h2>
        <p>{th ? "ภาพจำลองขั้นตอนสำหรับสายเชือกและสายหลอด กดแต่ละกล่องเพื่ออ่านคำอธิบาย" : "A visual walkthrough for twine and straw production. Select any box for details."}</p>
      </div>
      <div className={s.inventoryNarration}>
        <button type="button" onClick={togglePlaying} disabled={!speechSupported || voiceError} aria-pressed={playing}>{playing ? (th ? "❚❚ หยุดเสียง" : "❚❚ Pause audio") : (th ? "▶ เล่นพร้อมเสียง" : "▶ Play with audio")}</button>
        <span role="status">{voiceError || !speechSupported ? (th ? "เล่นเสียงไม่ได้ กรุณาเลือกขั้นเพื่ออ่านคำบรรยาย" : "Audio unavailable; select a step to read its caption.") : recorded ? (th ? "เสียงไทยสร้างด้วย Google AI Studio · Gemini 3.8 Flash TTS" : "Thai audio generated with Gemini 3.8 Flash TTS") : (th ? "เสียงไทยจากอุปกรณ์ ขณะรอไฟล์ Google AI Studio" : "Device narration; Google AI Studio clips pending")}</span>
      </div>
    </div>
    <audio ref={audioElement} preload="none" data-factory-narration />
    <nav className={`${s.inventoryJumpLinks} ${g.flowTabs}`} aria-label={th ? "หัวข้อคู่มือโรงงาน" : "Factory guide sections"}>
      <a href="#factory-flow">{th ? "ภาพรวม" : "Overview"}</a>
      <a href="#bom">{th ? "สูตรผลิต" : "BOMs"}</a>
      <a href="#production">{th ? "ใบผลิตและ QC" : "Batches and QC"}</a>
      <a href="#stock">{th ? "สต็อก" : "Stock"}</a>
    </nav>
    <section className={s.inventoryFlowPanel} id="factory-flow" aria-labelledby="factory-flow-title">
      <div className={s.flowPanelHeading}>
        <h3 id="factory-flow-title">{th ? "Flow โรงงานเชือกและหลอดพลาสติก" : "Twine and straw factory flow"}</h3>
        <LearningFlowFullscreen
          lang={lang} title={th ? "Flow โรงงานเชือกและหลอดพลาสติก" : "Twine and straw factory flow"}
          cueText={nodes[step].explanation[lang]} step={step} total={nodes.length}
          playing={playing} canPlay={speechSupported && !voiceError} onTogglePlaying={togglePlaying}
          onPrevious={() => move(step - 1)} onNext={() => move(step + 1)}
          renderDiagram={() => renderDiagram(true)}
          playLabel={th ? "เล่นพร้อมเสียง" : "Play with audio"}
          followLabel={th ? "ติดตามขั้นตอน" : "Follow steps"}
          detailNote={th ? "ตัวเลขเป็นตัวอย่าง · ส่วนขยายโรงงานยังอยู่ใน branch ทดสอบ" : "Example quantities · the factory extension remains on a test branch"}
        />
      </div>
      <div className={s.inventoryPlayback} data-playing={playing}>
        <div className={s.inventoryPlaybackHeading}>
          <span>{th ? "ขั้น" : "Step"} {step + 1} / {nodes.length}</span>
          <div className={s.inventoryPlaybackControls}>
            <button type="button" onClick={() => move(step - 1)} disabled={step === 0}>{th ? "ก่อนหน้า" : "Previous"}</button>
            <button type="button" onClick={() => move(step + 1)} disabled={step === nodes.length - 1}>{th ? "ถัดไป" : "Next"}</button>
            <button type="button" onClick={() => move(0)}>{th ? "เริ่มใหม่" : "Restart"}</button>
            <label>{th ? "ความเร็ว" : "Speed"}<select value={speed} onChange={(event) => { stopAudio(); setPlaying(false); setSpeed(Number(event.target.value)); }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
          </div>
        </div>
        <p aria-live={playing ? "off" : "polite"}>{nodes[step].explanation[lang]}</p>
      </div>
      {renderDiagram()}
      <p className={g.flowNote}>{th ? "จุดสีเขียวคือการรับเข้าหรือโพสต์ผลผลิตที่เปลี่ยนยอดทางกายภาพ ส่วนการตั้ง SKU, BOM และใบผลิตยังไม่เปลี่ยนสต็อก การสร้างออร์เดอร์จองของก่อนส่ง" : "Green steps change physical stock through receipt or production posting. SKUs, BOMs and batches do not move stock. Order creation reserves goods before shipment."}</p>
    </section>
  </section>;
}
