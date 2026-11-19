#!/usr/bin/env node
/**
 * Generate the approved Thai pickup-queue voice pack with Google AI Studio / Gemini TTS.
 *
 * GEMINI_API_KEY is read only at execution time and never written. Generated WAVs are release
 * assets; the POS runtime makes no provider call and therefore keeps queue announcements working
 * during an internet/provider outage.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY is required");

const model = process.env.PICKUP_QUEUE_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
const voiceOverride = process.env.PICKUP_QUEUE_TTS_VOICE?.trim();
const outputRoot = path.resolve("apps/web/public/audio/pickup-queue/th");
const profiles = [
  { id: "KORE", voice: "Kore", label: "ผู้หญิงสุภาพ", style: "adult Thai female, clear, polite and confident retail announcement, medium pace" },
  { id: "AOEDE", voice: "Aoede", label: "ผู้หญิงสดใส", style: "adult Thai female, bright, friendly and welcoming cafe announcement, medium pace" },
  { id: "PUCK", voice: "Puck", label: "ผู้ชายเป็นกันเอง", style: "adult Thai male, upbeat, friendly and welcoming retail announcement, medium pace" },
  { id: "CHARON", voice: "Charon", label: "ผู้ชายเสียงประกาศ", style: "adult Thai male, clear public announcement, deliberate pace and strong articulation" },
];
const requestedProfiles = new Set(
  (process.env.PICKUP_QUEUE_TTS_PROFILES?.trim() || profiles.map((profile) => profile.id).join(","))
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
const selectedProfiles = profiles.filter((profile) => requestedProfiles.has(profile.id));
if (!selectedProfiles.length) throw new Error("PICKUP_QUEUE_TTS_PROFILES did not match a supported voice profile");
const segments = [
  ["intro.wav", "ขอเชิญคิวหมายเลข"],
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => [`letter-${letter}.wav`, letter]),
  ...["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
    .map((text, digit) => [`digit-${digit}.wav`, text]),
  ["outro.wav", "กรุณารับที่เคาน์เตอร์ค่ะ"],
];

async function generate(profile, output, file, transcript) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{
        type: "text",
        text: transcript,
        annotations: [{ type: "speech_metadata", style: `${profile.style}, exact recitation, no music` }],
      }] }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: voiceOverride || profile.voice, language: "th-TH" }] },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.output_audio?.data !== "string") {
    throw new Error(`AI Studio TTS failed for ${file}: HTTP ${response.status}`);
  }
  await writeFile(path.join(output, file), Buffer.from(body.output_audio.data, "base64"));
  process.stdout.write(`generated ${profile.id}/${file}\n`);
}

for (const profile of selectedProfiles) {
  // Keep Kore at the legacy root; other voice packs live below their stable profile id.
  const output = profile.id === "KORE" ? outputRoot : path.join(outputRoot, profile.id.toLowerCase());
  await mkdir(output, { recursive: true });
  for (const [file, transcript] of segments) await generate(profile, output, file, transcript);
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({
    version: 2,
    provider: "google-ai-studio",
    model,
    profile: profile.id,
    label: profile.label,
    voice: voiceOverride || profile.voice,
    locale: "th-TH",
    sampleRate: 24000,
    generatedAt: new Date().toISOString(),
    files: segments.map(([file]) => file),
  }, null, 2));
}

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "voices.json"), JSON.stringify({
  version: 1,
  defaultProfile: "KORE",
  profiles: selectedProfiles.map(({ id, voice, label }) => ({ id, voice: voiceOverride || voice, label })),
}, null, 2));

