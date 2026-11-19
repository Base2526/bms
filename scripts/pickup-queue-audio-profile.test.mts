import assert from "node:assert/strict";
import test from "node:test";
import { applyQueueBoardAudioStyle } from "../apps/web/lib/pos/queueBoardAudioPreference.ts";
import {
  hasPickupQueueVoicePack,
  pickupQueueVoiceSegments,
} from "../apps/web/lib/pos/pickupQueueVoice.ts";

test("AI Studio queue audio choices map to distinct immutable voice profiles", () => {
  const base = { voiceMode: "AI_STUDIO" as const, voiceLanguage: "th" as const, voiceRepeat: 1, voiceVolume: 80 };
  assert.equal(applyQueueBoardAudioStyle(base, "AI_STUDIO").voiceProfile, "KORE");
  assert.equal(applyQueueBoardAudioStyle(base, "AI_STUDIO_BRIGHT").voiceProfile, "AOEDE");
  assert.equal(applyQueueBoardAudioStyle(base, "AI_STUDIO_MALE_FRIENDLY").voiceProfile, "PUCK");
  assert.equal(applyQueueBoardAudioStyle(base, "AI_STUDIO_ANNOUNCER").voiceProfile, "CHARON");
  assert.equal(applyQueueBoardAudioStyle(base, "AI_STUDIO_BELL").voiceMode, "VOICE_CHIME");
});

test("branch-wide OFF still wins over every device voice profile", () => {
  const result = applyQueueBoardAudioStyle({ voiceMode: "OFF", voiceLanguage: "th" }, "AI_STUDIO_BRIGHT");
  assert.equal(result.voiceMode, "OFF");
  assert.equal(result.voiceProfile, undefined);
});

test("Kore keeps the legacy pack path and additional profiles use isolated directories", () => {
  assert.deepEqual(pickupQueueVoiceSegments("A01", "th", "KORE"), [
    "/audio/pickup-queue/th/intro.wav",
    "/audio/pickup-queue/th/letter-A.wav",
    "/audio/pickup-queue/th/digit-0.wav",
    "/audio/pickup-queue/th/digit-1.wav",
    "/audio/pickup-queue/th/outro.wav",
  ]);
  assert.deepEqual(pickupQueueVoiceSegments("01", "th", "AOEDE"), [
    "/audio/pickup-queue/th/aoede/intro.wav",
    "/audio/pickup-queue/th/aoede/digit-0.wav",
    "/audio/pickup-queue/th/aoede/digit-1.wav",
    "/audio/pickup-queue/th/aoede/outro.wav",
  ]);
  assert.match(pickupQueueVoiceSegments("01", "th", "PUCK")[0], /\/puck\/intro\.wav$/);
});

test("voice-pack readiness requires the selected profile's completed manifest", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        profile: "PUCK",
        locale: "th-TH",
        files: ["intro.wav", "digit-0.wav", "digit-9.wav", "outro.wav"],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    assert.equal(await hasPickupQueueVoicePack("th", "PUCK"), true);
    assert.deepEqual(requested, ["/audio/pickup-queue/th/puck/manifest.json"]);

    globalThis.fetch = (async () => new Response(JSON.stringify({
      profile: "KORE",
      locale: "th-TH",
      files: ["intro.wav", "digit-0.wav", "digit-9.wav", "outro.wav"],
    }), { status: 200 })) as typeof fetch;
    assert.equal(await hasPickupQueueVoicePack("th", "PUCK"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
