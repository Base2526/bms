"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircleOutlined, CloudOutlined, DatabaseOutlined, DesktopOutlined, DownloadOutlined,
  FileProtectOutlined, HddOutlined, KeyOutlined, LinkOutlined, LockOutlined,
  PlayCircleOutlined, SafetyCertificateOutlined, SettingOutlined, ShopOutlined,
  ShoppingCartOutlined, SoundOutlined, SyncOutlined, UserSwitchOutlined, WifiOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { RecordedNarration } from "@/components/marketing/restaurant/recordedNarration";
import steps from "./guide-flow.json";
import audioMetadata from "./guide-audio.json";
import styles from "./guide.module.css";

const icons: Record<string, ReactNode> = {
  store: <ShopOutlined />, monitor: <DesktopOutlined />, "list-checks": <FileProtectOutlined />,
  globe: <CloudOutlined />, download: <DownloadOutlined />, "shield-check": <SafetyCertificateOutlined />,
  wifi: <WifiOutlined />, settings: <SettingOutlined />, "circle-check": <CheckCircleOutlined />,
  link: <LinkOutlined />, receipt: <FileProtectOutlined />, "shopping-cart": <ShoppingCartOutlined />,
  database: <DatabaseOutlined />, cloud: <CloudOutlined />, "key-round": <KeyOutlined />,
  "badge-check": <SafetyCertificateOutlined />, clock: <SyncOutlined />, "clipboard-check": <FileProtectOutlined />,
  "hard-drive": <HddOutlined />, "lock-keyhole": <LockOutlined />, "database-backup": <DatabaseOutlined />,
  "user-check": <UserSwitchOutlined />, "refresh-cw": <SyncOutlined />,
};
const findStep = (id?: string) => Math.max(0, steps.findIndex(step => step.id === id));
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function RetailLocalGuide({ initialStep = "prepare", followHash = false }: { initialStep?: string; followHash?: boolean }) {
  const { lang } = useI18n();
  const th = lang === "th";
  const [step, setStep] = useState(() => findStep(initialStep));
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(() => audioMetadata.durations[findStep(initialStep)]);
  const section = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<RecordedNarration>();
  const selected = useRef(step);
  const speed = useRef(1);
  const resumeAt = useRef(0);
  const current = resolveBilingual(steps[step], lang);
  const groups = th ? [
    ["start", "เริ่มเปิดร้าน", "ทำตามลำดับก่อนใช้งาน"],
    ["license", "ลงทะเบียนและซื้อสิทธิ์", "ทำภายหลังได้ ไม่ขวางการขาย"],
    ["care", "รักษาข้อมูลและดูแลเครื่อง", "สำรอง · กู้คืน · ย้าย · อัปเดต"],
  ] : [
    ["start", "Open your shop", "Prepare before serving customers"],
    ["license", "Registration and payment", "Optional later steps; sales continue"],
    ["care", "Protect data and maintain the host", "Back up · restore · transfer · update"],
  ];

  function pause() {
    if (audio.current?.src && Number.isFinite(audio.current.currentTime)) resumeAt.current = audio.current.currentTime;
    player.current?.stop();
    setPlaying(false);
  }
  function choose(target: number) {
    player.current?.stop();
    selected.current = target;
    resumeAt.current = 0;
    setStep(target); setPlaying(false); setFailed(false); setElapsed(0); setDuration(audioMetadata.durations[target]);
  }
  function start(target: number, offset = 0) {
    if (!audio.current) return;
    selected.current = target;
    resumeAt.current = offset;
    setStep(target); setFailed(false); setPlaying(true); setElapsed(offset); setDuration(audioMetadata.durations[target]);
    player.current ??= new RecordedNarration(audio.current);
    // Remains in the click gesture for mobile media permission. Subsequent tracks use the same element.
    player.current.play(`${target}:${speed.current}`, steps[target].audio, speed.current, () => {
      resumeAt.current = 0;
      if (target === steps.length - 1) { setPlaying(false); setElapsed(audioMetadata.durations[target]); }
      else start(target + 1);
    }, () => { setFailed(true); setPlaying(false); }, offset);
  }

  useEffect(() => {
    const element = audio.current;
    const update = () => {
      if (element?.src && Number.isFinite(element.duration)) {
        setDuration(element.duration); setElapsed(element.currentTime);
      }
    };
    const hidden = () => { if (document.hidden) pause(); };
    element?.addEventListener("timeupdate", update);
    element?.addEventListener("loadedmetadata", update);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      element?.removeEventListener("timeupdate", update);
      element?.removeEventListener("loadedmetadata", update);
      document.removeEventListener("visibilitychange", hidden);
      player.current?.stop();
    };
  }, []);

  useEffect(() => {
    choose(findStep(initialStep));
    if (!followHash) return;
    let scroll: number | undefined;
    const selectHash = () => {
      const id = window.location.hash.replace(/^#retail-local-guide-/, "");
      if (!steps.some(item => item.id === id)) return;
      choose(findStep(id));
      scroll = requestAnimationFrame(() => section.current?.scrollIntoView({ block: "start" }));
    };
    selectHash();
    window.addEventListener("hashchange", selectHash);
    return () => { window.removeEventListener("hashchange", selectHash); if (scroll !== undefined) cancelAnimationFrame(scroll); };
  }, [initialStep, followHash]);
  useEffect(() => { pause(); }, [lang]);

  const next = step < steps.length - 1 ? resolveBilingual(steps[step + 1], lang) : null;
  return <section id="retail-local-guide" ref={section} className={styles.guide} data-retail-local-guide aria-labelledby="retail-local-guide-title">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>{th ? "ฟังแล้วทำตาม · RETAIL LOCAL" : "LISTEN AND FOLLOW · RETAIL LOCAL"}</p>
        <h2 id="retail-local-guide-title">{th ? "เริ่มใช้ Retail Local อย่างมั่นใจ" : "Start using Retail Local with confidence"}</h2>
        <p className={styles.muted}>{th ? "เลือกตอนจากเส้นทาง แล้วทำตามเสียงและแผนภาพทีละขั้น" : "Choose a chapter from the journey, then follow its narration and diagram."}</p></div>
      <div className={styles.badges} aria-label={th ? "ข้อมูลคู่มือ" : "Guide details"}>
        <span>{steps.length} {th ? "ตอน" : "chapters"}</span>
        <span>{th ? "เสียงภาษาไทย" : "Thai audio"} · {time(audioMetadata.totalDuration)}</span>
        <span>{th ? "ไม่เล่นอัตโนมัติ" : "No autoplay"}</span>
      </div>
    </header>
    <div className={styles.guideLayout}>
      <nav className={styles.chapters} data-guide-chapters aria-label={th ? "เลือกตอนในคู่มือ" : "Guide chapters"}>
        <div className={styles.chapterHeading}><h3>{th ? "เส้นทางทั้งหมด" : "Complete journey"}</h3><span>{step + 1} / {steps.length}</span></div>
        {groups.map(([id, title, hint]) => <div className={styles.chapterGroup} key={id}><h3>{title}</h3><p>{hint}</p>
          {steps.map((entry, i) => entry.phase === id && <button key={entry.id} id={`retail-local-guide-${entry.id}`}
            data-guide-step={entry.id} aria-pressed={i === step} onClick={() => choose(i)}><span>{String(i + 1).padStart(2, "0")}</span><span>{resolveBilingual(entry, lang).title}</span>{i === step && <SoundOutlined aria-hidden />}</button>)}
        </div>)}
      </nav>
      <article className={styles.chapterCard} data-guide-chapter-card>
        <div className={styles.chapterTitle}>
          <span className={styles.chapterNumber}>{String(step + 1).padStart(2, "0")}</span>
          <div><p className={styles.eyebrow}>{groups.find(([id]) => id === steps[step].phase)?.[1]}</p><strong data-guide-title>{current.title}</strong></div>
          <span data-guide-counter>{step + 1} / {steps.length}</span>
        </div>
        <div className={styles.player} data-retail-guide-player>
          <audio ref={audio} preload="none" />
          <div className={styles.controls}>
            <button className={styles.primary} data-guide-play onClick={() => playing ? pause() : start(selected.current, resumeAt.current)}>
              <PlayCircleOutlined aria-hidden /> {playing ? (th ? "หยุดชั่วคราว" : "Pause") : failed ? (th ? "ลองเล่นอีกครั้ง" : "Retry audio") : resumeAt.current > 0 ? (th ? "ฟังต่อ" : "Resume") : (th ? "ฟังตอนนี้" : "Play chapter")}
            </button>
            <button data-guide-previous disabled={step === 0} onClick={() => choose(step - 1)}>{th ? "ก่อนหน้า" : "Previous"}</button>
            <button data-guide-next disabled={step === steps.length - 1} onClick={() => choose(step + 1)}>{th ? "ถัดไป" : "Next"}</button>
            <button data-guide-all onClick={() => { choose(0); start(0); }}>{th ? "ฟังตั้งแต่ต้น" : "Play all"}</button>
            <label>{th ? "ความเร็ว" : "Speed"} <select value={rate} data-guide-rate onChange={event => {
              const nextRate = Number(event.target.value); pause(); speed.current = nextRate; setRate(nextRate);
            }}>{[1, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
            <a href="/audio/retail-local/th/summary.mp3" download="bms-retail-local-th.mp3">{th ? "ดาวน์โหลดเสียงทั้งหมด" : "Download all Thai audio"}</a>
          </div>
          <div className={styles.progressRow}><progress aria-label={th ? "ความคืบหน้าของตอน" : "Chapter progress"} max={duration || 1} value={elapsed} /><span>{time(elapsed)} / {time(duration)}</span></div>
          <p className={styles.caption} data-guide-caption aria-live={playing ? "off" : "polite"}>{current.speech}</p>
          <p className={styles.voice} role="status" data-guide-status>{failed
            ? (th ? "โหลดเสียงไม่ได้ กดลองอีกครั้ง หรืออ่านคำบรรยายและเลือกตอนต่อไปได้" : "Audio could not load. Retry, or read the captions and choose another chapter.")
            : th ? "เสียงสังเคราะห์ภาษาไทย · ไม่เล่นอัตโนมัติเมื่อเปิดหน้า" : "Synthetic Thai narration; English captions. Audio starts only when you press Play."}</p>
        </div>
        <div className={styles.diagramSection}>
          <div className={styles.diagramLabel}><span>{th ? "แผนภาพของตอนนี้" : "Diagram for this chapter"}</span><span>{th ? "ทำจากซ้ายไปขวา" : "Follow left to right"}</span></div>
          <ol className={styles.diagram} data-guide-diagram data-separate-last={steps[step].separateLast || undefined} aria-label={th ? `ขั้นตอน: ${current.title}` : `Steps: ${current.title}`}>
            {current.nodes.map(([icon, title, detail], i) => <li key={`${steps[step].id}-${i}`}>
              <span className={styles.nodeIcon} aria-hidden>{icons[icon] ?? <CheckCircleOutlined />}</span><strong>{title}</strong><small>{detail}</small>
            </li>)}
          </ol>
          <p className={styles.outcome}><CheckCircleOutlined aria-hidden /> <span data-guide-outcome>{current.outcome}</span></p>
        </div>
        <div className={styles.nextChapter}>
          <span>{next ? (th ? "เสร็จแล้วไปขั้นต่อไป" : "Continue when ready") : (th ? "ครบทุกขั้นแล้ว" : "Journey complete")}</span>
          {next && <button onClick={() => choose(step + 1)}>{next.title} →</button>}
        </div>
      </article>
    </div>
    <p className={styles.footer}><SafetyCertificateOutlined aria-hidden />{th
      ? "Technical pilot · ติดตั้งได้โดยไม่ต้องมี Code · Trial หมดอายุไม่ล็อกการขายหรือการกู้ข้อมูล"
      : "Technical pilot · Install without a code · Trial expiry never locks sales or recovery"}</p>
  </section>;
}
