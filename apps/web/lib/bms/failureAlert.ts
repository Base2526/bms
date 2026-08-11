// =============================================================
// BMS Failure Alerts — แจ้งเตือนร้าน + platform admin เมื่อระบบขัดข้องจริง
// -------------------------------------------------------------
// เดิมความล้มเหลวที่ลูกค้าเจอเป็นแค่ console.error → ไม่มีใครรู้จนลูกค้าบ่น
// (เคสจริง: ลูกค้าได้ "ขออภัยค่ะ ระบบขัดข้องชั่วคราว" 3 ครั้งข้ามวัน โดยที่
//  AI Provider Health ยังขึ้น CONNECTED ทุกช่อง เพราะต้นเหตุเป็น schema error
//  ของ Postgres ไม่ใช่ provider ล่ม — จึงไม่มี health check ไหนจับได้)
//
// ขอบเขต/ผู้รับ (ตัดสินใจร่วมกับ user แล้ว — ดู migration 7.36):
//   tier A = ลูกค้าได้รับผลกระทบจริง (เห็นข้อความ error หรือไม่ได้รับคำตอบเลย)
//            → แจ้ง "ร้าน" (ในแอป) + platform admin  เพราะร้านต้องตามลูกค้ากลับ
//   tier B = ระบบยังตอบได้แต่คุณภาพลด / งานเบื้องหลังพัง
//            → platform admin เท่านั้น (ร้านแก้เองไม่ได้ แจ้งไปจะเป็น noise)
//
// นโยบายการแจ้ง: "ครั้งแรกทันที + cooldown ต่อ (tenant, code)" ไม่ใช่ threshold
//   แบบ 3-ครั้งใน-10-นาที ของ maybeAlertSlackForLog (lib/log/alertSlackServer.ts)
//   เพราะเคสจริงเกิดห่างกันหลายชั่วโมง จะไม่เข้าเงื่อนไข threshold เลย
//
// ต้องไม่ throw เด็ดขาด — เรียกจาก catch block ของ path ที่ยังต้องตอบลูกค้าต่อ
//   (best-effort เหมือน notifyOrderStatusEmail / publishInboxChanged)
// =============================================================

import { query } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { getTenantName } from "./platform";

export type FailureTier = "A" | "B";
export type FailureSurface = "customer" | "staff" | "system";

export type BmsFailureCode =
  // --- tier A: ลูกค้าได้รับผลกระทบจริง ---
  /** ทูล AI ตัวหนึ่ง throw exception (ไม่ใช่ ToolArgError/permission denied) */
  | "ai.tool_failed"
  /** tool-loop ทั้งก้อนพัง (provider/network/timeout) → ลูกค้าได้ข้อความขอโทษ */
  | "ai.loop_failed"
  /** วนเกิน MAX_ROUNDS → ลูกค้าได้ข้อความ "ประมวลผลนานเกินไป" */
  | "ai.loop_timeout"
  /** webhook handler พังทั้งก้อน → ลูกค้าได้ข้อความขอโทษ */
  | "channel.reply_failed"
  /** ส่งข้อความออกช่องทางไม่สำเร็จ → ลูกค้าไม่ได้รับอะไรเลย */
  | "channel.push_failed"
  /** เขียนข้อความลูกค้าลง inbox ไม่สำเร็จ → แชทหลุด ไม่มีใครเห็นว่าลูกค้าทัก */
  | "inbox.message_lost"
  // --- tier B: คุณภาพลด / เบื้องหลังพัง ---
  /** โหลด context (history/state/store profile) ไม่สำเร็จ → AI ตอบโดยข้อมูลไม่ครบ */
  | "ai.context_load_failed"
  /** บันทึก state ของบทสนทนาไม่สำเร็จ → ความจำหาย ถามซ้ำ */
  | "ai.state_persist_failed"
  /** AI Pharmacy Intake: ไม่มี credentials/เกิน quota/validation retry หมด → ส่งเคสให้เภสัชกรตรวจเอง */
  | "pharmacy_ai.unavailable"
  /** AI Pharmacy Intake: ผลลัพธ์จาก AI validate ไม่ผ่านซ้ำจนครบจำนวน retry */
  | "pharmacy_ai.validation_exhausted"
  /** AI Pharmacy Intake: บันทึกสถานะ emergency ไม่สำเร็จ แต่ยังส่งคำเตือนฉุกเฉินให้ลูกค้า */
  | "pharmacy_intake.persistence_failed";

