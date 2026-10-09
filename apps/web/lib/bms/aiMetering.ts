/** Numeric provider evidence only. Never retains prompts, replies or credentials. */
export type AnthropicUsage = {
  input_tokens?: unknown; output_tokens?: unknown;
  cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown;
};

export function meteredUsage(usage?: AnthropicUsage) {
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  const regular = count(usage?.input_tokens);
  const read = count(usage?.cache_read_input_tokens);
  const write = count(usage?.cache_creation_input_tokens);
  return {
    inputTokens: regular == null ? null : regular + (read ?? 0) + (write ?? 0),
    outputTokens: count(usage?.output_tokens),
    cacheReadInputTokens: read,
    cacheCreationInputTokens: write,
  };
}

export class AiMeteredOutputError extends Error {
  constructor(message: string, readonly usage: ReturnType<typeof meteredUsage>) {
    super(message);
    this.name = 'AiMeteredOutputError';
  }
}
