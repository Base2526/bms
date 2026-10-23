export type TimeInterval = { start: Date; end: Date };
export type LocalDateRange = { from: string; to: string };
export type EffectiveOpeningHour = {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  closed: boolean;
  effectiveFrom: string;
};

const DAY_MS = 86_400_000;
const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;

export function assertAnalyticsDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!DATE_RE.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("BOARD_GAME_ANALYTICS_INVALID_DATE");
  }
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function localFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}
function localParts(at: Date, timezone: string, formatter = localFormatter(timezone)) {
  const parts = formatter.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** Convert a local wall-clock value without assuming a fixed UTC offset (DST-safe). */
export function zonedDateTime(date: string, time: string, timezone: string): Date {
  assertAnalyticsDate(date);
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw new Error("BOARD_GAME_ANALYTICS_INVALID_TIME");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = localFormatter(timezone);
  const represented = (instant: number) => {
    const p = localParts(new Date(instant), timezone, formatter);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const offsets = new Set([-2, -1, 0, 1, 2].map((days) => {
    const instant = target + days * DAY_MS;
    return represented(instant) - instant;
  }));
  const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
  // Compatible disambiguation: first occurrence in a fold, forward by the gap
  // for a nonexistent wall time. Never oscillate between two guesses.
  const exact = candidates.find((instant) => represented(instant) === target);
  const resolved = exact ?? candidates.filter((instant) => represented(instant) > target)
    .sort((a, b) => represented(a) - represented(b))[0];
  if (resolved == null) throw new Error("BOARD_GAME_ANALYTICS_INVALID_TIME");
  return new Date(resolved);
}

export function reportRangeBounds(range: LocalDateRange, timezone: string): TimeInterval {
  assertAnalyticsDate(range.from); assertAnalyticsDate(range.to);
  if (range.from > range.to) throw new Error("BOARD_GAME_ANALYTICS_INVALID_RANGE");
  return { start: zonedDateTime(range.from, "00:00:00", timezone), end: zonedDateTime(addDays(range.to, 1), "00:00:00", timezone) };
}

export function clipIntervals(intervals: readonly TimeInterval[], range: TimeInterval): TimeInterval[] {
  if (!(range.start < range.end)) throw new Error("BOARD_GAME_ANALYTICS_INVALID_RANGE");
  return intervals.flatMap((interval) => {
    const start = interval.start > range.start ? interval.start : range.start;
    const end = interval.end < range.end ? interval.end : range.end;
    return start < end ? [{ start, end }] : [];
  });
}

function applicableHour(hours: readonly EffectiveOpeningHour[], weekday: number, date: string) {
  return hours
    .filter((row) => row.weekday === weekday && row.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export function availabilityIntervals(
  hours: readonly EffectiveOpeningHour[],
  range: LocalDateRange,
  timezone: string,
): { intervals: TimeInterval[]; missingDates: string[] } {
  const bounds = reportRangeBounds(range, timezone);
  const intervals: TimeInterval[] = [];
  const missingDates = new Set<string>();
  // Include the prior service day because an overnight window may occupy the selected
  // calendar day after midnight. Omitting it understates both capacity and utilization.
  for (let date = addDays(range.from, -1); date <= range.to; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const row = applicableHour(hours, weekday, date);
    if (!row) { missingDates.add(date < range.from ? range.from : date); continue; }
    if (row.closed) continue;
    if (!row.opensAt || !row.closesAt) { missingDates.add(date < range.from ? range.from : date); continue; }
    const start = zonedDateTime(date, row.opensAt, timezone);
    const endDate = row.closesAt <= row.opensAt ? addDays(date, 1) : date;
    const end = zonedDateTime(endDate, row.closesAt, timezone);
    intervals.push(...clipIntervals([{ start, end }], bounds));
  }
  return { intervals: unionIntervals(intervals), missingDates: [...missingDates].sort() };
}

/** Union only intervals for the SAME resource; different tables remain additive. */
export function unionIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const merged: TimeInterval[] = [];
  for (const row of [...intervals].filter((row) => row.start < row.end).sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = merged.at(-1);
    if (last && row.start <= last.end) {
      if (row.end > last.end) last.end = row.end;
    } else merged.push({ ...row });
  }
  return merged;
}

export function observedEnd(endedAt: Date | null, observedAt: Date, rangeEnd: Date): Date {
  return new Date(Math.min((endedAt ?? observedAt).getTime(), observedAt.getTime(), rangeEnd.getTime()));
}

export function intervalMinutes(intervals: readonly TimeInterval[]): number {
  return intervals.reduce((sum, row) => sum + (row.end.getTime() - row.start.getTime()) / 60_000, 0);
}

export function availableMinutes(
  hours: readonly EffectiveOpeningHour[],
  range: LocalDateRange,
  timezone: string,
): number {
  return intervalMinutes(availabilityIntervals(hours, range, timezone).intervals);
}

export function intersectIntervals(left: readonly TimeInterval[], right: readonly TimeInterval[]): TimeInterval[] {
  const result: TimeInterval[] = [];
  for (const a of left) for (const b of right) {
    const start = a.start > b.start ? a.start : b.start;
    const end = a.end < b.end ? a.end : b.end;
    if (start < end) result.push({ start, end });
  }
  return result;
}

export function utilization(occupiedMinutes: number, available: number): number | null {
  if (!Number.isFinite(occupiedMinutes) || !Number.isFinite(available) || occupiedMinutes < 0 || available < 0) {
    throw new Error("BOARD_GAME_ANALYTICS_INVALID_MINUTES");
  }
  return available === 0 ? null : Math.round((occupiedMinutes / available) * 10_000) / 100;
}

export function bucketByWeekdayHour(intervals: readonly TimeInterval[], timezone: string) {
  const buckets = new Map<string, { weekday: number; hour: number; minutes: number }>();
  const formatter = localFormatter(timezone);
  for (const interval of intervals) {
    let cursor = interval.start.getTime();
    const end = interval.end.getTime();
    while (cursor < end) {
      const parts = localParts(new Date(cursor), timezone, formatter);
      const localDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      // Also stop at the next real minute. A DST rollback can change the local
      // hour BEFORE the next local-hour boundary (including half-hour offsets).
      const segmentEnd = Math.min(end, (Math.floor(cursor / 60_000) + 1) * 60_000);
      const weekday = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
      const key = `${weekday}:${parts.hour}`;
      const bucket = buckets.get(key) ?? { weekday, hour: parts.hour, minutes: 0 };
      bucket.minutes += (segmentEnd - cursor) / 60_000;
      buckets.set(key, bucket);
      cursor = segmentEnd;
    }
  }
  return [...buckets.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}
