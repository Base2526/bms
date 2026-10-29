import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { calculateExample } from "../apps/web/components/marketing/cost-pricing/example.ts";
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url));

test("public example keeps contribution separate from net profit and rounds required cups upwards", () => {
  assert.deepEqual(calculateExample(2000,200,65,21000),{unit:30,contribution:35,monthly:600,daily:20});
  assert.deepEqual(calculateExample(2000,200,30,21000),{unit:30,contribution:0,monthly:null,daily:null});
  assert.equal(calculateExample(2000,200,29,21000)?.monthly,null);
  assert.equal(calculateExample(2000,200,65,21001)?.monthly,601);
  assert.equal(calculateExample(2000,200,65,0)?.daily,0);
  assert.deepEqual(calculateExample(2000,200,65.10,21060),{unit:30,contribution:35.1,monthly:600,daily:20});
  assert.equal(calculateExample(2000,200,65.10,21060.01)?.monthly,601);
  assert.equal(calculateExample(0.01,0,8.01,99)?.monthly,10000);
  for (const bad of [NaN,Infinity,-1,1000001,0.001]) assert.equal(calculateExample(bad,200,65,21000),null);
});
test("every flow step has matching Thai restaurant-voice evidence and a local audio file", () => {
  const steps = JSON.parse(read("apps/web/components/marketing/cost-pricing/flow.json").toString());
  const evidence = JSON.parse(read("apps/web/public/audio/cost-pricing/th/provenance.json").toString());
  assert.equal(steps.length,7); assert.equal(evidence.clips.length,7);
  for (const [i, step] of steps.entries()) {
    assert.ok(step.en.title && step.en.speech && step.th.title);
    assert.equal(evidence.clips[i].text,step.th.speech);
    assert.equal(evidence.clips[i].voice,"thai_som");
    assert.ok(evidence.clips[i].duration>0 && evidence.clips[i].duration<90);
    assert.equal(createHash("sha256").update(read(`apps/web/public${step.audio}`)).digest("hex"),evidence.clips[i].sha256);
  }
  assert.ok(read("apps/web/public/audio/cost-pricing/th/summary.mp3").length>1000);
});
