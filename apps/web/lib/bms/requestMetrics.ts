// =============================================================
// BMS Request Metrics — latency (p50/p95/p99) + error rate ต่อ operation
// -------------------------------------------------------------
// เดิมระบบไม่มีที่เก็บ timing ของ request เลย — /admin/system-health บอกได้แค่
// "DB/Redis/provider สถานะเป็นยังไงตอนนี้" แต่ไม่รู้ว่า operation ไหนที่ผู้ใช้
// จริงเจอช้า หรือ error บ่อย (คำถาม "ช้าเพราะอะไร" ตอบไม่ได้)
//
// ทำไมเก็บใน Redis ไม่ใช่ Postgres:
//   เขียน 1 แถวต่อ 1 request ลง Postgres = เพิ่มภาระเขียนให้ DB ตัวเดียวกับที่
//   กำลังพยายามวัดว่าช้าเพราะอะไร (วัดแล้วทำให้ช้าลงเอง) Redis มีอยู่แล้วและ
//   fail-open ได้ตาม pattern เดียวกับ lib/cache.ts
//
// ทำไมเก็บเป็น histogram ไม่ใช่ค่า latency ทุกตัว:
//   เก็บทุกค่า = memory ไม่มีเพดาน. histogram bucket แบบ Prometheus ใช้ memory
//   คงที่ต่อ operation, merge ข้าม instance ได้ฟรีด้วย HINCRBY (สำคัญเพราะ
//   multi-instance readiness ทำไปแล้ว — in-process Map จะให้เลขต่อ instance
//   ซึ่งอ่านผิดทันทีที่มี replica) แลกกับ percentile ที่เป็นค่าประมาณ
//
// fail-open เสมอ: metric ที่บันทึกไม่สำเร็จต้องไม่ทำให้ request พัง — record()
// ไม่ throw และไม่ถูก await บน request path
// =============================================================

import { sharedRedisClient as redis } from "@/lib/cache";

/** ขอบบนของแต่ละ bucket (ms) — ตัวสุดท้ายคือ +Inf */
const BUCKET_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, Infinity];

/** ความกว้างของ time bucket — 5 นาที = อ่านย้อน 1 ชม. ใช้แค่ 12 key ไม่ใช่ 60 */
const BUCKET_MINUTES = 5;
/** เก็บนานกว่า window ที่ยาวสุดพอสมควร แล้วปล่อยให้ TTL ลบเอง (ไม่มี cron cleanup) */
const BUCKET_TTL_SECONDS = 4 * 60 * 60;

const KEY_PREFIX = "metrics:req:";
/** field พิเศษสำหรับนับ error code รวมทั้งระบบ (ไม่แยกต่อ operation เพื่อคุมจำนวน field) */
const ERR_CODE_FIELD_PREFIX = "__errcode|";

function bucketKey(epochMs: number): string {
  const slot = Math.floor(epochMs / (BUCKET_MINUTES * 60_000));
  return `${KEY_PREFIX}${slot}`;
}

function histogramIndex(durationMs: number): number {
  for (let i = 0; i < BUCKET_BOUNDS_MS.length; i++) {
    if (durationMs <= BUCKET_BOUNDS_MS[i]) return i;
  }
  return BUCKET_BOUNDS_MS.length - 1;
}

/**
 * ชื่อ operation มาจาก client (document ที่ส่งมา) จึงเป็น untrusted —
 * จำกัดอักขระ+ความยาวกัน field แปลกปลอม. **ข้อจำกัดที่รู้ตัว**: client ที่ตั้งใจ
 * ส่ง operationName สุ่มไปเรื่อยๆ ยังทำให้จำนวน field ใน bucket โตได้ (จำกัด
 * ความเสียหายด้วย TTL 4 ชม. ต่อ key ไม่ได้ค้างถาวร)
 */
export function sanitizeMetricName(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9_.:/-]/g, "");
  return cleaned.slice(0, 60) || "anonymous";
}

export type RecordRequestMetricInput = {
  /** ใส่ prefix บอกที่มาเสมอ เช่น "gql:BmsDashboard" — คนละ namespace กับ REST ในอนาคต */
  name: string;
  durationMs: number;
  ok: boolean;
  /** GraphQL extensions.code เช่น UNAUTHENTICATED / FORBIDDEN / INTERNAL_SERVER_ERROR */
  errorCode?: string | null;
};

/**
 * บันทึก 1 request — fire-and-forget, ไม่ throw, ไม่ควร await บน request path
 * (ยิงหลังตอบ response แล้วจึงไม่นับรวมใน latency ที่วัด แต่ยังไม่อยากให้กิน
 * เวลา response จริงเพิ่ม)
 */
export function recordRequestMetric(input: RecordRequestMetricInput): void {
  const name = sanitizeMetricName(input.name);
  const duration = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;
  const key = bucketKey(Date.now());
  const idx = histogramIndex(duration);

  const pipeline = redis.pipeline();
  pipeline.hincrby(key, `${name}|c`, 1);
  pipeline.hincrbyfloat(key, `${name}|s`, duration);
  pipeline.hincrby(key, `${name}|h${idx}`, 1);
  if (!input.ok) {
    pipeline.hincrby(key, `${name}|e`, 1);
    const code = sanitizeMetricName(input.errorCode || "UNKNOWN");
    pipeline.hincrby(key, `${ERR_CODE_FIELD_PREFIX}${code}`, 1);
  }
  pipeline.expire(key, BUCKET_TTL_SECONDS);

  pipeline.exec().catch((err: any) => {
    console.error("[metrics] record failed (ignored)", err?.message ?? err);
  });
}

