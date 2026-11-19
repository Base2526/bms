/**
 * Static pickup-queue voice pack generated and approved in Google AI Studio.
 *
 * Runtime never calls an AI provider. The release task generates short, immutable WAV segments;
 * the customer board decodes them from the same origin and schedules them on one AudioContext.
 * Missing/corrupt segments reject so the caller can fall back to the existing chime.
 */

const PREFIX_RE = /^[A-Z]?$/;
const DIGITS_RE = /^\d{1,4}$/;

export type PickupQueueVoiceProfile = "KORE" | "AOEDE" | "PUCK" | "CHARON";

function voicePackRoot(language: "th" | "en", profile: PickupQueueVoiceProfile): string {
  // Kore keeps the original path so an existing single-voice release remains compatible.
  return profile === "KORE"
    ? `/audio/pickup-queue/${language}`
    : `/audio/pickup-queue/${language}/${profile.toLowerCase()}`;
}

export function pickupQueueVoiceManifestUrl(
  language: "th" | "en" = "th",
  profile: PickupQueueVoiceProfile = "KORE",
): string {
  return `${voicePackRoot(language, profile)}/manifest.json`;
}

/**
 * Check the release asset for the selected voice without creating an AudioContext or playing it.
 * The settings screen uses this to avoid presenting an operating-system fallback as AI Studio.
 * A profile manifest is written only after every segment for that profile has been generated.
 */
export async function hasPickupQueueVoicePack(
  language: "th" | "en" = "th",
  profile: PickupQueueVoiceProfile = "KORE",
): Promise<boolean> {
  try {
    const response = await fetch(pickupQueueVoiceManifestUrl(language, profile), { cache: "no-store" });
    if (!response.ok) return false;
    const manifest = await response.json().catch(() => null);
    return manifest?.profile === profile
      && manifest?.locale === (language === "th" ? "th-TH" : "en-US")
      && Array.isArray(manifest?.files)
      && manifest.files.includes("intro.wav")
      && manifest.files.includes("outro.wav")
      && manifest.files.includes("digit-0.wav")
      && manifest.files.includes("digit-9.wav");
  } catch {
    return false;
  }
}

export function pickupQueueVoiceSegments(
  label: string,
  language: "th" | "en" = "th",
  profile: PickupQueueVoiceProfile = "KORE",
): string[] {
  const normalized = String(label ?? "").trim().toUpperCase();
  const match = /^([A-Z]?)(\d{1,4})$/.exec(normalized);
  if (!match || !PREFIX_RE.test(match[1]) || !DIGITS_RE.test(match[2])) return [];
  const [, prefix, digits] = match;
  const root = voicePackRoot(language, profile);
  return [
    `${root}/intro.wav`,
    ...(prefix ? [`${root}/letter-${prefix}.wav`] : []),
    ...[...digits].map((digit) => `${root}/digit-${digit}.wav`),
    `${root}/outro.wav`,
  ];
}

const decoded = new Map<string, Promise<AudioBuffer>>();

export type PickupQueueVoiceSettings = {
  voiceMode?: "AI_STUDIO" | "VOICE_CHIME" | "CHIME" | "OFF";
  voiceLanguage?: "th" | "en";
  voiceRepeat?: number;
  voiceVolume?: number;
  voiceProfile?: PickupQueueVoiceProfile;
  chimeTone?: QueueBoardChimeTone;
};

export type QueueBoardChimeTone = "CLASSIC" | "COUNTER_BELL" | "DOUBLE_BEEP" | "SOFT_PING";

let cashierAudioContext: AudioContext | null = null;

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

/**
 * Create/resume audio while the cashier click still counts as a user gesture. Waiting for the
 * mutation response first makes Safari/Chrome treat playback as autoplay and silently block it.
 */
export function preparePickupQueueAnnouncement(
  label: string,
  settings: PickupQueueVoiceSettings | null = null,
): AudioContext | null {
  if (settings?.voiceMode === "OFF") return null;
  try {
    const Ctor = audioContextConstructor();
    if (!Ctor) return null;
    cashierAudioContext = cashierAudioContext ?? new Ctor();
    void cashierAudioContext.resume();
    if ((settings?.voiceMode ?? "AI_STUDIO") !== "CHIME") {
      void preloadPickupQueueVoice(
        cashierAudioContext,
        label,
        settings?.voiceLanguage ?? "th",
        settings?.voiceProfile ?? "KORE",
      );
    }
    return cashierAudioContext;
  } catch {
    return null;
  }
}

export function playPickupQueueChime(
  context: AudioContext | null,
  volume = 80,
  tone: QueueBoardChimeTone = "CLASSIC",
): void {
  if (!context) return;
  const now = context.currentTime;
  const patterns: Record<QueueBoardChimeTone, ReadonlyArray<readonly [number, number, number, OscillatorType]>> = {
    CLASSIC: [[0, 880, 0.6, "sine"], [0.35, 660, 0.6, "sine"]],
    COUNTER_BELL: [[0, 1568, 0.22, "triangle"], [0.07, 2093, 0.55, "sine"]],
    DOUBLE_BEEP: [[0, 1046, 0.16, "square"], [0.2, 1046, 0.16, "square"]],
    SOFT_PING: [[0, 1318, 0.38, "sine"]],
  };
  for (const [offset, frequency, duration, oscillatorType] of patterns[tone]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = oscillatorType;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, (tone === "SOFT_PING" ? 0.16 : 0.3) * Math.min(1, Math.max(0, volume / 100))),
      now + offset + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + duration + 0.05);
  }
}

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const ENGLISH_DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function pickupQueueSpeechText(label: string, language: "th" | "en" = "th"): string | null {
  const match = /^([A-Z]?)(\d{1,4})$/.exec(String(label ?? "").trim().toUpperCase());
  if (!match) return null;
  const [, prefix, digits] = match;
  const spokenDigits = [...digits]
    .map((digit) => (language === "th" ? THAI_DIGITS : ENGLISH_DIGITS)[Number(digit)])
    .join(" ");
  if (language === "en") {
    return `Queue number ${prefix ? `${prefix} ` : ""}${spokenDigits}. Please collect at the counter.`;
  }
  return `ขอเชิญคิวหมายเลข ${prefix ? `${prefix} ` : ""}${spokenDigits} กรุณารับที่เคาน์เตอร์ค่ะ`;
}

