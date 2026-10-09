/** Server policy shared by accounting, owner notices and the usage response. */
export type AiLimitStatus = 'NORMAL' | 'WARNING_80' | 'WARNING_90' | 'PAUSED_CREDITS' | 'PAUSED_BUDGET' | 'PAUSED_UNPRICED';
export function warningStatus(used: number, capacity: number): AiLimitStatus {
  if (capacity <= 0) return 'NORMAL';
  if (used >= capacity * 0.9) return 'WARNING_90';
  if (used >= capacity * 0.8) return 'WARNING_80';
  return 'NORMAL';
}
export function creditLimitStatus(unlimited: boolean, capacity: number, consumed: number): AiLimitStatus {
  if (unlimited) return 'NORMAL';
  if (consumed >= capacity) return 'PAUSED_CREDITS';
  return warningStatus(consumed, capacity);
}
export function budgetLimitStatus(input: { limit: number; spent: number; reserved: number; unaccounted: number; required: number; unpricedModel: boolean }): AiLimitStatus {
  if (input.unaccounted > 0 || input.unpricedModel) return 'PAUSED_UNPRICED';
  const available = Math.round((input.limit - input.spent - input.reserved) * 1e8);
  if (available <= 0 || available < Math.round(input.required * 1e8)) return 'PAUSED_BUDGET';
  return warningStatus(input.spent + input.reserved, input.limit);
}
export function aiPeriodResetsAt(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString();
}
