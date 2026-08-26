// app/admin/env/page.tsx
import "server-only";
import { cookies } from "next/headers";
import { getMessage, type Lang } from "@/i18n";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_SENSITIVE_AI_PROVIDER,
  normalizeAiProvider,
  resolveSharedAiProvider,
} from "@/lib/bms/aiProvider";
import { listRecentAiUsageEventsGlobal } from "@/lib/bms/aiUsage";
import { listAiProviderHealth } from "@/lib/bms/aiProviderHealth";
import {
  DEFAULT_SLIP_READER_FALLBACK_PROVIDER,
  DEFAULT_SLIP_READER_PROVIDER,
} from "@/lib/bms/slipReaders";
import {
  DEFAULT_QWEN_BASE_URL,
  DEFAULT_QWEN_SLIP_MODEL,
} from "@/lib/bms/slipReaders/qwen";
import EnvTableClient from "./EnvTableClient";

export type EnvRow = { key: string; value: string; masked: boolean };
export type ActiveProviderSummary = {
  scope: "chat" | "sensitive" | "ocr";
  label: string;
  configuredProvider: string;
  effectiveProvider: string | null;
  model: string | null;
  status: "active" | "fallback" | "missing";
  note: string;
};

export type ConfigDiagnostic = {
  level: "ok" | "warning" | "error";
  code: string;
  title: string;
  detail: string;
};
// gate: อยู่ใน env/layout.tsx (requirePlatformAdminPage)

