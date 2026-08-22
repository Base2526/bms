import { DEFAULT_AI_MODEL, getTenantAiConfig } from "../aiConfig";
import { recordAiFallback, recordAiProviderAttempt, recordByokAiUsage, recordSharedAiRetryUsage, tryConsumeAiQuota, type AiUsageContext } from "../aiUsage";
import { resolveSharedAiProvider, resolveTenantByokProvider } from "../aiProvider";
import type {
  SlipReadRequest,
  SlipReadResult,
  SlipReader,
  SlipReaderCredentials,
} from "../slipReader";
import { anthropicSlipReader } from "./anthropic";
import { qwenSlipReader } from "./qwen";

export const DEFAULT_SLIP_READER_PROVIDER = "qwen";
export const DEFAULT_SLIP_READER_FALLBACK_PROVIDER = "anthropic";
const DEFAULT_QWEN_SLIP_MODEL = "qwen-vl-ocr";
const DEFAULT_QWEN_SLIP_BASE_URL = "https://dashscope-us.aliyuncs.com/compatible-mode/v1";

const readers: Readonly<Record<string, SlipReader>> = {
  anthropic: anthropicSlipReader,
  qwen: qwenSlipReader,
};

export type ResolvedSlipReader = {
  reader: SlipReader;
  credentials: SlipReaderCredentials;
  provider: string;
  source: "byok" | "shared";
  usageEventId?: string;
};

export type ResolveSlipReaderOptions = {
  excludeProviders?: ReadonlyArray<"anthropic" | "qwen">;
  fallbackFrom?: "anthropic" | "qwen" | null;
  chargeSharedCredit?: boolean;
};

export type SlipReaderAttemptOutcome =
  | {
      ok: true;
      session: ResolvedSlipReader;
      result: SlipReadResult;
      attemptedProviders: string[];
    }
  | {
      ok: false;
      reason: "no_session" | "image_unavailable" | "providers_failed";
      attemptedProviders: string[];
      errorMessage: string | null;
    };

function normalizeSlipReaderProvider(value: unknown): "anthropic" | "qwen" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "qwen") return normalized;
  return null;
}

function slipReaderProviderOrder(): Array<"anthropic" | "qwen"> {
  const preferred =
    normalizeSlipReaderProvider(process.env.BMS_SLIP_READER_PROVIDER) ??
    DEFAULT_SLIP_READER_PROVIDER;
  const fallback =
    normalizeSlipReaderProvider(process.env.BMS_SLIP_READER_FALLBACK_PROVIDER) ??
    DEFAULT_SLIP_READER_FALLBACK_PROVIDER;
  return Array.from(new Set([preferred, fallback]));
}

function qwenSharedCredentials(): SlipReaderCredentials | null {
  if (!process.env.QWEN_OCR_API_KEY) return null;
  return {
    apiKey: process.env.QWEN_OCR_API_KEY,
    model: process.env.QWEN_OCR_MODEL || DEFAULT_QWEN_SLIP_MODEL,
    baseUrl: process.env.QWEN_OCR_BASE_URL || DEFAULT_QWEN_SLIP_BASE_URL,
  };
}

/**
 * Provider selection lives here so payment business logic depends only on SlipReader.
 * Add an internal OCR adapter to this registry before making it selectable by configuration.
 */
export function getSlipReader(
  provider: string = DEFAULT_SLIP_READER_PROVIDER
): SlipReader {
  const reader = readers[provider];
  if (!reader) {
    throw new Error(`Unsupported slip reader provider: ${provider}`);
  }
  return reader;
}

