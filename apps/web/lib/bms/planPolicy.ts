/** Resolve the catalogue's scheduled AI allowance; old schemas have no schedule. */
export function resolvePlanAiAllowance(row: {
  ai_credits_monthly?: number | null;
  max_ai_messages_month: number;
  ai_credits_previous_monthly?: number | null;
  ai_credits_effective_at?: Date | string | null;
}, now = Date.now()) {
  const target = row.ai_credits_monthly ?? row.max_ai_messages_month;
  const effectiveAt = row.ai_credits_effective_at == null ? null : new Date(row.ai_credits_effective_at);
  const pending = effectiveAt != null && effectiveAt.getTime() > now && row.ai_credits_previous_monthly != null;
  const current = pending ? row.ai_credits_previous_monthly! : target;
  return {
    ai_credits_monthly: current,
    max_ai_messages_month: current,
    ai_credits_next_monthly: pending ? target : null,
    ai_credits_change_at: pending ? effectiveAt!.toISOString() : null,
  };
}
