"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RecordedNarration } from "@/components/marketing/restaurant/recordedNarration";
import { businessGuideFlows, businessNarrationCues, type BusinessTrackId, type GuideLang } from "@/lib/learning/businessGuideFlow";
import audioManifest from "./businessThaiAudio.json";
import { LearningFlowFullscreen } from "./LearningFlowFullscreen";
import s from "./learning.module.css";

type Recording = { file: string; duration: number };
const recordings: Record<string, Recording> = audioManifest;

const ui = {
  th: {
    play: "▶ เล่นพร้อมภาพ", pause: "หยุดชั่วคราว", previous: "ก่อนหน้า", next: "ถัดไป", restart: "เริ่มใหม่",
    step: "ขั้น", speed: "ความเร็ว", recorded: "เสียงไทยใช้เสียงชุดเดียวกับคู่มือ Restaurant และจุดใน Flow จะ Focus ตามคำบรรยาย",
    unavailable: "เล่นเสียงไม่ได้ แต่ยังเลือกดูแต่ละขั้นได้", overview: "ภาพรวม", customer: "สำหรับลูกค้า", owner: "สำหรับเจ้าของร้าน",
    aiTitle: "AI ช่วยลูกค้าและเจ้าของร้านคนละขอบเขต", connected: "ต้องเชื่อมต่อและเปิดใช้งาน", permission: "ตรวจสิทธิ์ก่อนอ่านข้อมูล",
    customerAsks: "ลูกค้าถาม", aiTools: "AI เรียกเครื่องมือ", approvedFacts: "ตอบข้อมูลที่อนุญาต", canDo: "สิ่งที่ AI ทำได้",
    sample: "ตัวอย่างโครงสร้างคำตอบ", sampleNotice: "เมื่อใช้งานจริง ตัวเลขมาจากข้อมูลที่ตรวจสอบแล้ว", export: "Export report",
    adminAnalysis: "AI ช่วย Admin วิเคราะห์ได้",
    authority: "ข้อมูลสำคัญที่ควรรู้", learnMore: "เปิดบทเรียนที่เกี่ยวข้อง",
  },
  en: {
    play: "▶ Play with visual", pause: "Pause", previous: "Previous", next: "Next", restart: "Restart",
    step: "Step", speed: "Speed", recorded: "Thai uses the same recorded voice as the Restaurant guide; each spoken cue focuses its flow node.",
    unavailable: "Audio is unavailable, but every step remains selectable.", overview: "Overview", customer: "For customers", owner: "For owners",
    aiTitle: "AI helps customers and owners within different boundaries", connected: "Must be connected and enabled", permission: "Permission checked before every read",
    customerAsks: "Customer asks", aiTools: "AI calls a tool", approvedFacts: "Approved facts only", canDo: "What AI can do",
    sample: "Sample answer structure", sampleNotice: "Live use replaces these labels with verified system data.", export: "Export report",
    adminAnalysis: "What Admin can ask AI to analyze",
    authority: "Important authority boundaries", learnMore: "Open the related lesson",
  },
} as const;

