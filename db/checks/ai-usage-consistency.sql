-- ตรวจว่าการบันทึกการใช้งาน AI ตรงกับความจริงไหม — **อ่านอย่างเดียว ปลอดภัยกับทุกฐาน**
-- เขียนด้วยมือ (ไม่ได้ generate ต่างจาก schema-readiness.sql ในโฟลเดอร์เดียวกัน)
--
-- บนเซิร์ฟเวอร์ production ไม่มี Node (`npx: command not found`) จึงต้องเป็น .sql:
--   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
--     exec -T postgres psql -U <user> -d <db> -f - < db/checks/ai-usage-consistency.sql
--
-- เขียนเพราะ finalizeAiUsageEvent เคยล้ม 100% โดยไม่มีอะไรฟ้อง (พารามิเตอร์ต้นทุนถูก infer
-- เป็น integer จาก literal 0) แถวจึงค้างที่ 'started' แล้วถูกตัวกวาดปิดเป็น 'failed'
-- ทำให้ token/cost เป็น 0 ทั้งที่เรียก provider ไปแล้วจริง — สี่ด่านล่างคือวิธีดูว่าฐานนี้โดนไหม

\echo '=== 1) เส้นทาง finalize ตัวจริงสำเร็จกี่ครั้ง (นับเฉพาะแถวที่ insert ด้วยโค้ดรุ่นปัจจุบัน) ==='
-- from_sweep = true แปลว่าแถวนั้นถูก "ตัวกวาด" ปิด ไม่ใช่ finalize ปิด
-- ถ้าไม่มีแถว cost_status='measured' เลย = เส้นทางนี้ยังไม่เคยสำเร็จบนฐานนี้
SELECT COALESCE(meta->>'cost_status', '(ไม่มี)')            AS cost_status,
       COALESCE(meta->>'stale_usage_finalization', 'false') AS from_sweep,
       status,
       count(*)                                             AS rows,
       count(input_tokens)                                  AS with_tokens,
       count(actual_cost_usd)                               AS with_cost,
       sum(provider_calls)                                  AS provider_calls,
       max(created_at)::date                                AS last_seen
  FROM bms_ai_usage_events
 WHERE meta ? 'credit_policy'
 GROUP BY 1, 2, 3
 ORDER BY 4 DESC;

\echo '=== 2) incident ที่ยืนยันสาเหตุ (ว่างได้ถ้ายังไม่ deploy โค้ดที่รายงาน) ==='
-- ai.usage_finalize_failed          = ปิด usage event ไม่สำเร็จ (token/cost ของแถวนั้นหายถาวร)
-- ai.provider_attempt_unrecorded    = เรียก provider แล้วแต่บันทึกไม่ลง (ห้ามคืน credit ให้แถวนั้น)
SELECT code, count(*) AS incidents, min(created_at)::date AS first_seen,
       max(created_at)::date AS last_seen, max(error_message) AS sample_error
  FROM bms_failure_incidents
 WHERE code IN ('ai.usage_finalize_failed', 'ai.provider_attempt_unrecorded')
 GROUP BY 1
 ORDER BY 2 DESC;

\echo '=== 3) ตัวนับรายเดือน vs ความจริงจาก events (drift ต้องเป็น 0 เมื่อ events > 0) ==='
-- credits_consumed ถูกดูแลด้วยการบวก/ลบทีละครั้ง ขณะที่ events ถือความจริง
-- ไม่มีอะไรบังคับให้สองฝั่งเท่ากัน (ยังไม่มี balanceMismatchCount แบบ loyalty/store credit/AR)
--
-- ⚠️ อ่าน `events` ก่อน `credit_drift` เสมอ: เดือนที่ `events = 0` แต่ `credits_consumed > 0`
-- คือข้อมูลยุคก่อนมีตาราง bms_ai_usage_events (migration 7.27 ยกคอลัมน์ `count` เดิมขึ้นมาเป็น
-- credits_consumed) — **drift ของเดือนพวกนั้นเป็นเรื่องปกติ ไม่ใช่สัญญาณ**
-- ตัวที่ต้องดูคือเดือนที่มี events แล้วยัง drift
SELECT m.year_month,
       m.tenant_id,
       COALESCE(e.events, 0)                             AS events,
       m.credits_consumed,
       COALESCE(e.credits, 0)                            AS events_credits,
       m.credits_consumed - COALESCE(e.credits, 0)       AS credit_drift,
       m.estimated_cost,
       COALESCE(e.cost, 0)                               AS events_cost,
       COALESCE(e.tokens, 0)                             AS tokens,
       COALESCE(e.calls, 0)                              AS provider_calls
  FROM bms_ai_usage_monthly m
  LEFT JOIN (
        SELECT tenant_id, year_month,
               count(*)                                                     AS events,
               SUM(billable_credits)                                        AS credits,
               SUM(actual_cost_usd)                                         AS cost,
               SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))  AS tokens,
               SUM(provider_calls)                                          AS calls
          FROM bms_ai_usage_events
         GROUP BY 1, 2
       ) e ON e.tenant_id = m.tenant_id AND e.year_month = m.year_month
 WHERE m.year_month >= to_char(now() - interval '3 months', 'YYYY-MM')
 ORDER BY 1 DESC, 6 DESC, 2;

\echo '=== 4) provider call ที่เกิดจริงแต่ไม่มี token บันทึกไว้ (3 เดือนล่าสุด) ==='
-- ตัวเลขนี้คือความเสียหายโดยตรง: เสียเงินไปแล้วแต่ตอบไม่ได้ว่าเท่าไร
-- โทเคนของแถวพวกนี้ **กู้ไม่ได้** (response ของ provider ไม่มีเก็บไว้) ห้าม backfill ด้วยการเดา
SELECT year_month,
       count(*)                                                    AS events,
       sum(provider_calls)                                         AS calls_made,
       COALESCE(sum(provider_calls) FILTER (WHERE input_tokens IS NULL), 0) AS calls_without_tokens,
       sum(unpriced_provider_calls)                                 AS unpriced_calls,
       round(100.0 * COALESCE(sum(provider_calls) FILTER (WHERE input_tokens IS NULL), 0)
             / NULLIF(sum(provider_calls), 0), 1)                   AS pct_blind
  FROM bms_ai_usage_events
 WHERE provider_calls > 0
   AND year_month >= to_char(now() - interval '3 months', 'YYYY-MM')
 GROUP BY 1
 ORDER BY 1 DESC;