export async function resolveSlipReader(
  tenantId: string,
  usageCtx?: AiUsageContext,
  options: ResolveSlipReaderOptions = {}
): Promise<ResolvedSlipReader | null> {
  const providerOrder = slipReaderProviderOrder();
  const own = await getTenantAiConfig(tenantId);
  const excluded = new Set(options.excludeProviders ?? []);
  const configuredProvider = providerOrder[0];

  for (const provider of providerOrder) {
    if (excluded.has(provider)) continue;
    const routingReason = options.fallbackFrom
      ? "ocr_runtime_fallback"
      : provider === configuredProvider
        ? "ocr_primary"
        : "ocr_fallback_unconfigured";
    const routingMeta = {
      ...(usageCtx?.meta ?? {}),
      routing_reason: routingReason,
      configured_provider: configuredProvider,
      effective_provider: provider,
      fallback_from:
        options.fallbackFrom ?? (provider === configuredProvider ? null : configuredProvider),
    };

    if (provider === "anthropic") {
      if (own?.apiKey && own.provider === "anthropic") {
        const byok = resolveTenantByokProvider(
          own.apiKey,
          own.model || DEFAULT_AI_MODEL,
          "anthropic"
        );
        const usageEventId = await recordByokAiUsage(tenantId, {
          ...usageCtx,
          provider: "anthropic",
          model: byok.model,
          meta: {
            ...routingMeta,
            routing_reason: options.fallbackFrom
              ? "ocr_runtime_fallback_byok"
              : "byok",
          },
        });
        return {
          reader: anthropicSlipReader,
          credentials: {
            apiKey: byok.apiKey,
            model: byok.model,
            baseUrl: byok.baseUrl,
          },
          provider: "anthropic",
          source: "byok",
          usageEventId,
        };
      }

      const shared = resolveSharedAiProvider("anthropic", false);
      if (shared) {
        const quota = options.chargeSharedCredit === false
          ? { ok: true, eventId: await recordSharedAiRetryUsage(tenantId, {
              ...usageCtx,
              provider: "anthropic",
              model: shared.model,
              meta: routingMeta,
            }) }
          : await tryConsumeAiQuota(tenantId, {
          ...usageCtx,
          provider: "anthropic",
          model: shared.model,
          meta: routingMeta,
        });
        if (!quota.ok) return null;
        return {
          reader: anthropicSlipReader,
          credentials: {
            apiKey: shared.apiKey,
            model: shared.model,
            baseUrl: shared.baseUrl,
          },
          provider: "anthropic",
          source: "shared",
          usageEventId: quota.eventId,
        };
      }
      continue;
    }

    const qwen = qwenSharedCredentials();
    if (!qwen) continue;
    const quota = options.chargeSharedCredit === false
      ? { ok: true, eventId: await recordSharedAiRetryUsage(tenantId, {
          ...usageCtx,
          provider: "qwen",
          model: qwen.model,
          meta: routingMeta,
        }) }
      : await tryConsumeAiQuota(tenantId, {
      ...usageCtx,
      provider: "qwen",
      model: qwen.model,
      meta: routingMeta,
    });
    if (!quota.ok) return null;
    return {
      reader: qwenSlipReader,
      credentials: qwen,
      provider: "qwen",
      source: "shared",
      usageEventId: quota.eventId,
    };
  }

  await recordAiFallback(tenantId, "no_credentials", usageCtx);
  return null;
}

/**
 * Execute at most two read-only OCR attempts. Credential resolution stays lazy and a shared fallback
 * reuses the logical request's reservation instead of consuming a second credit.
 */
export async function runSlipReaderFallback(input: {
  resolveNext: (
    excluded: ReadonlyArray<"anthropic" | "qwen">,
    fallbackFrom: "anthropic" | "qwen" | null,
    chargeSharedCredit: boolean
  ) => Promise<ResolvedSlipReader | null>;
  loadImage: (
    reader: SlipReader
  ) => Promise<{ base64: string; mediaType: string } | null>;
  finalize: (
    eventId: string,
    result: {
      status: "completed" | "failed" | "fallback";
      inputTokens?: number | null;
      outputTokens?: number | null;
      providerCalls?: number;
      errorMessage?: string | null;
    }
  ) => Promise<void>;
  recordProviderAttempt?: typeof recordAiProviderAttempt;
}): Promise<SlipReaderAttemptOutcome> {
  const attemptedProviders: Array<"anthropic" | "qwen"> = [];
  let fallbackFrom: "anthropic" | "qwen" | null = null;
  let lastError: string | null = null;
  let sharedCreditReserved = false;

  while (attemptedProviders.length < 2) {
    const session = await input.resolveNext(
      attemptedProviders,
      fallbackFrom,
      !sharedCreditReserved
    );
    if (!session) {
      return {
        ok: false,
        reason: attemptedProviders.length > 0 ? "providers_failed" : "no_session",
        attemptedProviders,
        errorMessage: lastError,
      };
    }
    const provider = session.provider as "anthropic" | "qwen";
    if (session.source === "shared") sharedCreditReserved = true;
    attemptedProviders.push(provider);
    const image = await input.loadImage(session.reader);
    if (!image) {
      if (session.usageEventId) {
        await input.finalize(session.usageEventId, {
          status: "fallback",
          providerCalls: 0,
          errorMessage: "slip image unavailable",
        });
      }
      return {
        ok: false,
        reason: "image_unavailable",
        attemptedProviders,
        errorMessage: "slip image unavailable",
      };
    }
    try {
      if (session.usageEventId) {
        await (input.recordProviderAttempt ?? recordAiProviderAttempt)(session.usageEventId);
      }
      const result = await session.reader.read({
        ...image,
        credentials: session.credentials,
      });
      if (session.usageEventId) {
        await input.finalize(session.usageEventId, {
          status: "completed",
          providerCalls: 1,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
      }
      return { ok: true, session, result, attemptedProviders };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "slip ocr failed";
      if (session.usageEventId) {
        await input.finalize(session.usageEventId, {
          status: "failed",
          providerCalls: 1,
          errorMessage: lastError,
        });
      }
      fallbackFrom = provider;
    }
  }

  return {
    ok: false,
    reason: "providers_failed",
    attemptedProviders,
    errorMessage: lastError,
  };
}

export function readSlip(
  request: SlipReadRequest,
  provider: string = DEFAULT_SLIP_READER_PROVIDER
): Promise<SlipReadResult> {
  return getSlipReader(provider).read(request);
}
