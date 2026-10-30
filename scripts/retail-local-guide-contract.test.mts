import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RecordedNarration } from "../apps/web/components/marketing/restaurant/recordedNarration.ts";
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url));

test("Retail Local chapters ship matching pinned Thai audio, bilingual diagrams and a complete summary", () => {
  const steps = JSON.parse(read("apps/web/components/retail-local/guide-flow.json").toString());
  const evidence = JSON.parse(read("apps/web/public/audio/retail-local/th/provenance.json").toString());
  const reference = JSON.parse(read("apps/web/public/audio/cost-pricing/th/provenance.json").toString());
  const metadata = JSON.parse(read("apps/web/components/retail-local/guide-audio.json").toString());
  assert.deepEqual(metadata.durations, evidence.clips.map((clip: any) => clip.duration));
  assert.equal(metadata.totalDuration, Math.round(metadata.durations.reduce((sum: number, value: number) => sum + value, 0) * 1000) / 1000);
  assert.deepEqual(evidence.model_hashes, reference.model_hashes);
  assert.equal(steps.length, 12); assert.equal(evidence.clips.length, steps.length);
  assert.equal(new Set(steps.map((s: any) => s.id)).size, steps.length);
  assert.deepEqual(steps.map((s: any) => s.id), ["prepare", "download", "install", "setup-pos", "daily-use", "activate", "trial-paid", "backup-setup", "backup-check", "restore", "transfer", "update"]);
  for (const [i, step] of steps.entries()) {
    assert.deepEqual(Object.keys(step.th).sort(), Object.keys(step.en).sort());
    for (const lang of ["th", "en"]) {
      assert.ok(step[lang].title && step[lang].speech && step[lang].outcome);
      assert.equal(step[lang].nodes.length, 3);
      assert.ok(step[lang].nodes.every((n: string[]) => n.length === 3 && n.every(Boolean)));
    }
    const clip = evidence.clips[i];
    assert.equal(clip.id, step.id); assert.equal(clip.voice, "thai_som");
    assert.equal(clip.text, step.th.speech, "Regenerate narration after changing the Thai transcript");
    assert.ok(clip.duration > 1 && clip.duration < 90);
    assert.doesNotMatch(clip.spoken, /[A-Za-z0-9]/, "Unexpanded abbreviations must not reach the Thai voice");
    assert.equal(step.audio, `/audio/retail-local/th/step-${i + 1}.mp3`);
    const bytes = read(`apps/web/public${step.audio}`);
    assert.ok(bytes.length > 1000);
    assert.ok(bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
  }
  assert.equal(createHash("sha256").update(read("apps/web/public/audio/retail-local/th/summary.mp3")).digest("hex"), evidence.summarySha256);
  assert.match(read("apps/web/public/audio/retail-local/th/NOTICE.txt").toString(), /synthetic narration/);
  assert.ok(read("apps/web/public/audio/retail-local/th/LICENSE-FastThaiG2P.txt").length > 1000);
});

test("recorded narration resumes after metadata and stale metadata cannot seek a new chapter", () => {
  let plays = 0;
  const audio = { src: "", duration: 30, currentTime: 0, playbackRate: 1,
    play() { plays++; return Promise.resolve(); }, pause() {}, load() {}, removeAttribute() { this.src = ""; },
  } as unknown as HTMLAudioElement;
  const player = new RecordedNarration(audio);
  player.play("first", "/first.mp3", 1, () => {}, () => {}, 12);
  assert.equal(plays, 1, "Media play stays synchronous with the user gesture");
  const stale = audio.onloadedmetadata!;
  stale.call(audio, new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 12);
  player.stop();
  audio.currentTime = 0;
  player.play("second", "/second.mp3", 1.5, () => {}, () => {}, 4);
  stale.call(audio, new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 0);
  audio.onloadedmetadata!.call(audio, new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 4); assert.equal(audio.playbackRate, 1.5);
  player.stop();
  assert.equal(audio.onloadedmetadata, null);
});
