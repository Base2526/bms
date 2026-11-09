import type { PickupQueueVoiceSettings, QueueBoardChimeTone } from "./pickupQueueVoice";

export const QUEUE_BOARD_AUDIO_STYLES = [
  { value: "AI_STUDIO", label: "AI Studio · ผู้หญิงสุภาพ (แนะนำ)", description: "เสียง Kore ผู้หญิง น้ำเสียงมั่นคงและชัดเจน เหมาะกับร้านทั่วไป" },
  { value: "AI_STUDIO_BRIGHT", label: "AI Studio · ผู้หญิงสดใส", description: "เสียง Aoede ผู้หญิง น้ำเสียงโปร่งและเป็นกันเอง เหมาะกับคาเฟ่" },
  { value: "AI_STUDIO_MALE_FRIENDLY", label: "AI Studio · ผู้ชายเป็นกันเอง", description: "เสียง Puck ผู้ชาย น้ำเสียงกระฉับกระเฉงและเป็นมิตร" },
  { value: "AI_STUDIO_ANNOUNCER", label: "AI Studio · ผู้ชายเสียงประกาศ", description: "เสียง Charon ผู้ชาย เน้นคำชัด เหมาะกับร้านที่มีเสียงรบกวน" },
  { value: "AI_STUDIO_BELL", label: "AI Studio · ผู้หญิงสุภาพ + กระดิ่ง", description: "เสียง Kore ผู้หญิงพูดหมายเลขคิวแล้วตามด้วยกระดิ่งเคาน์เตอร์" },
  { value: "COUNTER_BELL", label: "กระดิ่งเคาน์เตอร์", description: "กระดิ่งสองโน้ต เหมาะกับร้านที่ไม่ต้องการเสียงพูด" },
  { value: "DOUBLE_BEEP", label: "บี๊บสองครั้ง", description: "เสียงสั้น กระชับ และแยกจากเสียงแจ้งเตือนทั่วไป" },
  { value: "SOFT_PING", label: "เสียงนุ่ม", description: "เสียงสั้นระดับเบา เหมาะกับจอที่อยู่ใกล้ลูกค้า" },
] as const;

export type QueueBoardAudioStyle = typeof QUEUE_BOARD_AUDIO_STYLES[number]["value"];

const QUEUE_BOARD_AUDIO_PREFIX = "bms.pos.queueBoardAudio.";
const DEFAULT_QUEUE_BOARD_AUDIO: QueueBoardAudioStyle = "AI_STUDIO";
const VALID_STYLES = new Set<string>(QUEUE_BOARD_AUDIO_STYLES.map((option) => option.value));

export function queueBoardAudioStorageKey(namespace: string): string {
  return QUEUE_BOARD_AUDIO_PREFIX + namespace;
}

export function readQueueBoardAudioStyle(namespace: string): QueueBoardAudioStyle {
  if (!namespace || typeof window === "undefined") return DEFAULT_QUEUE_BOARD_AUDIO;
  try {
    const saved = window.localStorage.getItem(queueBoardAudioStorageKey(namespace));
    return saved && VALID_STYLES.has(saved) ? saved as QueueBoardAudioStyle : DEFAULT_QUEUE_BOARD_AUDIO;
  } catch {
    return DEFAULT_QUEUE_BOARD_AUDIO;
  }
}

export function writeQueueBoardAudioStyle(namespace: string, style: QueueBoardAudioStyle): void {
  if (!namespace || typeof window === "undefined" || !VALID_STYLES.has(style)) return;
  try {
    window.localStorage.setItem(queueBoardAudioStorageKey(namespace), style);
  } catch {
    // Blocked storage keeps the AI Studio-first default; queue authority is unaffected.
  }
}

/** Device presentation may choose a sound, but it may never override a branch-wide OFF policy. */
export function applyQueueBoardAudioStyle(
  settings: PickupQueueVoiceSettings | null | undefined,
  style: QueueBoardAudioStyle,
): PickupQueueVoiceSettings {
  const base: PickupQueueVoiceSettings = {
    voiceMode: settings?.voiceMode ?? "AI_STUDIO",
    voiceLanguage: settings?.voiceLanguage ?? "th",
    voiceRepeat: settings?.voiceRepeat ?? 1,
    voiceVolume: settings?.voiceVolume ?? 80,
  };
  if (base.voiceMode === "OFF") return base;
  const voiceProfiles = {
    AI_STUDIO: "KORE",
    AI_STUDIO_BRIGHT: "AOEDE",
    AI_STUDIO_MALE_FRIENDLY: "PUCK",
    AI_STUDIO_ANNOUNCER: "CHARON",
    AI_STUDIO_BELL: "KORE",
  } as const;
  if (style in voiceProfiles) {
    const voiceProfile = voiceProfiles[style as keyof typeof voiceProfiles];
    return {
      ...base,
      voiceMode: style === "AI_STUDIO_BELL" ? "VOICE_CHIME" : "AI_STUDIO",
      voiceProfile,
      chimeTone: style === "AI_STUDIO_BELL" ? "COUNTER_BELL" : "CLASSIC",
    };
  }
  const chimeTone: QueueBoardChimeTone = style === "DOUBLE_BEEP"
    ? "DOUBLE_BEEP"
    : style === "SOFT_PING" ? "SOFT_PING" : "COUNTER_BELL";
  return { ...base, voiceMode: "CHIME", chimeTone };
}
