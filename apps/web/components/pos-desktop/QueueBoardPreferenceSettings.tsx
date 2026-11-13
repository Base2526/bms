"use client";

import { usePosText } from "@/lib/pos/usePosText";

import { useEffect, useState } from "react";
import { Button, Select, Switch } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { posDeviceStorageNamespace, readPosDeviceToken } from "@/lib/pos/deviceTokenClient";
import {
  QUEUE_BOARD_LAYOUTS,
  readQueueBoardLayout,
  writeQueueBoardLayout,
  type QueueBoardLayout,
} from "@/lib/pos/queueBoardLayoutPreference";
import {
  applyQueueBoardAudioStyle,
  QUEUE_BOARD_AUDIO_STYLES,
  readQueueBoardAudioStyle,
  writeQueueBoardAudioStyle,
  type QueueBoardAudioStyle,
} from "@/lib/pos/queueBoardAudioPreference";
import {
  readQueueBoardSoundEnabled,
  writeQueueBoardSoundEnabled,
} from "@/lib/pos/queueBoardSoundPreference";
import {
  hasPickupQueueVoicePack,
  playPickupQueueAnnouncement,
  preparePickupQueueAnnouncement,
} from "@/lib/pos/pickupQueueVoice";

export default function QueueBoardPreferenceSettings() {
  const posText = usePosText();
  const [storageNamespace, setStorageNamespace] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [layout, setLayout] = useState<QueueBoardLayout>("SPOTLIGHT");
  const [audioStyle, setAudioStyle] = useState<QueueBoardAudioStyle>("AI_STUDIO");
  const [audioTestStatus, setAudioTestStatus] = useState<"AI_STUDIO" | "SYSTEM" | "CHIME" | null>(null);
  const [voicePackStatus, setVoicePackStatus] = useState<"CHECKING" | "READY" | "MISSING" | "NOT_NEEDED">("CHECKING");
  const [testingAudio, setTestingAudio] = useState(false);

  useEffect(() => {
    let active = true;
    void readPosDeviceToken().then(async (token) => {
      if (!token) return;
      const namespace = await posDeviceStorageNamespace(token);
      if (!active) return;
      setStorageNamespace(namespace);
      setSoundEnabled(readQueueBoardSoundEnabled(namespace));
      setLayout(readQueueBoardLayout(namespace));
      setAudioStyle(readQueueBoardAudioStyle(namespace));
    });
    return () => { active = false; };
  }, []);

  const selectedLayout = QUEUE_BOARD_LAYOUTS.find((option) => option.value === layout);
  const selectedAudio = QUEUE_BOARD_AUDIO_STYLES.find((option) => option.value === audioStyle);

  useEffect(() => {
    if (!storageNamespace) return;
    let active = true;
    const voiceSettings = applyQueueBoardAudioStyle({
      voiceMode: "AI_STUDIO",
      voiceLanguage: "th",
      voiceRepeat: 1,
      voiceVolume: 80,
    }, audioStyle);
    if (voiceSettings.voiceMode === "CHIME") {
      setVoicePackStatus("NOT_NEEDED");
      return () => { active = false; };
    }
    setVoicePackStatus("CHECKING");
    void hasPickupQueueVoicePack(
      voiceSettings.voiceLanguage ?? "th",
      voiceSettings.voiceProfile ?? "KORE",
    ).then((ready) => {
      if (active) setVoicePackStatus(ready ? "READY" : "MISSING");
    });
    return () => { active = false; };
  }, [audioStyle, storageNamespace]);

  const testAudio = async () => {
    if (testingAudio) return;
    setTestingAudio(true);
    setAudioTestStatus(null);
    const voiceSettings = applyQueueBoardAudioStyle({
      voiceMode: "AI_STUDIO",
      voiceLanguage: "th",
      voiceRepeat: 1,
      voiceVolume: 80,
    }, audioStyle);
    try {
      const context = preparePickupQueueAnnouncement("001", voiceSettings);
      const result = await playPickupQueueAnnouncement(context, "001", voiceSettings);
      setAudioTestStatus(result.played ? "AI_STUDIO" : result.usedSystemVoice ? "SYSTEM" : "CHIME");
    } finally {
      setTestingAudio(false);
    }
  };

  return <section data-queue-board-preference-settings className="pos-queue-preference-settings">
    <div style={{ fontWeight: 700 }}>{posText("รูปแบบและเสียงจอเรียกคิว")}</div>
    <div style={{ marginTop: 3, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {posText("ตั้งค่าเฉพาะเครื่องนี้ · ใช้ร่วมกันทั้งจอจริงและหน้าต่างทดสอบ โดยไม่ขึ้นกับการเลือกรูปแบบจอที่สอง") + " "}</div>

    <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>{posText("รูปแบบหน้าจอเรียกคิว")}</div>
    <Select aria-label={posText("เลือกรูปแบบหน้าจอเรียกคิว")} value={layout}
      disabled={!storageNamespace} style={{ width: "100%", maxWidth: 520 }}
      onChange={(value: QueueBoardLayout) => {
        setLayout(value);
        writeQueueBoardLayout(storageNamespace, value);
      }}
      options={QUEUE_BOARD_LAYOUTS.map((option) => ({ value: option.value, label: posText(option.label) }))} />
    <div style={{ marginTop: 4, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {selectedLayout && posText(selectedLayout.description)} {" " + posText("· จอที่เปิดอยู่เปลี่ยนตามทันที") + " "}</div>

    <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>{posText("เสียงเรียกที่จอคิว")}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Select aria-label={posText("เลือกเสียงเรียกที่จอคิว")} value={audioStyle}
        disabled={!storageNamespace} style={{ width: "100%", maxWidth: 520, flex: "1 1 340px" }}
        onChange={(value: QueueBoardAudioStyle) => {
          setAudioStyle(value);
          setAudioTestStatus(null);
          writeQueueBoardAudioStyle(storageNamespace, value);
        }}
        options={QUEUE_BOARD_AUDIO_STYLES.map((option) => ({ value: option.value, label: posText(option.label) }))} />
      <Button icon={<PlayCircleOutlined />} loading={testingAudio}
        disabled={!storageNamespace} onClick={() => void testAudio()}>
        {posText("ทดลองเสียงคิว 001") + " "}</Button>
    </div>
    <div style={{ marginTop: 4, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {selectedAudio && posText(selectedAudio.description)}
    </div>
    {voicePackStatus === "READY" && <div role="status" style={{ marginTop: 5, color: "#15803d", fontSize: 12 }}>
      {posText("voice-pack AI Studio เสียงนี้พร้อมใช้งาน") + " "}</div>}
    {voicePackStatus === "MISSING" && <div role="status" style={{ marginTop: 5, color: "#b45309", fontSize: 12 }}>
      {posText("ยังไม่ได้ติดตั้ง voice-pack AI Studio เสียงนี้ · ตอนนี้จะใช้เสียงพูดภาษาไทยของเครื่อง จึงอาจต่างกันในแต่ละเครื่อง") + " "}</div>}
    {voicePackStatus === "CHECKING" && storageNamespace && <div role="status"
      style={{ marginTop: 5, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {posText("กำลังตรวจ voice-pack…") + " "}</div>}
    {audioTestStatus && <div role="status" style={{ marginTop: 5, color: "var(--posx-info, #1677ff)", fontSize: 12 }}>
      {audioTestStatus === "AI_STUDIO"
        ? posText("กำลังเล่นเสียงพูด AI Studio")
        : audioTestStatus === "SYSTEM"
          ? posText("voice-pack ยังไม่พร้อม · ใช้เสียงพูดภาษาไทยของเครื่อง")
          : posText("กำลังเล่นเสียงกริ่งที่เลือก")}
    </div>}
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44,
      marginTop: 10, cursor: storageNamespace ? "pointer" : "wait" }}>
      <Switch aria-label={posText("เปิดเสียงประกาศที่จอเรียกคิว")} checked={soundEnabled}
        disabled={!storageNamespace} onChange={(checked) => {
          setSoundEnabled(checked);
          writeQueueBoardSoundEnabled(storageNamespace, checked);
        }} />
      <span style={{ fontWeight: 600 }}>{posText("เสียงประกาศที่จอเรียกคิว")}</span>
    </label>
    <div style={{ color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {posText("เปิดเป็นค่าเริ่มต้น · ปิดได้เมื่อต้องการให้จอแสดงเลขคิวโดยไม่ออกเสียง") + " "}</div>
    <div style={{ marginTop: 10, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
      {posText("รูปโปรโมตและรูปเริ่มต้นตั้งแยกตามสาขาในระบบหลังบ้าน → สาขา → สื่อจอคิว") + " "}</div>
  </section>;
}