type CatalogEntry = {
  tier: FailureTier;
  /** ข้อความสำหรับ "ร้าน" — ต้องบอกว่าต้องทำอะไรต่อ ไม่ใช่ศัพท์เทคนิค */
  shopTitle: string;
  shopMessage: string;
};

const FAILURE_CATALOG: Readonly<Record<BmsFailureCode, CatalogEntry>> = {
  "ai.tool_failed": {
    tier: "A",
    shopTitle: "⚠️ ผู้ช่วย AI ตอบลูกค้าไม่สำเร็จ",
    shopMessage:
      "ระบบดึงข้อมูลสินค้า/ออร์เดอร์ให้ลูกค้าไม่สำเร็จ ลูกค้าจึงได้รับข้อความแจ้งข้อผิดพลาด รบกวนเปิดแชทตรวจสอบและตอบลูกค้ากลับ",
  },
  "ai.loop_failed": {
    tier: "A",
    shopTitle: "⚠️ ผู้ช่วย AI ขัดข้อง ลูกค้าได้ข้อความแจ้งข้อผิดพลาด",
    shopMessage:
      "ระบบ AI ตอบลูกค้าไม่สำเร็จ ลูกค้าได้รับข้อความ “ระบบขัดข้องชั่วคราว” รบกวนเปิดแชทตอบลูกค้าด้วยตนเอง",
  },
  "ai.loop_timeout": {
    tier: "A",
    shopTitle: "⚠️ ผู้ช่วย AI ใช้เวลานานเกินกำหนด",
    shopMessage:
      "ระบบประมวลผลคำถามลูกค้านานเกินกำหนดจึงตอบไม่สำเร็จ รบกวนเปิดแชทตอบลูกค้าด้วยตนเอง",
  },
  "channel.reply_failed": {
    tier: "A",
    shopTitle: "⚠️ ตอบข้อความลูกค้าไม่สำเร็จ",
    shopMessage:
      "ระบบรับข้อความลูกค้าแล้วแต่ประมวลผลต่อไม่สำเร็จ รบกวนเปิดแชทตรวจสอบและตอบลูกค้ากลับ",
  },
  "channel.push_failed": {
    tier: "A",
    shopTitle: "⚠️ ส่งข้อความถึงลูกค้าไม่สำเร็จ",
    shopMessage:
      "ระบบส่งข้อความตอบกลับออกช่องทางไม่สำเร็จ ลูกค้าอาจไม่ได้รับคำตอบเลย รบกวนเปิดแชทตรวจสอบและส่งซ้ำ",
  },
  "inbox.message_lost": {
    tier: "A",
    shopTitle: "🚨 ข้อความลูกค้าอาจไม่ถูกบันทึกลง Inbox",
    shopMessage:
      "ระบบบันทึกข้อความลูกค้าลงกล่องข้อความไม่สำเร็จ อาจมีลูกค้าที่ทักเข้ามาแล้วไม่ปรากฏในระบบ รบกวนตรวจสอบกับช่องทางต้นทาง",
  },
  "ai.context_load_failed": {
    tier: "B",
    shopTitle: "ผู้ช่วย AI เข้าถึงข้อมูลประกอบไม่ครบ",
    shopMessage: "ระบบโหลดประวัติ/ข้อมูลร้านไม่สำเร็จ คำตอบของ AI อาจไม่ครบถ้วน",
  },
  "ai.state_persist_failed": {
    tier: "B",
    shopTitle: "ผู้ช่วย AI บันทึกความจำบทสนทนาไม่สำเร็จ",
    shopMessage: "ระบบบันทึกสถานะบทสนทนาไม่สำเร็จ AI อาจถามข้อมูลเดิมซ้ำ",
  },
  "pharmacy_ai.unavailable": {
    tier: "A",
    shopTitle: "⚠️ AI Pharmacy Intake ไม่พร้อมใช้งาน — ส่งเคสให้เภสัชกรตรวจเองแล้ว",
    shopMessage:
      "ระบบผู้ช่วยซักประวัติไม่สามารถประมวลผลอาการของลูกค้าได้ (ไม่มี credentials/เกิน quota/provider ล้ม) เคสถูกส่งให้เภสัชกรตรวจสอบข้อมูลดิบด้วยตนเองแล้ว",
  },
  "pharmacy_ai.validation_exhausted": {
    tier: "B",
    shopTitle: "AI Pharmacy Intake ตอบผิดรูปแบบซ้ำหลายครั้ง",
    shopMessage: "ผลลัพธ์จาก AI ไม่ผ่านการตรวจสอบรูปแบบข้อมูลซ้ำจนครบจำนวนที่กำหนด ระบบ fallback ไปให้เภสัชกรตรวจเอง",
  },
  "pharmacy_intake.persistence_failed": {
    tier: "A",
    shopTitle: "⚠️ บันทึกเคสฉุกเฉินของลูกค้าไม่สำเร็จ",
    shopMessage:
      "ลูกค้าได้รับคำแนะนำให้ติดต่อฉุกเฉินแล้ว แต่ระบบบันทึกสถานะเคสไม่สำเร็จ รบกวนเปิดแชทและติดตามลูกค้าทันที",
  },
};

