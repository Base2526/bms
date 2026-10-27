import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { thaiNarrationEntries } from "./lib/restaurant-narration.mts";
import { RecordedNarration } from "../apps/web/components/marketing/restaurant/recordedNarration.ts";

test("every Thai cue in every flow/profile/branch has a complete shipped MP3", () => {
  const manifest = JSON.parse(readFileSync(new URL("../apps/web/components/marketing/restaurant/thaiAudio.json", import.meta.url), "utf8"));
  const provenance = JSON.parse(readFileSync(new URL("../apps/web/public/audio/restaurant/th/provenance.json", import.meta.url), "utf8"));
  const entries = thaiNarrationEntries();
  assert.deepEqual(Object.keys(manifest).sort(), entries.map(entry => entry.text).sort(), "Regenerate audio after changing Thai copy");
  for (const { text, id } of entries) {
    const recording = manifest[text];
    assert.equal(recording.file, `/audio/restaurant/th/${id}.mp3`);
    assert.ok(recording.duration > 0.2 && recording.duration < 90);
    const path = new URL(`../apps/web/public${recording.file}`, import.meta.url);
    assert.ok(statSync(path).size > 1000, text);
    const bytes = readFileSync(path);
    assert.ok(bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), text);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance[id].sha256, text);
  }
});

test("recorded audio starts on the calling gesture, ignores stale callbacks, and releases playback", async () => {
  let plays = 0, pauses = 0, failed = "", complete = 0;
  let rejectPlay: (reason: Error) => void = () => {};
  const audio = {
    src: "", playbackRate: 1, onended: null, onerror: null, onplaying: null, ontimeupdate: null,
    play() { plays++; return new Promise<void>((_, reject) => { rejectPlay = reject; }); },
    pause() { pauses++; }, removeAttribute() { this.src = ""; }, load() {},
  } as unknown as HTMLAudioElement;
  const player = new RecordedNarration(audio);
  player.play("first", "/first.mp3", 1.25, () => complete++, reason => { failed = reason; });
  assert.equal(plays, 1); assert.equal(audio.playbackRate, 1.25);
  const oldError = audio.onerror!, oldEnd = audio.onended!, oldReject = rejectPlay;
  player.play("first", "/first.mp3", 1.25, () => complete++, reason => { failed = reason; });
  assert.equal(plays, 1, "React effect must not restart the gesture-initiated track");
  player.stop();
  player.play("second", "/second.mp3", 1, () => complete++, reason => { failed = reason; });
  oldError.call(audio, new Event("error")); oldEnd.call(audio, new Event("ended")); oldReject(new Error("stale"));
  await Promise.resolve();
  assert.equal(failed, ""); assert.equal(complete, 0); assert.equal(audio.src, "/second.mp3");
  rejectPlay(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  await Promise.resolve();
  assert.equal(failed, "not-allowed"); assert.equal(audio.src, ""); assert.ok(pauses > 0);
  player.stop();
});
