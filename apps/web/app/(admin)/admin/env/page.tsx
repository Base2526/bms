// app/admin/env/page.tsx
import "server-only";
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

function pickEnv(obj: NodeJS.ProcessEnv): EnvRow[] {
  // ปรับ prefix ที่อยากแสดงได้ตามโปรเจค
  const allowPrefixes = [
    "NODE_",
    "NEXT_",
    "DATABASE_",
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

  const out: EnvRow[] = [];
  for (const [k, raw] of Object.entries(obj)) {
    if (!allowPrefixes.some((p) => k.startsWith(p))) continue;

    const value = String(raw ?? "");
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

function buildActiveProviderSummary(): ActiveProviderSummary[] {
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
        ? "ยังไม่มี shared chat provider ที่พร้อมใช้งาน"
        : effectiveChat.provider === configuredChat
          ? "customer sales และ text/tool-calling ทั่วไปจะใช้ provider นี้เป็นหลัก"
          : "provider หลักไม่มี key พร้อมใช้ จึง fallback ไป provider สำรอง",
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
        ? "ยังไม่มี shared sensitive provider ที่พร้อมใช้งาน"
        : effectiveSensitive.provider === configuredSensitive
          ? "staff request ที่ตรวจพบเจตนา sensitive จะใช้ provider นี้เป็น baseline"
          : "sensitive provider ที่ตั้งไว้ไม่มี key พร้อมใช้ จึง fallback ไป provider สำรอง",
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
        ? "ยังไม่มี shared OCR provider ที่พร้อมใช้งาน"
        : effectiveOcr.provider === configuredOcr
          ? "verify slip จะใช้ provider นี้ตามค่าปัจจุบัน"
          : "OCR fallback ไปยัง provider ที่มี key พร้อมใช้",
    },
  ];
}

function buildConfigDiagnostics(): ConfigDiagnostic[] {
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
      title: "BMS_AI_PROVIDER ไม่ถูกต้อง",
      detail: `runtime ได้ค่า "${rawChat}" — รองรับเฉพาะ anthropic หรือ deepseek`,
    });
  }
  if (!hasChatKey(chat)) {
    diagnostics.push({
      level: "error",
      code: "chat_key_missing",
      title: `ไม่มี key สำหรับ chat provider หลัก (${chat})`,
      detail: "ระบบจะ fallback ไป provider อื่นถ้ามี key; ถ้าไม่มีจะใช้ deterministic template",
    });
  }
  if (rawSensitive && !normalizeAiProvider(rawSensitive)) {
    diagnostics.push({
      level: "error",
      code: "invalid_sensitive_provider",
      title: "BMS_AI_SENSITIVE_PROVIDER ไม่ถูกต้อง",
      detail: `runtime ได้ค่า "${rawSensitive}" — รองรับเฉพาะ anthropic หรือ deepseek`,
    });
  }
  if (!hasChatKey(sensitive)) {
    diagnostics.push({
      level: "warning",
      code: "sensitive_key_missing",
      title: `ไม่มี key สำหรับ sensitive baseline (${sensitive})`,
      detail: "งาน sensitive จะ fallback ไป chat provider ที่มี key โดย safety/RBAC/propose-only ยังทำงานเหมือนเดิม",
    });
  }
  if (rawOcr && !normalizeOcrProvider(rawOcr)) {
    diagnostics.push({
      level: "error",
      code: "invalid_ocr_provider",
      title: "BMS_SLIP_READER_PROVIDER ไม่ถูกต้อง",
      detail: `runtime ได้ค่า "${rawOcr}" — รองรับเฉพาะ qwen หรือ anthropic`,
    });
  }
  if (!hasOcrKey(ocr)) {
    diagnostics.push({
      level: hasOcrKey(ocrFallback) ? "warning" : "error",
      code: "ocr_key_missing",
      title: `ไม่มี key สำหรับ Slip OCR หลัก (${ocr})`,
      detail: hasOcrKey(ocrFallback)
        ? `ระบบจะใช้ ${ocrFallback} fallback ก่อนส่งให้คนตรวจ`
        : "ไม่มี OCR provider พร้อมใช้ ระบบจะส่งให้คนตรวจด้วยตนเอง",
    });
  }
  if (ocr === ocrFallback) {
    diagnostics.push({
      level: "warning",
      code: "ocr_fallback_duplicate",
      title: "Slip OCR primary และ fallback เป็น provider เดียวกัน",
      detail: "หาก provider ล้มเหลวจะไม่มี provider สำรองให้ลองต่อ",
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
      title: "QWEN endpoint ไม่ใช่ US แต่ยังใช้อัตราต้นทุน default",
      detail:
        "ตั้ง QWEN_OCR_INPUT_USD_PER_MILLION และ QWEN_OCR_OUTPUT_USD_PER_MILLION ให้ตรง region",
    });
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      level: "ok",
      code: "runtime_config_ok",
      title: "Runtime configuration พร้อมใช้งาน",
      detail: "provider หลัก, sensitive baseline และ OCR fallback มี key ครบใน process ปัจจุบัน",
    });
  }
  return diagnostics;
}

export default async function EnvPage() {
  const env = pickEnv(process.env);
  const activeProviders = buildActiveProviderSummary();
  const recentUsage = await listRecentAiUsageEventsGlobal(10);
  const providerHealth = await listAiProviderHealth();
  const configDiagnostics = buildConfigDiagnostics();

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