const DEFAULT_COOLDOWN_MINUTES = 30;
const MAX_ERROR_MESSAGE_LEN = 600;
const SLACK_TIMEOUT_MS = 3_000;
/** เพดานรวมของขั้นตอนแจ้งเตือน (ดู withTimeout ด้านล่างว่าทำไมจำเป็น) */
const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * ตัวเรียก reportBmsFailure() await ผลลัพธ์ (กันการแจ้งเตือนหลุดตอน request จบ)
 * ซึ่งทำให้ทุกอย่างในนี้อยู่บน critical path ของการตอบลูกค้าไปด้วย —
 * createNotification() publish เข้า Redis pubsub ถ้า Redis ล่ม/ค้าง จะค้างยาว
 * (เจอจริงตอน verify: รันจาก host ที่ต่อ Redis ไม่ได้ → ค้างที่ createNotification
 *  จนต้อง kill ทิ้ง โดยที่แถว incident ถูกบันทึกไปแล้ว)
 * การแจ้งเตือนพลาดยอมรับได้ แต่ห้ามทำให้ลูกค้าไม่ได้รับคำตอบเลย
 */
async function withTimeout(work: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${NOTIFY_TIMEOUT_MS}ms`)),
          NOTIFY_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cooldownMinutes(): number {
  const raw = Number(process.env.BMS_FAILURE_ALERT_COOLDOWN_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_COOLDOWN_MINUTES;
  return Math.floor(raw);
}

/**
 * tier A ที่เกิดบน staff surface ไม่ใช่ผลกระทบต่อลูกค้า — แอดมินเห็น error ในหน้า
 * ผู้ช่วย AI ของตัวเองอยู่แล้ว จึงลดเป็น B (platform admin รู้ไว้พอ) กัน noise
 * เข้าร้านจากการที่แอดมินคนหนึ่งลองใช้ผู้ช่วยแล้วพัง
 */
function resolveTier(code: BmsFailureCode, surface: FailureSurface): FailureTier {
  const base = FAILURE_CATALOG[code].tier;
  if (base === "A" && surface === "staff") return "B";
  return base;
}

function errorText(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  return raw.slice(0, MAX_ERROR_MESSAGE_LEN);
}

export type ReportBmsFailureInput = {
  tenantId: string;
  code: BmsFailureCode;
  error: unknown;
  surface?: FailureSurface;
  channel?: string | null;
  conversationId?: string | null;
  customerRef?: string | null;
  /** ห้ามใส่ raw tool args/PII — เก็บเฉพาะตัวระบุที่จำเป็นต่อการไล่ปัญหา */
  meta?: Record<string, unknown>;
};

/**
 * บันทึก incident + แจ้งเตือนตาม tier. ไม่ throw ทุกกรณี (คืน void)
 * เรียกแบบ fire-and-forget ได้: void reportBmsFailure({...})
 */
export async function reportBmsFailure(input: ReportBmsFailureInput): Promise<void> {
  try {
    const entry = FAILURE_CATALOG[input.code];
    if (!entry) return;
    const surface: FailureSurface = input.surface ?? "system";
    const tier = resolveTier(input.code, surface);
    const message = errorText(input.error);

    const inserted = await query<{ id: string }>(
      `INSERT INTO bms_failure_incidents
         (tenant_id, code, tier, surface, channel, conversation_id, customer_ref, error_message, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        input.tenantId,
        input.code,
        tier,
        surface,
        input.channel ?? null,
        input.conversationId ?? null,
        input.customerRef ?? null,
        message,
        JSON.stringify(input.meta ?? {}),
      ]
    );
    const incidentId = inserted.rows[0]?.id ?? null;

    // console.error ยังอยู่ที่ call site เดิม — บรรทัดนี้ผูก log กับ incident id
    console.error(
      `[BMS] failure incident #${incidentId ?? "?"} ${input.code} (tier ${tier}) tenant=${input.tenantId}`
    );

    const mins = cooldownMinutes();
    // แถวที่เพิ่ง insert มี notified_* = NULL จึงไม่ match ตัวเอง
    // bound created_at (มี index) ได้เพราะการแจ้งเกิดพร้อมการสร้างแถวเสมอ
    const recent = await query<{ shop_at: string | null; platform_at: string | null }>(
      `SELECT MAX(notified_shop_at) AS shop_at, MAX(notified_platform_at) AS platform_at
         FROM bms_failure_incidents
        WHERE tenant_id = $1 AND code = $2
          AND created_at > now() - make_interval(mins => $3)`,
      [input.tenantId, input.code, mins]
    );
    const shopOnCooldown = Boolean(recent.rows[0]?.shop_at);
    const platformOnCooldown = Boolean(recent.rows[0]?.platform_at);

    const tenantName = (await getTenantName(input.tenantId)) ?? input.tenantId;

    // แยก try ต่อผู้รับ: ฝั่งหนึ่ง timeout/พัง ต้องไม่ทำให้อีกฝั่งไม่ได้รับแจ้ง
    if (tier === "A" && !shopOnCooldown) {
      try {
        let notified = false;
        await withTimeout(
          notifyShop(input, entry, incidentId).then((ok) => {
            notified = ok;
          }),
          "shop notification"
        );
        if (notified && incidentId) {
          await query(`UPDATE bms_failure_incidents SET notified_shop_at = now() WHERE id = $1`, [
            incidentId,
          ]);
        }
      } catch (err) {
        console.error("[BMS] failure alert: shop notify phase failed:", err);
      }
    }

    if (!platformOnCooldown) {
      try {
        await withTimeout(
          notifyPlatform(input, { tier, message, tenantName, incidentId }),
          "platform notification"
        );
        if (incidentId) {
          await query(
            `UPDATE bms_failure_incidents SET notified_platform_at = now() WHERE id = $1`,
            [incidentId]
          );
        }
      } catch (err) {
        console.error("[BMS] failure alert: platform notify phase failed:", err);
      }
    }
  } catch (err) {
    // ห้ามให้การแจ้งเตือนล้มเหลวไปทำให้ path ที่กำลังตอบลูกค้าพังเพิ่ม
    console.error("[BMS] reportBmsFailure failed:", err);
  }
}

