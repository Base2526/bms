#!/usr/bin/env node
/** Build release audio for the public factory guide with Google AI Studio's Gemini TTS. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { factoryNodes } from "../apps/web/lib/learning/factoryGuideFlow.ts";

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("Set GEMINI_API_KEY in the current shell before generating factory narration");

const model = "gemini-3.8-flash-tts";
const voice = "Kore";
const stage = resolve(".test-output/factory-guide-tts");
const publicDir = resolve("apps/web/public/audio/learning-factory/th");
const manifestPath = resolve("apps/web/app/learn/factory-twine-straw/factoryThaiAudio.json");
const cues = factoryNodes.map((node, index) => ({ index, text: node.explanation.th }));

function wavDuration(bytes: Buffer) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("TTS did not return a WAV file");
  let byteRate = 0;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const name = bytes.toString("ascii", offset, offset + 4);
    if (name === "fmt " && size >= 16) byteRate = bytes.readUInt32LE(offset + 16);
    if (name === "data") dataLength = size;
    offset += 8 + size + (size % 2);
  }
  const duration = dataLength / byteRate;
  if (!Number.isFinite(duration) || duration < 0.2 || duration > 90) throw new Error("TTS WAV duration is invalid");
  return duration;
}

async function generate(text: string) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key! },
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{
        type: "text", text,
        annotations: [{ type: "speech_metadata", style: "Clear adult Thai narration for a factory training guide, steady medium pace, exact recitation, no music" }],
      }] }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice, language: "th-TH" }] },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.output_audio?.data !== "string") throw new Error(`Gemini TTS request failed: HTTP ${response.status}`);
  return Buffer.from(body.output_audio.data, "base64");
}

await mkdir(stage, { recursive: true });
const ready: { index: number; text: string; id: string; duration: number; sha256: string; path: string }[] = [];
for (const { index, text } of cues) {
  const id = createHash("sha256").update(`${model}\0${voice}\0${text}`).digest("hex").slice(0, 24);
  const path = join(stage, `${id}.wav`);
  const metaPath = join(stage, `${id}.json`);
  let bytes: Buffer | undefined;
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const existing = await readFile(path);
    if (meta.text === text && meta.model === model && meta.voice === voice && meta.sha256 === createHash("sha256").update(existing).digest("hex")) bytes = existing;
  } catch { /* Generate a missing or stale clip. */ }
  if (!bytes) {
    bytes = await generate(text);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duration = wavDuration(bytes);
    await writeFile(path, bytes);
    await writeFile(metaPath, JSON.stringify({ text, model, voice, sha256, duration }, null, 2));
    process.stdout.write(`Generated factory cue ${index + 1}/${cues.length}\n`);
  } else process.stdout.write(`Reused factory cue ${index + 1}/${cues.length}\n`);
  ready.push({ index, text, id, duration: wavDuration(bytes), sha256: createHash("sha256").update(bytes).digest("hex"), path });
}

await mkdir(publicDir, { recursive: true });
const manifest: Record<string, { text: string; file: string; duration: number; sha256: string }> = {};
for (const cue of ready) {
  await copyFile(cue.path, join(publicDir, `${cue.id}.wav`));
  manifest[String(cue.index)] = { text: cue.text, file: `/audio/learning-factory/th/${cue.id}.wav`, duration: cue.duration, sha256: cue.sha256 };
}
await writeFile(join(publicDir, "provenance.json"), `${JSON.stringify({ provider: "google-ai-studio", model, voice, locale: "th-TH", cues: ready.map(({ index, text, id, duration, sha256 }) => ({ index, text, id, duration, sha256 })) }, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Published ${ready.length} Gemini TTS recordings.\n`);
