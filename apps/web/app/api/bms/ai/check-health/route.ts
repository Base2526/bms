// =============================================================
// POST /api/bms/ai/check-health — cron ทดสอบ shared AI provider เป็นระยะ
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/ai/check-health" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (ถ้าตั้งไว้) — ตาม pattern
// เดียวกับ /api/bms/channels/check-health
//
// ต่างจาก channel health (ซึ่งพึ่ง event จริงเท่านั้น ไม่มี active probe) — AI provider
// มักไม่มี traffic สม่ำเสมอพอที่จะรู้ว่าล่มตั้งแต่เมื่อไหร่ จึง "ยิงทดสอบจริง" เป็นระยะ
// แทนที่จะรอ event จริงมาชน — reuse testPlatformAiKey() เดิม (ปุ่ม "ทดสอบ" ในหน้า
// /admin/env) ซึ่งเขียนผล ok/error ลง bms_ai_provider_health ให้แล้วเป็น side effect
// (ดู aiConfig.ts testAnthropicCompatibleSharedProvider/testAnthropicOcrKey/testQwenOcrKey)
//
// DeepSeek/Anthropic OCR/Qwen ทดสอบด้วย completion/OCR request จริง (มี usage เล็กน้อยจริง
// ไม่ใช่แค่ ping เปล่าๆ แบบ Anthropic chat /v1/models) — ตั้ง cron ให้ยิงเป็นชั่วโมงพอ
// (เช่น รายชั่วโมง) ไม่ต้องถี่กว่านั้น เพราะมีต้นทุนสะสมจริงต่อครั้งแม้จะเล็กน้อยก็ตาม
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { testPlatformAiKey } from "@/lib/bms/aiConfig";
import { recordJobRun } from "@/lib/bms/jobRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKED_PROVIDERS = ["anthropic", "anthropic-ocr", "deepseek", "qwen"] as const;

export async function POST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const results = await recordJobRun("ai-health", "cron", () =>
      Promise.all(
        CHECKED_PROVIDERS.map(async (provider) => {
          const result = await testPlatformAiKey(provider);
          return { provider, ...result };
        })
      )
    );
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