/**
 * ผู้รับฝั่งร้าน: Administrator/Manager (ระดับเจ้าของร้าน แก้/ตัดสินใจได้) +
 * staff หลักของแชทนั้นถ้ามี (คนที่ต้องตามลูกค้ากลับจริง ๆ)
 * ไม่แจ้ง Sales/Warehouse ทั้งร้าน เพราะจะกลายเป็น noise
 */
async function notifyShop(
  input: ReportBmsFailureInput,
  entry: CatalogEntry,
  incidentId: string | null
): Promise<boolean> {
  const owners = await query<{ id: string }>(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name IN ('Administrator','Manager')`,
    [input.tenantId]
  );
  const ids = new Set<string>(owners.rows.map((r) => r.id));

  if (input.conversationId) {
    const assigned = await query<{ assigned_to_user_id: string | null }>(
      `SELECT assigned_to_user_id FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.conversationId]
    );
    const staffId = assigned.rows[0]?.assigned_to_user_id;
    if (staffId) ids.add(staffId);
  }
  if (!ids.size) return false;

  // entity_id ต้องเป็น UUID — ใช้ conversation_id ถ้ามี ไม่มีก็ tenant_id
  // (incident id เป็น bigint ใส่ตรงไม่ได้ เก็บใน data แทน — เหมือนเคส note mention)
  const entityId = input.conversationId ?? input.tenantId;

  let sent = false;
  for (const userId of ids) {
    try {
      await createNotification({
        user_id: userId,
        type: "bms_failure",
        title: entry.shopTitle,
        message: entry.shopMessage,
        entity_type: "bms_failure_incident",
        entity_id: entityId,
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId ?? null,
          code: input.code,
          incidentId,
        },
      });
      sent = true;
    } catch (err) {
      console.error("[BMS] failure notification (shop) failed:", err);
    }
  }
  return sent;
}

