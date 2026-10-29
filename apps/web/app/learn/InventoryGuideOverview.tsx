"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordedNarration } from "@/components/marketing/restaurant/recordedNarration";
import { inventoryNarrationCues, type InventoryNarrationTarget } from "@/lib/learning/inventoryNarration";
import thaiAudio from "./inventoryThaiAudio.json";
import { LearningFlowFullscreen } from "./LearningFlowFullscreen";
import s from "./learning.module.css";
import { localizedPublicPath } from "@/lib/publicSeo";

type Lang = "th" | "en";
const recordings: Record<string, { file: string; duration: number }> = thaiAudio;

const copy = {
  th: {
    title: "สต็อกและ AI ทำงานร่วมกันอย่างไร",
    description: "เข้าใจการไหลของสินค้า และดูว่า AI ช่วยลูกค้ากับเจ้าของร้านตรงไหน",
    play: "▶ เล่นพร้อมภาพ",
    pause: "หยุดชั่วคราว",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    restart: "เริ่มใหม่",
    step: "ขั้น",
    of: "/",
    speed: "ความเร็ว",
    recordedNotice: "ใช้เสียงไทยชุดเดียวกับคู่มือ Restaurant และเน้นภาพตามช่วงที่กำลังพูด",
    unsupported: "เล่นเสียงไม่ได้ แต่ยังเลือกดูแต่ละขั้นได้",
    jumpOverview: "ภาพรวม",
    jumpCustomer: "สำหรับลูกค้า",
    jumpOwner: "สำหรับเจ้าของร้าน",
    flowTitle: "Flow สต็อกและคลังสินค้า",
    flowNote: "ทุกการเปลี่ยนยอดมีเอกสาร สิทธิ์ผู้ทำรายการ และประวัติตรวจสอบ",
    aiTitle: "AI ใช้งานจริง 2 เส้นทาง",
    customerTitle: "ลูกค้าทักผ่านช่องทางที่ร้านเปิด",
    customerStatus: "ต้องเชื่อมต่อและเปิดใช้งาน",
    customerQuestion: "Runner X ไซซ์ 42 มีไหม?",
    customerAnswer: "AI ตรวจสินค้า ไซซ์ ราคา และสาขาจากข้อมูลร้านก่อนตอบ",
    customerLimit: "ลูกค้าไม่เห็นยอดขาย รายงาน หรือข้อมูลหลังบ้าน",
    ownerTitle: "เจ้าของถามผู้ช่วย AI หลังบ้าน",
    ownerStatus: "ตรวจสิทธิ์ก่อนอ่านข้อมูล",
    ownerQuestion: "เดือนนี้สินค้าตัวไหนขายดีที่สุด และยอดขายรวมเท่าไร?",
    adminAnalysis: "AI ช่วย Admin วิเคราะห์ได้",
    sample: "ตัวอย่างคำตอบ",
    period: "1–28 ต.ค. 2569 · ทุกสาขา",
    sales: "ยอดขายรวม",
    top: "ขายดีที่สุด",
    risk: "เสี่ยงของหมด",
    evidence: "คำตอบจริงต้องระบุช่วงเวลา สาขา หน่วย และข้อจำกัดของข้อมูล",
    export: "Export report",
    ownerLimit: "AI สรุปและสร้างไฟล์ แต่ไม่เปลี่ยนยอดหรือสร้างรายการโดยไม่ยืนยัน",
    architectureNote: "ลูกค้าและเจ้าของใช้ AI คนละสิทธิ์ และเห็นข้อมูลคนละชุด",
    learnMore: "อ่านรายละเอียด AI และรายงาน",
  },
  en: {
    title: "How inventory and AI work together",
    description: "Follow the stock lifecycle and see where AI helps customers and shop owners.",
    play: "▶ Play with visual",
    pause: "Pause",
    previous: "Previous",
    next: "Next",
    restart: "Restart",
    step: "Step",
    of: "of",
    speed: "Speed",
    recordedNotice: "The visual follows each spoken cue. Thai uses the same recorded voice as the Restaurant guide.",
    unsupported: "Audio is unavailable, but you can still select each step.",
    jumpOverview: "Overview",
    jumpCustomer: "For customers",
    jumpOwner: "For shop owners",
    flowTitle: "Inventory & warehouse flow",
    flowNote: "Every balance change has a document, an authorized actor and an audit trail.",
    aiTitle: "Two practical AI paths",
    customerTitle: "Customers message an enabled shop channel",
    customerStatus: "Must be connected and enabled",
    customerQuestion: "Is Runner X available in size 42?",
    customerAnswer: "AI verifies the product, size, price and branch in shop data before replying.",
    customerLimit: "Customers never see sales totals, reports or back-office data.",
    ownerTitle: "Owners ask the back-office AI assistant",
    ownerStatus: "Permissions checked before every read",
    ownerQuestion: "Which product sold best this month, and what were total sales?",
    adminAnalysis: "What Admin can ask AI to analyze",
    sample: "Sample answer",
    period: "Oct 1–28, 2026 · All branches",
    sales: "Total sales",
    top: "Top seller",
    risk: "Stockout risk",
    evidence: "A real answer must state the period, branch, units and data limitations.",
    export: "Export report",
    ownerLimit: "AI summarizes and creates files, but never changes balances or creates records without confirmation.",
    architectureNote: "Customer and owner AI use different permissions and see different data.",
    learnMore: "Read the AI and reporting guide",
  },
} as const;