function maskValue(v: string) {
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 3)}***${v.slice(-3)}`;
}

function isSensitiveKey(key: string) {
  return /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|COOKIE|SESSION|AUTH|JWT)/i.test(key);
}

/**
 * ตัวที่ต้องรายงาน **แค่ว่าตั้งไว้หรือไม่และรูปแบบถูกไหม** ไม่แสดงเสี้ยวไหนของค่าเลย
 *
 * maskValue() โชว์ 3 ตัวแรก + 3 ตัวท้าย ซึ่งพอรับได้กับ API key ทั่วไป แต่กับคีย์ที่
 * ใช้เซ็น session หรือเข้ารหัสความลับของทุกร้าน การรั่วแม้เสี้ยวเดียวไม่มีเหตุผลให้ทำ
 * — คำถามที่คนเปิดหน้านี้อยากรู้คือ "ตั้งแล้วยัง" ไม่ใช่ "ค่าคืออะไร"
 */
const PRESENCE_ONLY = new Set([
  "JWT_SECRET",
  "BMS_SECRET_KEY",
  "BMS_CHECKOUT_SECRET",
  "BMS_CRON_SECRET",
  "BMS_JOB_TOKEN",
  "ADMIN_TOKEN",
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
]);

/** คีย์ที่ต้องเป็น hex 64 ตัว — ตั้งผิดรูปอันตรายกว่าไม่ตั้ง เพราะดูเหมือนตั้งแล้ว */
const HEX64_KEYS = new Set(["BMS_SECRET_KEY"]);

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function describePresence(t: Translate, key: string, value: string): string {
  if (!value) return t("admin_env.env_not_set");
  if (HEX64_KEYS.has(key)) {
    return /^[0-9a-fA-F]{64}$/.test(value)
      ? t("admin_env.env_set_hex64_ok")
      : t("admin_env.env_set_hex64_bad", { n: value.length });
  }
  return t("admin_env.env_set_len", { n: value.length });
}

function pickEnv(t: Translate, obj: NodeJS.ProcessEnv): EnvRow[] {
  // ปรับ prefix ที่อยากแสดงได้ตามโปรเจค
  const allowPrefixes = [
    "NODE_",
    "NEXT_",
    "DATABASE_",
    "POSTGRES_",
    "REDIS_",
    "S3_",
    "AWS_",
    "SMTP_",
    "MAIL_",
    "X_",
    "GOOGLE_",
    "LINE_",
    "ANTHROPIC_",
    "DEEPSEEK_",
    "QWEN_OCR_",
    "BMS_AI_",
    "BMS_SLIP_",
    "BMS_AI_MODEL",
  ];

  // เดิมหน้านี้กรองด้วย prefix เท่านั้น ผลคือ env ที่สำคัญที่สุดต่อการตรวจสอบ
  // (JWT_SECRET, BMS_SECRET_KEY, BMS_CRON_SECRET, BMS_JOB_TOKEN, ADMIN_TOKEN,
  // POSTGRES_*, ธงเปิด/ปิดฟีเจอร์) ไม่โผล่เลยแม้แต่ตัวเดียว — คนเปิดหน้านี้เพื่อ
  // เช็คว่า "ตั้ง BMS_SECRET_KEY แล้วยัง" จึงได้คำตอบว่า "ไม่มี" ทั้งที่ตั้งแล้ว
  // (เจอจริง 2026-08-27) · หน้าที่บอกไม่ครบแต่ดูเหมือนครบ แย่กว่าไม่มีหน้านี้
  const allowExact = [
    "JWT_SECRET",
    "BMS_SECRET_KEY",
    "BMS_CHECKOUT_SECRET",
    "BMS_CRON_SECRET",
    "BMS_JOB_TOKEN",
    "ADMIN_TOKEN",
    "BMS_ALLOW_FAKE_SEED",
    "BMS_APP_BASE_URL",
    "ETAX_ENABLED",
    "PHARMACY_INTAKE_ENABLED",
    "PHARMACY_AI_ENABLED",
    "PHARMACY_PROTOCOLS_ENABLED",
    "COOKIE_SECURE",
    "STORAGE_DRIVER",
    "META_GRAPH_VERSION",
  ];

  const out: EnvRow[] = [];
  const seen = new Set<string>();

  // ตัวที่ประกาศชื่อไว้ตรง ๆ ต้องขึ้นแม้ค่าจะว่าง — "ไม่ได้ตั้ง" คือคำตอบที่คนมาหา
  for (const key of allowExact) {
    seen.add(key);
    const value = String(obj[key] ?? "");
    out.push({
      key,
      value: PRESENCE_ONLY.has(key)
        ? describePresence(t, key, value)
        : value || t("admin_env.env_not_set"),
      masked: PRESENCE_ONLY.has(key),
    });
  }

  for (const [k, raw] of Object.entries(obj)) {
    if (seen.has(k)) continue;
    if (!allowPrefixes.some((p) => k.startsWith(p))) continue;

    const value = String(raw ?? "");
    if (PRESENCE_ONLY.has(k)) {
      out.push({ key: k, value: describePresence(t, k, value), masked: true });
      continue;
    }
    const sensitive = isSensitiveKey(k);

    out.push({
      key: k,
      value: sensitive ? maskValue(value) : value,
      masked: sensitive,
    });
  }

  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function normalizeOcrProvider(value: unknown): "anthropic" | "qwen" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "qwen") return normalized;
  return null;
}

function resolveSharedOcrProvider(): { provider: "anthropic" | "qwen"; model: string } | null {
  const preferred =
    normalizeOcrProvider(process.env.BMS_SLIP_READER_PROVIDER) ?? DEFAULT_SLIP_READER_PROVIDER;
  const fallback =
    normalizeOcrProvider(process.env.BMS_SLIP_READER_FALLBACK_PROVIDER) ??
    DEFAULT_SLIP_READER_FALLBACK_PROVIDER;
  const order = Array.from(new Set([preferred, fallback]));
  for (const provider of order) {
    if (provider === "qwen" && process.env.QWEN_OCR_API_KEY) {
      return {
        provider: "qwen",
        model: process.env.QWEN_OCR_MODEL || DEFAULT_QWEN_SLIP_MODEL,
      };
    }
    if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      const shared = resolveSharedAiProvider("anthropic", false);
      if (shared) return { provider: "anthropic", model: shared.model };
    }
  }
  return null;
}

function buildActiveProviderSummary(t: (key: string, vars?: Record<string, string | number>) => string): ActiveProviderSummary[] {
  const configuredChat = normalizeAiProvider(process.env.BMS_AI_PROVIDER) ?? DEFAULT_AI_PROVIDER;
  const effectiveChat = resolveSharedAiProvider();
  const configuredSensitive =
    normalizeAiProvider(process.env.BMS_AI_SENSITIVE_PROVIDER) ?? DEFAULT_SENSITIVE_AI_PROVIDER;
  const effectiveSensitive = resolveSharedAiProvider(configuredSensitive);
  const configuredOcr =
    normalizeOcrProvider(process.env.BMS_SLIP_READER_PROVIDER) ?? DEFAULT_SLIP_READER_PROVIDER;
  const effectiveOcr = resolveSharedOcrProvider();

  return [
    {
      scope: "chat",
      label: "Chat / Tool Calling",
      configuredProvider: configuredChat,
      effectiveProvider: effectiveChat?.provider ?? null,
      model: effectiveChat?.model ?? null,
      status: !effectiveChat
        ? "missing"
        : effectiveChat.provider === configuredChat
          ? "active"
          : "fallback",
      note: !effectiveChat
        ? t("admin_env.note_chat_missing")
        : effectiveChat.provider === configuredChat
          ? t("admin_env.note_chat_active")
          : t("admin_env.note_chat_fallback"),
    },
    {
      scope: "sensitive",
      label: "Sensitive / Baseline",
      configuredProvider: configuredSensitive,
      effectiveProvider: effectiveSensitive?.provider ?? null,
      model: effectiveSensitive?.model ?? null,
      status: !effectiveSensitive
        ? "missing"
        : effectiveSensitive.provider === configuredSensitive
          ? "active"
          : "fallback",
      note: !effectiveSensitive
        ? t("admin_env.note_sensitive_missing")
        : effectiveSensitive.provider === configuredSensitive
          ? t("admin_env.note_sensitive_active")
          : t("admin_env.note_sensitive_fallback"),
    },
    {
      scope: "ocr",
      label: "Slip OCR",
      configuredProvider: configuredOcr,
      effectiveProvider: effectiveOcr?.provider ?? null,
      model: effectiveOcr?.model ?? null,
      status: !effectiveOcr
        ? "missing"
        : effectiveOcr.provider === configuredOcr
          ? "active"
          : "fallback",
      note: !effectiveOcr
        ? t("admin_env.note_ocr_missing")
        : effectiveOcr.provider === configuredOcr
          ? t("admin_env.note_ocr_active")
          : t("admin_env.note_ocr_fallback"),
    },
  ];
}

function buildConfigDiagnostics(t: (key: string, vars?: Record<string, string | number>) => string): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const rawChat = process.env.BMS_AI_PROVIDER;
  const rawSensitive = process.env.BMS_AI_SENSITIVE_PROVIDER;
  const rawOcr = process.env.BMS_SLIP_READER_PROVIDER;
  const rawOcrFallback = process.env.BMS_SLIP_READER_FALLBACK_PROVIDER;
  const chat = normalizeAiProvider(rawChat) ?? DEFAULT_AI_PROVIDER;
  const sensitive =
    normalizeAiProvider(rawSensitive) ?? DEFAULT_SENSITIVE_AI_PROVIDER;
  const ocr = normalizeOcrProvider(rawOcr) ?? DEFAULT_SLIP_READER_PROVIDER;
  const ocrFallback =
    normalizeOcrProvider(rawOcrFallback) ?? DEFAULT_SLIP_READER_FALLBACK_PROVIDER;
  const hasChatKey = (provider: "anthropic" | "deepseek") =>
    provider === "anthropic"
      ? Boolean(process.env.ANTHROPIC_API_KEY)
      : Boolean(process.env.DEEPSEEK_API_KEY);
  const hasOcrKey = (provider: "anthropic" | "qwen") =>
    provider === "anthropic"
      ? Boolean(process.env.ANTHROPIC_API_KEY)
      : Boolean(process.env.QWEN_OCR_API_KEY);

  if (rawChat && !normalizeAiProvider(rawChat)) {
    diagnostics.push({
      level: "error",
      code: "invalid_chat_provider",
      title: t("admin_env.diag_invalid_chat_provider_title"),
      detail: t("admin_env.diag_invalid_provider_detail", { value: rawChat }),
    });
  }
  if (!hasChatKey(chat)) {
    diagnostics.push({
      level: "error",
      code: "chat_key_missing",
      title: t("admin_env.diag_chat_key_missing_title", { provider: chat }),
      detail: t("admin_env.diag_chat_key_missing_detail"),
    });
  }
  if (rawSensitive && !normalizeAiProvider(rawSensitive)) {
    diagnostics.push({
      level: "error",
      code: "invalid_sensitive_provider",
      title: t("admin_env.diag_invalid_sensitive_provider_title"),
      detail: t("admin_env.diag_invalid_provider_detail", { value: rawSensitive }),
    });
  }
  if (!hasChatKey(sensitive)) {
    diagnostics.push({
      level: "warning",
      code: "sensitive_key_missing",
      title: t("admin_env.diag_sensitive_key_missing_title", { provider: sensitive }),
      detail: t("admin_env.diag_sensitive_key_missing_detail"),
    });
  }
  if (rawOcr && !normalizeOcrProvider(rawOcr)) {
    diagnostics.push({
      level: "error",
      code: "invalid_ocr_provider",
      title: t("admin_env.diag_invalid_ocr_provider_title"),
      detail: t("admin_env.diag_invalid_ocr_provider_detail", { value: rawOcr }),
    });
  }
  if (!hasOcrKey(ocr)) {
    diagnostics.push({
      level: hasOcrKey(ocrFallback) ? "warning" : "error",
      code: "ocr_key_missing",
      title: t("admin_env.diag_ocr_key_missing_title", { provider: ocr }),
      detail: hasOcrKey(ocrFallback)
        ? t("admin_env.diag_ocr_key_missing_detail_fallback", { fallback: ocrFallback })
        : t("admin_env.diag_ocr_key_missing_detail_none"),
    });
  }
  if (ocr === ocrFallback) {
    diagnostics.push({
      level: "warning",
      code: "ocr_fallback_duplicate",
      title: t("admin_env.diag_ocr_fallback_duplicate_title"),
      detail: t("admin_env.diag_ocr_fallback_duplicate_detail"),
    });
  }
  const qwenBaseUrl = process.env.QWEN_OCR_BASE_URL ?? DEFAULT_QWEN_BASE_URL;
  const customQwenRate =
    process.env.QWEN_OCR_INPUT_USD_PER_MILLION ||
    process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION;
  if (
    process.env.QWEN_OCR_API_KEY &&
    !/dashscope-us|us-|virginia/i.test(qwenBaseUrl) &&
    !customQwenRate
  ) {
    diagnostics.push({
      level: "warning",
      code: "qwen_region_rate",
      title: t("admin_env.diag_qwen_region_rate_title"),
      detail: t("admin_env.diag_qwen_region_rate_detail"),
    });
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      level: "ok",
      code: "runtime_config_ok",
      title: t("admin_env.diag_ok_title"),
      detail: t("admin_env.diag_ok_detail"),
    });
  }
  return diagnostics;
}

export default async function EnvPage() {
  const lang = (cookies().get("lang")?.value === "en" ? "en" : "th") as Lang;
  const t = (key: string, vars?: Record<string, string | number>) => getMessage(lang, key, vars);

  const env = pickEnv(t, process.env);
  const activeProviders = buildActiveProviderSummary(t);
  const recentUsage = await listRecentAiUsageEventsGlobal(10);
  const providerHealth = await listAiProviderHealth();
  const configDiagnostics = buildConfigDiagnostics(t);

  const meta = {
    nodeEnv: process.env.NODE_ENV ?? "-",
    runtime: process.env.NEXT_RUNTIME ?? "-",
    hostname: process.env.HOSTNAME ?? "-",
    pid: String(process.pid),
    uptimeSec: String(Math.floor(process.uptime())),
    now: new Date().toISOString(),
  };

  return (
    <EnvTableClient
      env={env}
      meta={meta}
      activeProviders={activeProviders}
      recentUsage={recentUsage}
      providerHealth={providerHealth}
      configDiagnostics={configDiagnostics}
    />
  );
}
