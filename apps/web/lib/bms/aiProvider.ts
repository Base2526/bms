import { DEFAULT_AI_MODEL } from "./aiConfig";

export const DEFAULT_AI_PROVIDER = "deepseek";
export const DEFAULT_SENSITIVE_AI_PROVIDER = "anthropic";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
export const ANTHROPIC_API_VERSION = "2023-06-01";

export type AiProvider = "anthropic" | "deepseek";

export type ResolvedAiProvider = {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type AiRoutingReason =
  | "byok"
  | "primary"
  | "sensitive"
  | "fallback_missing_credentials";

export type ResolvedAiProviderDecision = {
  resolved: ResolvedAiProvider | null;
  configuredProvider: AiProvider;
  routingReason: Exclude<AiRoutingReason, "byok">;
  fallbackFrom: AiProvider | null;
};

export type AiProviderRoutingContext = {
  surface?: "customer" | "staff" | "system";
  feature?: string;
  meta?: Record<string, unknown>;
};

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function normalizeAiProvider(value: unknown): AiProvider | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "anthropic" || normalized === "deepseek") return normalized;
  return null;
}

export function buildAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

function anthropicSharedProvider(): ResolvedAiProvider | null {
  if (!hasValue(process.env.ANTHROPIC_API_KEY)) return null;
  return {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.BMS_AI_MODEL || DEFAULT_AI_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
  };
}

function deepseekSharedProvider(): ResolvedAiProvider | null {
  if (!hasValue(process.env.DEEPSEEK_API_KEY)) return null;
  return {
    provider: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
  };
}

export function resolveTenantByokProvider(
  apiKey: string,
  model?: string | null,
  provider: AiProvider = "anthropic"
): ResolvedAiProvider {
  if (provider === "deepseek") {
    return {
      provider,
      apiKey,
      model: model || DEFAULT_DEEPSEEK_MODEL,
      baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    };
  }
  return {
    provider: "anthropic",
    apiKey,
    model: model || DEFAULT_AI_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
  };
}

export function resolveSharedAiProvider(
  preferred?: AiProvider | null,
  allowFallback = true
): ResolvedAiProvider | null {
  const chosen = preferred ?? normalizeAiProvider(process.env.BMS_AI_PROVIDER) ?? DEFAULT_AI_PROVIDER;
  const order: AiProvider[] = allowFallback
    ? chosen === "deepseek"
      ? ["deepseek", "anthropic"]
      : ["anthropic", "deepseek"]
    : [chosen];
  for (const provider of order) {
    const resolved =
      provider === "deepseek" ? deepseekSharedProvider() : anthropicSharedProvider();
    if (resolved) return resolved;
  }
  return null;
}

export function isSensitiveAiRoutingContext(ctx?: AiProviderRoutingContext): boolean {
  return (
    ctx?.meta?.sensitive === true ||
    ctx?.feature === "staff_sensitive_assistant" ||
    ctx?.feature === "payment_confirmation" ||
    ctx?.feature === "refund_payment"
  );
}

export function resolveSharedAiProviderForUsage(
  ctx?: AiProviderRoutingContext
): ResolvedAiProvider | null {
  return resolveSharedAiProviderDecision(ctx).resolved;
}

export function resolveSharedAiProviderDecision(
  ctx?: AiProviderRoutingContext
): ResolvedAiProviderDecision {
  const sensitive = isSensitiveAiRoutingContext(ctx);
  const preferred = sensitive
    ? normalizeAiProvider(process.env.BMS_AI_SENSITIVE_PROVIDER) ?? DEFAULT_SENSITIVE_AI_PROVIDER
    : normalizeAiProvider(process.env.BMS_AI_PROVIDER) ?? DEFAULT_AI_PROVIDER;
  const resolved = resolveSharedAiProvider(preferred);
  const fallbackFrom = resolved && resolved.provider !== preferred ? preferred : null;
  return {
    resolved,
    configuredProvider: preferred,
    routingReason: fallbackFrom
      ? "fallback_missing_credentials"
      : sensitive
        ? "sensitive"
        : "primary",
    fallbackFrom,
  };
}

export async function callAnthropicCompatibleMessages(
  provider: ResolvedAiProvider,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(buildAnthropicMessagesUrl(provider.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  });
}