type FlowNode = { target: InventoryNarrationTarget; icon: string; title: string; description: string; tone?: "green" | "orange" | "red" | "purple" };
type FlowLanes = { main: FlowNode[]; transfer: FlowNode[]; count: FlowNode[] };

const flowLanes: Record<Lang, FlowLanes> = {
  th: {
    main: [
      { target: "product", icon: "◆", title: "สินค้า / SKU", description: "ตั้งข้อมูลสินค้าและหน่วยนับ" },
      { target: "receiving", icon: "▰", title: "PO และรับเข้า", description: "สั่งซื้อและรับสินค้าเข้าคลัง" },
      { target: "sellable", icon: "⬢", title: "สต็อกพร้อมขาย", description: "พร้อมจำหน่ายตามสาขา", tone: "green" },
      { target: "reservation", icon: "▣", title: "จองจากออร์เดอร์", description: "หน้าร้าน / LINE OA / Social" },
      { target: "handoff", icon: "▾", title: "ชำระ / ส่งมอบ", description: "ชำระเงินและส่งสินค้า" },
      { target: "deduction", icon: "✓", title: "ตัดสต็อก", description: "ยอดลดจากคลังอัตโนมัติ", tone: "green" },
    ],
    transfer: [
      { target: "transfer", icon: "▰", title: "โอนระหว่างสาขา", description: "ขอโอนและอนุมัติ" },
      { target: "transit", icon: "▰", title: "ระหว่างทาง", description: "สินค้ารอปลายทางรับ", tone: "orange" },
      { target: "outcome", icon: "!", title: "รับจริง / กักกัน / สูญหาย", description: "ตรวจรับและบันทึกผล", tone: "red" },
    ],
    count: [
      { target: "snapshot", icon: "▥", title: "Snapshot", description: "บันทึกยอด ณ วันเวลา", tone: "purple" },
      { target: "physical-count", icon: "▣", title: "นับจริง", description: "นับตามหน้างาน" },
      { target: "approve-delta", icon: "●", title: "อนุมัติผลต่าง", description: "ผู้มีสิทธิ์ตรวจสอบ", tone: "orange" },
      { target: "adjust-delta", icon: "▤", title: "ปรับ Delta", description: "ปรับเฉพาะส่วนต่าง" },
    ],
  },
  en: {
    main: [
      { target: "product", icon: "◆", title: "Product / SKU", description: "Define products and counting units" },
      { target: "receiving", icon: "▰", title: "PO & receiving", description: "Purchase and receive into stock" },
      { target: "sellable", icon: "⬢", title: "Sellable stock", description: "Available by branch", tone: "green" },
      { target: "reservation", icon: "▣", title: "Order reservation", description: "Counter / LINE OA / Social" },
      { target: "handoff", icon: "▾", title: "Pay / handoff", description: "Payment and delivery" },
      { target: "deduction", icon: "✓", title: "Deduct stock", description: "Balance falls automatically", tone: "green" },
    ],
    transfer: [
      { target: "transfer", icon: "▰", title: "Branch transfer", description: "Request and approve" },
      { target: "transit", icon: "▰", title: "In transit", description: "Await destination receipt", tone: "orange" },
      { target: "outcome", icon: "!", title: "Receive / quarantine / loss", description: "Inspect and record outcome", tone: "red" },
    ],
    count: [
      { target: "snapshot", icon: "▥", title: "Snapshot", description: "Pin balance at a time", tone: "purple" },
      { target: "physical-count", icon: "▣", title: "Physical count", description: "Count on site" },
      { target: "approve-delta", icon: "●", title: "Approve variance", description: "Authorized review", tone: "orange" },
      { target: "adjust-delta", icon: "▤", title: "Apply delta", description: "Adjust only the difference" },
    ],
  },
};