export function BusinessGuideOverview({ track, lang }: { track: BusinessTrackId; lang: GuideLang }) {
  const config = businessGuideFlows[track];
  const t = ui[lang];
  const cues = useMemo(() => businessNarrationCues(track, lang), [lang, track]);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const audioElement = useRef<HTMLAudioElement>(null);
  const audioPlayer = useRef<RecordedNarration>();
  const recorded = lang === "th";
  const cue = cues[step];

  const stopAudio = useCallback(() => {
    audioPlayer.current?.stop();
    if (!recorded && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [recorded]);

  const startRecorded = useCallback((target: number) => {
    const recording = recordings[cues[target].text];
    if (!recording || !audioElement.current) {
      setVoiceError("file");
      setPlaying(false);
      return;
    }
    audioPlayer.current ??= new RecordedNarration(audioElement.current);
    audioPlayer.current.play(`${track}:${target}:${recording.file}:${speed}`, recording.file, speed, () => {
      if (target >= cues.length - 1) setPlaying(false);
      else setStep(target + 1);
    }, (reason) => {
      setVoiceError(reason);
      setPlaying(false);
    });
  }, [cues, speed, track]);

  useEffect(() => {
    const supported = recorded
      ? cues.every((item) => Boolean(recordings[item.text]))
      : typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    setSpeechSupported(supported);
    setPlaying(false);
    setStep(0);
    setVoiceError(null);
    return stopAudio;
  }, [cues, recorded, stopAudio, track]);

  useEffect(() => {
    if (!playing) return;
    if (recorded) {
      startRecorded(step);
      return () => audioPlayer.current?.stop();
    }
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    let closed = false;
    const utterance = new SpeechSynthesisUtterance(cue.text);
    utterance.lang = "en-US";
    utterance.rate = speed;
    const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (closed) return;
      if (step >= cues.length - 1) setPlaying(false);
      else setStep(step + 1);
    };
    utterance.onerror = (event) => {
      if (closed) return;
      setVoiceError(event.error || "failed");
      setPlaying(false);
    };
    synth.cancel();
    synth.speak(utterance);
    return () => { closed = true; synth.cancel(); };
  }, [cue.text, cues.length, playing, recorded, speechSupported, speed, startRecorded, step]);

  useEffect(() => {
    if (!playing || document.querySelector("dialog[data-learning-fullscreen][open]")) return;
    const target = document.getElementById(`${track}-flow-${cue.target}`);
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }, [cue.target, playing, track]);

  function toggleNarration() {
    if (!speechSupported || voiceError) return;
    if (playing) {
      stopAudio();
      setPlaying(false);
      return;
    }
    if (recorded) startRecorded(step);
    setPlaying(true);
  }

  function move(next: number) {
    stopAudio();
    setPlaying(false);
    setVoiceError(null);
    setStep(Math.min(Math.max(next, 0), cues.length - 1));
  }

  function renderDiagram(fullscreen = false) {
    return <div className={`${s.inventoryFlowDiagram} ${s.businessFlowDiagram}`} data-track={track}>
      {config.lanes.map((lane, laneIndex) => <div className={`${s.inventoryFlowLane} ${s.businessFlowLane}`} key={lane[0].target}>
        <span className={s.inventoryFlowBranch} aria-hidden="true">{laneIndex === 0 ? "" : "↳"}</span>
        <ol style={{ "--flow-columns": String(lane.length) } as CSSProperties}>
          {lane.map((item, index) => {
            const active = item.target === cue.target;
            return <li
              key={item.target}
              id={fullscreen ? undefined : `${track}-flow-${item.target}`}
              data-active={active}
              data-flow-active={active}
              data-tone={item.tone}
              aria-current={active ? "step" : undefined}
            >
              {active && playing && <span className={s.inventoryFlowSpeaker} aria-hidden="true">♪</span>}
              {item.ai && <span className={s.inventoryFlowAiBadge}><b aria-hidden="true">✦</b> {item.ai === "customer" ? (lang === "th" ? "AI ลูกค้า" : "Customer AI") : (lang === "th" ? "AI เจ้าของร้าน" : "Owner AI")}</span>}
              <span className={s.inventoryFlowIcon} aria-hidden="true">{item.icon}</span>
              <div><strong>{item.title[lang]}</strong><small>{item.description[lang]}</small></div>
              {index < lane.length - 1 && <span className={s.inventoryFlowArrow} aria-hidden="true">→</span>}
            </li>;
          })}
        </ol>
      </div>)}
    </div>;
  }

  return <section className={`${s.inventoryOverview} ${s.businessOverview}`} aria-labelledby={`${track}-overview-title`}>
    <div className={s.inventoryOverviewHeading}>
      <div>
        <span className={s.inventoryAiEyebrow}>{config.eyebrow}</span>
        <h2 id={`${track}-overview-title`}>{config.heading[lang]}</h2>
        <p>{config.description[lang]}</p>
      </div>
      <div className={s.inventoryNarration}>
        <button type="button" onClick={toggleNarration} disabled={!speechSupported || Boolean(voiceError)} aria-pressed={playing}>{playing ? t.pause : t.play}</button>
        <span role="status">{!speechSupported || voiceError ? t.unavailable : t.recorded}</span>
      </div>
    </div>
    {recorded && <audio ref={audioElement} preload="none" data-business-recorded-narration={track} />}

    <nav className={s.inventoryJumpLinks} aria-label={lang === "th" ? "ข้ามไปยังส่วนของภาพรวม" : "Overview sections"}>
      <a href={`#${track}-flow`}>{t.overview}</a><a href={`#${track}-customer-ai`}>{t.customer}</a><a href={`#${track}-owner-ai`}>{t.owner}</a>
    </nav>

    <section className={s.inventoryFlowPanel} id={`${track}-flow`} aria-labelledby={`${track}-flow-title`}>
      <div className={s.flowPanelHeading}>
        <h3 id={`${track}-flow-title`}>{config.flowTitle[lang]}</h3>
        <LearningFlowFullscreen
          lang={lang}
          title={config.flowTitle[lang]}
          cueText={cue.text}
          step={step}
          total={cues.length}
          playing={playing}
          canPlay={speechSupported && !voiceError}
          onTogglePlaying={toggleNarration}
          onPrevious={() => move(step - 1)}
          onNext={() => move(step + 1)}
          renderDiagram={() => renderDiagram(true)}
        />
      </div>
      <div className={s.inventoryPlayback} data-playing={playing}>
        <div className={s.inventoryPlaybackHeading}>
          <span>{t.step} {step + 1} / {cues.length}</span>
          <div className={s.inventoryPlaybackControls}>
            <button type="button" onClick={() => move(step - 1)} disabled={step === 0}>{t.previous}</button>
            <button type="button" onClick={() => move(step + 1)} disabled={step === cues.length - 1}>{t.next}</button>
            <button type="button" onClick={() => move(0)}>{t.restart}</button>
            <label>{t.speed}<select value={speed} onChange={(event) => { stopAudio(); setPlaying(false); setSpeed(Number(event.target.value)); }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
          </div>
        </div>
        <p aria-live={playing ? "off" : "polite"}>{cue.text}</p>
      </div>
      {renderDiagram()}
      <p className={s.inventoryFlowNote}><span aria-hidden="true">▣</span> {config.flowNote[lang]}</p>
    </section>

    <h3 className={s.inventoryAiTitle}><span aria-hidden="true">✦</span> {t.aiTitle}</h3>
    <div className={s.inventoryAiGrid}>
      <section className={`${s.inventoryAudienceCard} ${s.inventoryCustomerCard}`} id={`${track}-customer-ai`} data-active={cue.target === config.customer.focusTarget} aria-current={cue.target === config.customer.focusTarget ? "step" : undefined}>
        <div className={s.inventoryAudienceHeading}><h4><span aria-hidden="true">●</span> {config.customer.title[lang]}</h4><span>{t.connected}</span></div>
        <div className={s.inventoryChannels}><span>LINE OA</span><span>Facebook</span><span>Instagram</span><span>Web chat</span></div>
        <div className={s.inventoryCustomerPath}><span>{t.customerAsks}</span><b aria-hidden="true">→</b><span>{t.aiTools}</span><b aria-hidden="true">→</b><span>{t.approvedFacts}</span></div>
        <div className={s.inventoryChatExample}><p><strong>{lang === "th" ? "ลูกค้า" : "Customer"}</strong>{config.customer.question[lang]}</p><p><strong>AI</strong>{config.customer.answer[lang]}</p></div>
        <strong className={s.businessCapabilityTitle}>{t.canDo}</strong>
        <ul className={s.inventoryCapabilities}>{config.customer.capabilities[lang].map((item) => <li key={item}>{item}</li>)}</ul>
        <p className={s.inventoryAudienceLimit}><span aria-hidden="true">🔒</span> {config.customer.limit[lang]}</p>
      </section>

      <section className={`${s.inventoryAudienceCard} ${s.inventoryOwnerCard}`} id={`${track}-owner-ai`} data-active={cue.target === config.owner.focusTarget} aria-current={cue.target === config.owner.focusTarget ? "step" : undefined}>
        <div className={s.inventoryAudienceHeading}><h4><span aria-hidden="true">●</span> {config.owner.title[lang]}</h4><span>{t.permission}</span></div>
        <blockquote className={s.inventoryOwnerQuestion}>{config.owner.question[lang]}</blockquote>
        <strong className={s.businessCapabilityTitle}>{t.adminAnalysis}</strong>
        <ul className={s.inventoryCapabilities}>{config.owner.analyses[lang].map((item) => <li key={item}>{item}</li>)}</ul>
        <div className={s.inventoryReportExample}>
          <div className={s.inventorySampleHeading}><span>{t.sample}</span><strong>{t.sampleNotice}</strong></div>
          <dl>{config.owner.metrics[lang].map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
          <div className={s.inventoryExportRow}><span>{t.export}</span>{config.owner.formats.map((format) => <b key={format}>{format}</b>)}</div>
        </div>
        <p className={s.inventoryAudienceLimit}><span aria-hidden="true">🔒</span> {config.owner.limit[lang]}</p>
      </section>
    </div>

    <section className={s.businessAuthority} aria-labelledby={`${track}-authority-title`}>
      <h3 id={`${track}-authority-title`}><span aria-hidden="true">!</span> {t.authority}</h3>
      <ul>{config.authority[lang].map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
    <div className={s.inventoryArchitecture} aria-label={lang === "th" ? "ภาพรวมสถาปัตยกรรมการทำงาน" : "Workflow architecture"}>
      {config.architecture[lang].map((item, index) => <span key={item}>{item}{index < config.architecture[lang].length - 1 && <b aria-hidden="true">→</b>}</span>)}
    </div>
    <Link className={s.inventoryGuideLink} href={`/learn/guides/${config.guideSlug}?track=${track}`}>{t.learnMore} →</Link>
  </section>;
}
