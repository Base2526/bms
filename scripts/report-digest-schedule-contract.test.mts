import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { storeLocalNow, shouldSendNow } from "../apps/web/lib/bms/reportDigest.ts";
import { slotFor } from "../apps/web/scheduler/runner.mjs";

test("a configured shop hour is reached by hourly dispatch in its own timezone", () => {
  const jobs = JSON.parse(readFileSync(new URL("../apps/web/scheduler/jobs.json", import.meta.url), "utf8"));
  const digest = jobs.find((job: { name: string }) => job.name === "report-digest");
  assert.equal(digest.group, "hourly");
  const utcEightBangkok = Date.parse("2026-11-12T01:00:00Z");
  assert.equal(slotFor(digest, utcEightBangkok + 5 * 60_000), utcEightBangkok);
  assert.equal(shouldSendNow({ frequency: "DAILY", sendHour: 8, sendWeekday: null, sendDayOfMonth: null },
    storeLocalNow("Asia/Bangkok", new Date(utcEightBangkok))), true);
  assert.equal(shouldSendNow({ frequency: "DAILY", sendHour: 9, sendWeekday: null, sendDayOfMonth: null },
    storeLocalNow("Asia/Bangkok", new Date(utcEightBangkok))), false);
  assert.equal(shouldSendNow({ frequency: "DAILY", sendHour: 20, sendWeekday: null, sendDayOfMonth: null },
    storeLocalNow("America/New_York", new Date(utcEightBangkok))), true);
});