/**
 * platform admin ได้รายละเอียดทางเทคนิค (ข้อความ error จริง) ทั้ง tier A และ B
 * ในแอปเสมอ + Slack ถ้าตั้ง SLACK_WEBHOOK_URL (ใช้ env เดิมของ maybeAlertSlackForLog)
 */
async function notifyPlatform(
  input: ReportBmsFailureInput,
  ctx: { tier: FailureTier; message: string; tenantName: string; incidentId: string | null }
): Promise<void> {
  const title = `[BMS ${ctx.tier}] ${input.code} — ${ctx.tenantName}`;

  const admins = await query<{ id: string }>(
    `SELECT id FROM users WHERE is_platform_admin = TRUE`
  );
  for (const row of admins.rows) {
    try {
      await createNotification({
        user_id: row.id,
        type: "bms_failure_platform",
        title,
        message: ctx.message,
        entity_type: "bms_failure_incident",
        entity_id: input.conversationId ?? input.tenantId,
        data: {
          tenantId: input.tenantId,
          tenantName: ctx.tenantName,
          conversationId: input.conversationId ?? null,
          code: input.code,
          tier: ctx.tier,
          incidentId: ctx.incidentId,
          platform: true,
        },
      });
    } catch (err) {
      console.error("[BMS] failure notification (platform) failed:", err);
    }
  }

  await postSlack(input, ctx, title);
}

async function postSlack(
  input: ReportBmsFailureInput,
  ctx: { tier: FailureTier; message: string; tenantName: string; incidentId: string | null },
  title: string
): Promise<void> {
  const webhook = (process.env.SLACK_WEBHOOK_URL || "").trim();
  if (!webhook) return;
  try {
    const lines = [
      `*Env:* ${process.env.NODE_ENV || "unknown"}`,
      `*Tenant:* ${ctx.tenantName} (${input.tenantId})`,
      `*Code:* ${input.code}  *Tier:* ${ctx.tier}`,
      `*Surface:* ${input.surface ?? "system"}  *Channel:* ${input.channel ?? "-"}`,
      `*Conversation:* ${input.conversationId ?? "-"}`,
      `*Error:* ${ctx.message}`,
      `*Incident:* #${ctx.incidentId ?? "?"}`,
    ];
    // bound ไว้เสมอ — path ที่เรียกมากำลังค้างลูกค้าอยู่ ห้ามให้ Slack ที่ช้า/ค้าง
    // ถ่วงการตอบกลับต่อ (ตัวเรียกใช้ await เพื่อกันการแจ้งเตือนหลุดตอน request จบ)
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: title,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${lines.join("\n")}` } },
        ],
      }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[BMS] failure Slack alert failed:", err);
  }
}