/** Spoken fallback while a release-time AI Studio pack is not installed on this server. */
export function speakPickupQueueWithSystemVoice(
  label: string,
  settings: PickupQueueVoiceSettings | null = null,
): boolean {
  if (typeof window === "undefined"
    || typeof window.speechSynthesis === "undefined"
    || typeof window.SpeechSynthesisUtterance === "undefined") return false;
  const language = settings?.voiceLanguage ?? "th";
  const text = pickupQueueSpeechText(label, language);
  if (!text) return false;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "th" ? "th-TH" : "en-US";
    const profile = settings?.voiceProfile ?? "KORE";
    const delivery = {
      KORE: { rate: language === "th" ? 0.92 : 0.96, pitch: 1, voiceIndex: 0 },
      AOEDE: { rate: language === "th" ? 1 : 1.03, pitch: 1.14, voiceIndex: 1 },
      PUCK: { rate: language === "th" ? 0.96 : 1, pitch: 0.84, voiceIndex: 2 },
      CHARON: { rate: language === "th" ? 0.84 : 0.88, pitch: 0.76, voiceIndex: 3 },
    }[profile];
    utterance.rate = delivery.rate;
    utterance.pitch = delivery.pitch;
    utterance.volume = Math.min(1, Math.max(0, Number(settings?.voiceVolume ?? 80) / 100));
    const matchingVoices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith(language));
    const preferred = matchingVoices.length
      ? matchingVoices[delivery.voiceIndex % matchingVoices.length]
      : undefined;
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

async function decode(context: AudioContext, url: string): Promise<AudioBuffer> {
  const existing = decoded.get(url);
  if (existing) return existing;
  const pending = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("PICKUP_QUEUE_VOICE_SEGMENT_MISSING");
      return response.arrayBuffer();
    })
    .then((bytes) => context.decodeAudioData(bytes));
  decoded.set(url, pending);
  try {
    return await pending;
  } catch (error) {
    decoded.delete(url);
    throw error;
  }
}

export async function preloadPickupQueueVoice(
  context: AudioContext,
  label = "A042",
  language: "th" | "en" = "th",
  profile: PickupQueueVoiceProfile = "KORE",
): Promise<boolean> {
  const urls = pickupQueueVoiceSegments(label, language, profile);
  if (!urls.length) return false;
  try {
    await Promise.all(urls.map((url) => decode(context, url)));
    return true;
  } catch {
    return false;
  }
}

export async function playPickupQueueVoice(
  context: AudioContext,
  label: string,
  options: { language?: "th" | "en"; repeat?: number; volume?: number; profile?: PickupQueueVoiceProfile } = {},
): Promise<boolean> {
  const urls = pickupQueueVoiceSegments(label, options.language ?? "th", options.profile ?? "KORE");
  if (!urls.length) return false;
  let buffers: AudioBuffer[];
  try {
    buffers = await Promise.all(urls.map((url) => decode(context, url)));
  } catch {
    return false;
  }
  const gain = context.createGain();
  gain.gain.value = Math.min(1, Math.max(0, Number(options.volume ?? 80) / 100));
  gain.connect(context.destination);
  let at = context.currentTime + 0.04;
  const repeat = Math.min(3, Math.max(1, Math.trunc(options.repeat ?? 1)));
  for (let pass = 0; pass < repeat; pass += 1) {
    for (const buffer of buffers) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(at);
      at += buffer.duration + 0.035;
    }
    at += 0.45;
  }
  return true;
}

/** AI Studio is the primary announcement; a short chime is the fail-safe for missing audio. */
export async function playPickupQueueAnnouncement(
  context: AudioContext | null,
  label: string,
  settings: PickupQueueVoiceSettings | null = null,
): Promise<{ played: boolean; usedSystemVoice: boolean; usedChime: boolean }> {
  const mode = settings?.voiceMode ?? "AI_STUDIO";
  const volume = settings?.voiceVolume ?? 80;
  if (!context || mode === "OFF") return { played: false, usedSystemVoice: false, usedChime: false };
  try {
    await context.resume();
  } catch {
    return { played: false, usedSystemVoice: false, usedChime: false };
  }
  if (mode === "CHIME") {
    playPickupQueueChime(context, volume, settings?.chimeTone);
    return { played: false, usedSystemVoice: false, usedChime: true };
  }
  const played = await playPickupQueueVoice(context, label, {
    language: settings?.voiceLanguage ?? "th",
    repeat: settings?.voiceRepeat ?? 1,
    volume,
    profile: settings?.voiceProfile ?? "KORE",
  });
  const usedSystemVoice = !played && speakPickupQueueWithSystemVoice(label, settings);
  const usedChime = (!played && !usedSystemVoice) || mode === "VOICE_CHIME";
  if (usedChime) playPickupQueueChime(context, volume, settings?.chimeTone);
  return { played, usedSystemVoice, usedChime };
}

