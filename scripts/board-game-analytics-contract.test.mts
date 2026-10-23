import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  availabilityIntervals,
  bucketByWeekdayHour,
  clipIntervals,
  intervalMinutes,
  reportRangeBounds,
  utilization,
  zonedDateTime,
  observedEnd,
  unionIntervals,
  assertAnalyticsDate,
} from "../apps/web/lib/bms/boardGameAnalyticsMath.ts";

const ROOT = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const everyDay = (opensAt: string, closesAt: string, effectiveFrom = "2025-01-01") =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt, closesAt, closed: false, effectiveFrom }));

test("calendar-day bounds follow the shop timezone, including both DST transitions", () => {
  const spring = reportRangeBounds({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York");
  const fall = reportRangeBounds({ from: "2026-11-01", to: "2026-11-01" }, "America/New_York");
  assert.equal(intervalMinutes([spring]), 23 * 60);
  assert.equal(intervalMinutes([fall]), 25 * 60);
  assert.equal(reportRangeBounds({ from: "2026-01-01", to: "2026-01-01" }, "Asia/Bangkok").start.toISOString(), "2025-12-31T17:00:00.000Z");
});

test("effective-dated hours choose the latest applicable row and support overnight service", () => {
  const hours = [
    ...everyDay("10:00", "22:00"),
    { weekday: 3, opensAt: "18:00", closesAt: "02:00", closed: false, effectiveFrom: "2026-09-30" },
    { weekday: 4, opensAt: "18:00", closesAt: "02:00", closed: false, effectiveFrom: "2026-10-01" },
  ];
  const result = availabilityIntervals(hours, { from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok");
  assert.deepEqual(result.missingDates, []);
  assert.equal(intervalMinutes(result.intervals), 8 * 60);
  assert.equal(result.intervals[0].start.toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(result.intervals.at(-1)?.end.toISOString(), "2026-10-01T17:00:00.000Z");
});

test("missing hours are explicit while configured closed days are a known zero denominator", () => {
  const missing = availabilityIntervals([], { from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok");
  assert.deepEqual(missing.missingDates, ["2026-10-01"]);
  const closed = availabilityIntervals([
    { weekday: 3, opensAt: null, closesAt: null, closed: true, effectiveFrom: "2026-01-01" },
    { weekday: 4, opensAt: null, closesAt: null, closed: true, effectiveFrom: "2026-01-01" },
  ], { from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok");
  assert.deepEqual(closed.missingDates, []);
  assert.equal(intervalMinutes(closed.intervals), 0);
  assert.equal(utilization(0, 0), null);
});

test("occupancy is clipped to the selected calendar range and structured opening hours", () => {
  const range = reportRangeBounds({ from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok");
  const clipped = clipIntervals([{
    start: zonedDateTime("2026-09-30", "23:00", "Asia/Bangkok"),
    end: zonedDateTime("2026-10-02", "02:00", "Asia/Bangkok"),
  }], range);
  assert.equal(intervalMinutes(clipped), 24 * 60);
});

test("golden fixture: two eight-hour tables and two occupied table-hours equal 12.5 percent", () => {
  const availableMinutes = 2 * 8 * 60;
  const occupiedMinutes = 2 * 60;
  assert.equal(utilization(occupiedMinutes, availableMinutes), 12.5);
});

test("weekday/hour buckets retain cross-midnight minutes without using the host timezone", () => {
  const rows = bucketByWeekdayHour([{
    start: zonedDateTime("2026-10-01", "23:30", "Asia/Bangkok"),
    end: zonedDateTime("2026-10-02", "00:30", "Asia/Bangkok"),
  }], "Asia/Bangkok");
  assert.deepEqual(rows, [
    { weekday: 4, hour: 23, minutes: 30 },
    { weekday: 5, hour: 0, minutes: 30 },
  ]);
});

test("the ledger is written in the same service transactions for open, move, merge, detach and close", () => {
  const cafe = read("apps/web/lib/bms/boardGameCafe.ts");
  const status = read("apps/web/lib/bms/boardGameSessionStatus.ts");
  assert.match(cafe, /openTableOccupancyInTx/);
  assert.match(cafe, /moveTableOccupancyInTx/);
  assert.match(cafe, /closeTableOccupancyInTx[\s\S]*MERGED_INTO/);
  assert.match(status, /closeTableOccupancyInTx[\s\S]*CANCELLED[\s\S]*CLOSED/);
  assert.match(status, /status === "PAID" \|\| session\.status === "CANCELLED"/);
  assert.doesNotMatch(status, /status !== "OPEN"/);
  assert.doesNotMatch(read("apps/web/lib/bms/boardGameOccupancy.ts"), /getClient|COMMIT|ROLLBACK/);
});

test("analytics reuses sales evidence, typed GraphQL, branch scope and nullable cost disclosure", () => {
  const service = read("apps/web/lib/bms/boardGameAnalytics.ts");
  const graphql = read("apps/web/graphql/bmsBoardGameAnalytics.ts");
  const evidence = read("apps/web/lib/bms/salesEvidence.ts");
  const reports = read("apps/web/lib/bms/reportEngine.ts");
  assert.match(service, /scanSalesEvidenceInTx/);
  assert.match(service, /salesEvents\.push\(event\)[\s\S]{0,60}options\.includeCosts === true, timezone/);
  assert.match(service, /salesEvents\.forEach\(addTabEvent\)/);
  assert.match(evidence, /AT TIME ZONE[\s\S]{0,80}\$8::text/);
  assert.doesNotMatch(service, /FROM\s+bms_order_items/i);
  assert.match(service, /BOARD_GAME_ANALYTICS_ALL_BRANCH_ACCESS_REQUIRED/);
  assert.match(service, /COST_HIDDEN/);
  assert.match(graphql, /requirePermission\(ctx, "report\.view"\)/);
  assert.match(graphql, /tabCost: String/);
  assert.doesNotMatch(graphql, /:\s*JSON[!\s]/);
  assert.match(reports, /params->>'includeCosts'/);
  assert.match(reports, /boardCosts/);
});

test("invalid calendar dates return domain validation rather than RangeError", () => {
  for (const date of ["2026-13-01", "2026-02-30", "2026-00-01", "invalid"]) {
    assert.throws(() => assertAnalyticsDate(date), { message: "BOARD_GAME_ANALYTICS_INVALID_DATE" });
  }
});

test("overlapping overnight schedules are a union, never double capacity", () => {
  const rows = everyDay("10:00", "20:00");
  rows[3] = { ...rows[3], opensAt: "18:00", closesAt: "12:00" };
  const result = availabilityIntervals(rows, { from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok");
  assert.equal(intervalMinutes(result.intervals), 20 * 60);
  assert.equal(result.intervals.length, 1);
  assert.equal(intervalMinutes(unionIntervals([...result.intervals, ...result.intervals])), 20 * 60);
});

test("open and future-ended intervals cannot extend past database observation time", () => {
  const now = new Date("2026-10-01T05:00:00Z"), end = new Date("2026-10-01T17:00:00Z");
  assert.equal(observedEnd(null, now, end).toISOString(), now.toISOString());
  assert.equal(observedEnd(end, now, end).toISOString(), now.toISOString());
  assert.equal(observedEnd(null, now, new Date("2026-09-30T17:00:00Z")).toISOString(), "2026-09-30T17:00:00.000Z");
});

test("DST gap/fold disambiguation and half-hour rollback preserve real minutes", () => {
  assert.equal(zonedDateTime("2026-03-08", "02:30", "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(zonedDateTime("2026-11-01", "01:30", "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
  const buckets = bucketByWeekdayHour([reportRangeBounds({ from: "2026-04-05", to: "2026-04-05" }, "Australia/Lord_Howe")], "Australia/Lord_Howe");
  assert.equal(buckets.reduce((sum, row) => sum + row.minutes, 0), 24.5 * 60);
  assert.equal(buckets.find((row) => row.hour === 1)?.minutes, 90);
});

test("10.89 is rerunnable, tenant-isolated, granted, backfill-labelled and extends report storage", () => {
  const sql = read("db/migrations/10.89__bms_board_game_profit_utilization.sql");
  for (const table of ["bms_board_game_table_occupancy", "bms_board_game_session_table_occupancy", "bms_board_game_branch_hours"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO bms_app`));
  }
  assert.match(sql, /backfilled[\s\S]*TRUE/);
  assert.match(sql, /BOARD_GAME_ANALYTICS/);
  assert.match(sql, /ROLLBACK:/);
});

test("mutation witnesses kill denominator, clipping, midnight, DST, zero and precision regressions", () => {
  const correct = {
    percent: utilization(120, 960),
    zero: utilization(0, 0),
    clipped: intervalMinutes(clipIntervals([{ start: new Date(0), end: new Date(180 * 60_000) }], { start: new Date(60 * 60_000), end: new Date(120 * 60_000) })),
    overnight: intervalMinutes(availabilityIntervals(everyDay("18:00", "02:00"), { from: "2026-10-01", to: "2026-10-01" }, "Asia/Bangkok").intervals),
    spring: intervalMinutes([reportRangeBounds({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York")]),
  };
  const mutants = [
    120 / 480 * 100,
    0,
    180,
    16 * 60,
    24 * 60,
    Math.round((120 / 960) * 100),
    Math.round((120 / 960) * 10) / 10,
    100,
  ];
  const witnesses = [correct.percent, correct.zero, correct.clipped, correct.overnight, correct.spring, correct.percent, correct.percent, correct.percent];
  mutants.forEach((mutant, index) => assert.notDeepEqual(mutant, witnesses[index], `mutant ${index + 1} survived`));
});