export type OperationMetric = {
  name: string;
  count: number;
  errors: number;
  errorRatePct: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** count x avg — ใช้เรียงว่า operation ไหน "กินเวลารวม" มากสุด ไม่ใช่แค่ช้าต่อครั้ง */
  totalMs: number;
};

export type RequestMetricsSummary =
  | {
      ok: true;
      windowMinutes: number;
      totalRequests: number;
      totalErrors: number;
      errorRatePct: number;
      overallP95Ms: number;
      operations: OperationMetric[];
      errorCodes: { code: string; count: number }[];
    }
  | { ok: false; error: string };

/**
 * percentile จาก histogram — interpolate เชิงเส้นภายใน bucket ที่ตรงกับ target
 * (แบบเดียวกับ histogram_quantile ของ Prometheus) จึงเป็น "ค่าประมาณ" ไม่ใช่
 * percentile จริงจากค่าดิบทุกตัว
 */
function percentileFromHistogram(buckets: number[], total: number, p: number): number {
  if (total <= 0) return 0;
  const target = total * p;
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i++) {
    const inBucket = buckets[i];
    if (inBucket <= 0) continue;
    const prevCumulative = cumulative;
    cumulative += inBucket;
    if (cumulative < target) continue;

    const lower = i === 0 ? 0 : BUCKET_BOUNDS_MS[i - 1];
    const upper = BUCKET_BOUNDS_MS[i];
    // bucket +Inf ไม่มีขอบบน — คืนขอบล่างพร้อมสัญญาณว่า "อย่างน้อยเท่านี้"
    if (!Number.isFinite(upper)) return Math.round(lower);
    const fraction = (target - prevCumulative) / inBucket;
    return Math.round(lower + fraction * (upper - lower));
  }
  return Math.round(BUCKET_BOUNDS_MS[BUCKET_BOUNDS_MS.length - 2] ?? 0);
}

type Accumulator = { count: number; sum: number; errors: number; buckets: number[] };

/** อ่านสรุป metric ย้อนหลัง N นาที (รวมทุก time bucket ที่ทับกับช่วง จึงอาจเกินไม่ถึง 5 นาที) */
export async function getRequestMetrics(windowMinutes = 60): Promise<RequestMetricsSummary> {
  const clampedWindow = Math.min(Math.max(Math.floor(windowMinutes) || 60, BUCKET_MINUTES), 240);
  // ต้องรวม bucket ที่คร่อมขอบต้นช่วงด้วย ไม่เช่นนั้น window 60 นาทีจะอ่านจริง
  // เพียง 55-60 นาทีตามตำแหน่งของเวลาปัจจุบันใน bucket.
  const bucketCount = Math.ceil(clampedWindow / BUCKET_MINUTES) + 1;

  try {
    const now = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < bucketCount; i++) {
      keys.push(bucketKey(now - i * BUCKET_MINUTES * 60_000));
    }

    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);
    const results = await pipeline.exec();

    const byOperation = new Map<string, Accumulator>();
    const errorCodes = new Map<string, number>();

    for (const entry of results ?? []) {
      const [err, value] = entry as [Error | null, Record<string, string> | null];
      if (err || !value) continue;

      for (const [field, rawValue] of Object.entries(value)) {
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) continue;

        if (field.startsWith(ERR_CODE_FIELD_PREFIX)) {
          const code = field.slice(ERR_CODE_FIELD_PREFIX.length);
          errorCodes.set(code, (errorCodes.get(code) ?? 0) + numeric);
          continue;
        }

        const sep = field.lastIndexOf("|");
        if (sep <= 0) continue;
        const name = field.slice(0, sep);
        const kind = field.slice(sep + 1);

        let acc = byOperation.get(name);
        if (!acc) {
          acc = { count: 0, sum: 0, errors: 0, buckets: new Array(BUCKET_BOUNDS_MS.length).fill(0) };
          byOperation.set(name, acc);
        }

        if (kind === "c") acc.count += numeric;
        else if (kind === "s") acc.sum += numeric;
        else if (kind === "e") acc.errors += numeric;
        else if (kind.startsWith("h")) {
          const idx = Number(kind.slice(1));
          if (Number.isInteger(idx) && idx >= 0 && idx < acc.buckets.length) acc.buckets[idx] += numeric;
        }
      }
    }

    const operations: OperationMetric[] = [];
    const overallBuckets = new Array(BUCKET_BOUNDS_MS.length).fill(0);
    let totalRequests = 0;
    let totalErrors = 0;

    for (const [name, acc] of byOperation) {
      if (acc.count <= 0) continue;
      totalRequests += acc.count;
      totalErrors += acc.errors;
      for (let i = 0; i < overallBuckets.length; i++) overallBuckets[i] += acc.buckets[i];

      operations.push({
        name,
        count: acc.count,
        errors: acc.errors,
        errorRatePct: Math.round((acc.errors / acc.count) * 1000) / 10,
        avgMs: Math.round(acc.sum / acc.count),
        p50Ms: percentileFromHistogram(acc.buckets, acc.count, 0.5),
        p95Ms: percentileFromHistogram(acc.buckets, acc.count, 0.95),
        p99Ms: percentileFromHistogram(acc.buckets, acc.count, 0.99),
        totalMs: Math.round(acc.sum),
      });
    }

    operations.sort((a, b) => b.totalMs - a.totalMs);

    return {
      ok: true,
      windowMinutes: clampedWindow,
      totalRequests,
      totalErrors,
      errorRatePct: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 1000) / 10 : 0,
      overallP95Ms: percentileFromHistogram(overallBuckets, totalRequests, 0.95),
      operations,
      errorCodes: [...errorCodes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