const customerCapabilities = {
  th: ["เช็กสินค้าและราคา", "แนะนำสินค้าทดแทน", "แจ้งเตือนเมื่อของเข้า", "ติดตามสถานะออร์เดอร์"],
  en: ["Check products and prices", "Suggest verified alternatives", "Notify when restocked", "Track order status"],
} as const;

const ownerAnalyses = {
  th: ["ยอดขาย ความเร็วการขาย และจำนวนวันที่สต็อกพอ", "ของเสี่ยงหมด ค้างคลัง เกินความต้องการ และไม่มีการเคลื่อนไหว", "ยอดจอง ระหว่างทาง กักกัน สูญหาย ของเสีย และผลต่างตรวจนับ", "แนะนำเติมหรือโอนระหว่างสาขาจากข้อมูลที่ตรวจสอบแล้ว"],
  en: ["Sales velocity and estimated days of stock", "Stockout, overstock, dead-stock and no-movement risk", "Reservations, transit, quarantine, loss, waste and count variance", "Verified-data replenishment and branch-transfer recommendations"],
} as const;

export function InventoryGuideOverview({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const cues = inventoryNarrationCues[lang];
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
    const track = recordings[cues[target].text];
    if (!track || !audioElement.current) {
      setVoiceError("file");
      setPlaying(false);
      return;
    }
    audioPlayer.current ??= new RecordedNarration(audioElement.current);
    audioPlayer.current.play(`${target}:${track.file}:${speed}`, track.file, speed, () => {
      if (target >= cues.length - 1) setPlaying(false);
      else setStep(target + 1);
    }, (reason) => {
      setVoiceError(reason);
      setPlaying(false);
    });
  }, [cues, speed]);

  useEffect(() => {
    const supported = recorded || (typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    setSpeechSupported(supported);
    setPlaying(false);
    setStep(0);
    setVoiceError(null);
    return stopAudio;
  }, [lang, recorded, stopAudio]);

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
    try {
      const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith("en"));
      if (voice) utterance.voice = voice;
    } catch { /* Let the browser choose its language fallback. */ }
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
    return () => {
      closed = true;
      synth.cancel();
    };
  }, [cue.text, cues.length, playing, recorded, speechSupported, speed, startRecorded, step]);

  useEffect(() => {
    if (!playing || document.querySelector("dialog[data-learning-fullscreen][open]")) return;
    const id = cue.target === "customer" || cue.target === "owner" ? `inventory-${cue.target}-ai` : `inventory-flow-${cue.target}`;
    const target = document.getElementById(id);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [cue.target, playing]);

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

  function renderFlowDiagram(fullscreen = false) {
    return <div className={s.inventoryFlowDiagram}>
      {(Object.keys(flowLanes[lang]) as (keyof FlowLanes)[]).map((lane, laneIndex) => <div className={`${s.inventoryFlowLane} ${s[`inventoryFlowLane${lane[0].toUpperCase()}${lane.slice(1)}`]}`} key={lane}>
        <span className={s.inventoryFlowBranch} aria-hidden="true">{laneIndex === 0 ? "" : "↳"}</span>
        <ol>
          {flowLanes[lang][lane].map((node, index, nodes) => {
            const active = cue.target === node.target || cue.target === "customer" && node.target === "reservation" || cue.target === "owner" && node.target === "adjust-delta";
            return <li key={node.target} id={fullscreen ? undefined : `inventory-flow-${node.target}`} data-active={active} data-flow-active={active} data-tone={node.tone} aria-current={active ? "step" : undefined}>
              {active && playing && <span className={s.inventoryFlowSpeaker} aria-hidden="true">♪</span>}
              {node.target === "reservation" && <span className={s.inventoryFlowAiBadge}><b aria-hidden="true">✦</b> {lang === "th" ? "AI ลูกค้า" : "Customer AI"}</span>}
              {node.target === "adjust-delta" && <span className={s.inventoryFlowAiBadge}><b aria-hidden="true">✦</b> {lang === "th" ? "AI เจ้าของร้าน" : "Owner AI"}</span>}
              <span className={s.inventoryFlowIcon} aria-hidden="true">{node.icon}</span>
              <div><strong>{node.title}</strong><small>{node.description}</small></div>
              {index < nodes.length - 1 && <span className={s.inventoryFlowArrow} aria-hidden="true">→</span>}
            </li>;
          })}
        </ol>
      </div>)}
    </div>;
  }

  return <section className={s.inventoryOverview} aria-labelledby="inventory-overview-title">
    <div className={s.inventoryOverviewHeading}>
      <div>
        <span className={s.inventoryAiEyebrow}>AI · Inventory</span>
        <h2 id="inventory-overview-title">{t.title}</h2>
        <p>{t.description}</p>
      </div>
      <div className={s.inventoryNarration}>
        <button type="button" onClick={toggleNarration} disabled={!speechSupported || Boolean(voiceError)} aria-pressed={playing}>
          {playing ? t.pause : t.play}
        </button>
        <span role="status">{!speechSupported || voiceError ? t.unsupported : t.recordedNotice}</span>
      </div>
    </div>

    {recorded && <audio ref={audioElement} preload="none" data-inventory-recorded-narration />}

    <nav className={s.inventoryJumpLinks} aria-label={lang === "th" ? "ข้ามไปยังส่วนของภาพรวม" : "Overview sections"}>
      <a href="#inventory-flow">{t.jumpOverview}</a>
      <a href="#inventory-customer-ai">{t.jumpCustomer}</a>
      <a href="#inventory-owner-ai">{t.jumpOwner}</a>
    </nav>

    <section className={s.inventoryFlowPanel} id="inventory-flow" aria-labelledby="inventory-flow-title">
      <div className={s.flowPanelHeading}>
        <h3 id="inventory-flow-title">{t.flowTitle}</h3>
        <LearningFlowFullscreen
          lang={lang}
          title={t.flowTitle}
          cueText={cue.text}
          step={step}
          total={cues.length}
          playing={playing}
          canPlay={speechSupported && !voiceError}
          onTogglePlaying={toggleNarration}
          onPrevious={() => move(step - 1)}
          onNext={() => move(step + 1)}
          renderDiagram={() => renderFlowDiagram(true)}
        />
      </div>
      <div className={s.inventoryPlayback} data-playing={playing}>
        <div className={s.inventoryPlaybackHeading}>
          <span>{t.step} {step + 1} {t.of} {cues.length}</span>
          <div className={s.inventoryPlaybackControls}>
            <button type="button" onClick={() => move(step - 1)} disabled={step === 0}>{t.previous}</button>
            <button type="button" onClick={() => move(step + 1)} disabled={step === cues.length - 1}>{t.next}</button>
            <button type="button" onClick={() => move(0)}>{t.restart}</button>
            <label>{t.speed}<select value={speed} onChange={(event) => {
              stopAudio();
              setPlaying(false);
              setSpeed(Number(event.target.value));
            }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
          </div>
        </div>
        <p aria-live={playing ? "off" : "polite"}>{cue.text}</p>
      </div>
      {renderFlowDiagram()}
      <div className={s.inventoryStates} aria-label={lang === "th" ? "สถานะสต็อก" : "Inventory states"}>
        {(lang === "th" ? ["พร้อมขาย", "จองแล้ว", "ระหว่างทาง", "กักกัน", "สูญหาย"] : ["Sellable", "Reserved", "In transit", "Quarantined", "Missing"]).map((state) => <span key={state}>{state}</span>)}
      </div>
      <p className={s.inventoryFlowNote}><span aria-hidden="true">▣</span> {t.flowNote}</p>
    </section>

    <h3 className={s.inventoryAiTitle}><span aria-hidden="true">✦</span> {t.aiTitle}</h3>
    <div className={s.inventoryAiGrid}>
      <section className={`${s.inventoryAudienceCard} ${s.inventoryCustomerCard}`} id="inventory-customer-ai" aria-labelledby="inventory-customer-title" data-active={cue.target === "customer"} aria-current={cue.target === "customer" ? "step" : undefined}>
        <div className={s.inventoryAudienceHeading}>
          <h4 id="inventory-customer-title"><span aria-hidden="true">●</span> {t.customerTitle}</h4>
          <span>{t.customerStatus}</span>
        </div>
        <div className={s.inventoryChannels} aria-label={lang === "th" ? "ตัวอย่างช่องทาง" : "Example channels"}>
          <span>LINE OA</span><span>Facebook</span><span>Instagram</span><span>Web chat</span>
        </div>
        <div className={s.inventoryCustomerPath} aria-label={lang === "th" ? "เส้นทางคำถามลูกค้า" : "Customer question path"}>
          <span>{lang === "th" ? "ลูกค้าถาม" : "Customer asks"}</span><b aria-hidden="true">→</b>
          <span>{lang === "th" ? "AI เรียกเครื่องมือ" : "AI calls a tool"}</span><b aria-hidden="true">→</b>
          <span>{lang === "th" ? "ตอบข้อมูลที่อนุญาต" : "Approved facts only"}</span>
        </div>
        <div className={s.inventoryChatExample}>
          <p><strong>{lang === "th" ? "ลูกค้า" : "Customer"}</strong>{t.customerQuestion}</p>
          <p><strong>AI</strong>{t.customerAnswer}</p>
        </div>
        <ul className={s.inventoryCapabilities}>{customerCapabilities[lang].map((item) => <li key={item}>{item}</li>)}</ul>
        <p className={s.inventoryAudienceLimit}><span aria-hidden="true">🔒</span> {t.customerLimit}</p>
      </section>

      <section className={`${s.inventoryAudienceCard} ${s.inventoryOwnerCard}`} id="inventory-owner-ai" aria-labelledby="inventory-owner-title" data-active={cue.target === "owner"} aria-current={cue.target === "owner" ? "step" : undefined}>
        <div className={s.inventoryAudienceHeading}>
          <h4 id="inventory-owner-title"><span aria-hidden="true">●</span> {t.ownerTitle}</h4>
          <span>{t.ownerStatus}</span>
        </div>
        <blockquote className={s.inventoryOwnerQuestion}>{t.ownerQuestion}</blockquote>
        <strong className={s.businessCapabilityTitle}>{t.adminAnalysis}</strong>
        <ul className={s.inventoryCapabilities}>{ownerAnalyses[lang].map((item) => <li key={item}>{item}</li>)}</ul>
        <div className={s.inventoryReportExample}>
          <div className={s.inventorySampleHeading}><span>{t.sample}</span><strong>{t.period}</strong></div>
          <dl>
            <div><dt>{t.sales}</dt><dd>฿1,284,650</dd></div>
            <div><dt>{t.top}</dt><dd>Runner X · 428</dd></div>
            <div><dt>{t.risk}</dt><dd>6 SKU</dd></div>
          </dl>
          <p>{t.evidence}</p>
          <div className={s.inventoryExportRow}><span>{t.export}</span><b>XLSX</b><b>CSV</b><b>PDF</b></div>
        </div>
        <p className={s.inventoryAudienceLimit}><span aria-hidden="true">🔒</span> {t.ownerLimit}</p>
      </section>
    </div>

    <div className={s.inventoryArchitecture} aria-label={lang === "th" ? "สถาปัตยกรรมการตอบด้วย AI" : "AI answer architecture"}>
      <span>{lang === "th" ? "ช่องทางที่เปิด" : "Enabled channel"}</span><b aria-hidden="true">→</b>
      <span>AI</span><b aria-hidden="true">→</b>
      <span>{lang === "th" ? "เครื่องมือที่อนุญาต" : "Approved tool"}</span><b aria-hidden="true">→</b>
      <span>{lang === "th" ? "ข้อมูล BMS ที่ตรวจสอบแล้ว" : "Verified BMS data"}</span>
      <p>{t.architectureNote}</p>
    </div>

    <Link className={s.inventoryGuideLink} href={localizedPublicPath("/learn/guides/inventory-ai-assistant?track=inventory", lang)}>{t.learnMore} →</Link>
  </section>;
}
