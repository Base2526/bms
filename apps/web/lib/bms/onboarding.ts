import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export const ONBOARDING_STEP_KEYS = ["shop", "payment", "products", "channels", "restock"] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingProgress = {
  completed: OnboardingStepKey[];
  skipped: OnboardingStepKey[];
  dismissedAt: string | null;
  lastSeenAt: string | null;
};

function validSteps(value: unknown): OnboardingStepKey[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((step): step is OnboardingStepKey =>
    typeof step === "string" && ONBOARDING_STEP_KEYS.includes(step as OnboardingStepKey)
  )));
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getOnboardingProgress(tenantId: string): Promise<OnboardingProgress> {
  const result = await query<any>(
    `SELECT onboarding_progress, onboarding_dismissed_at, onboarding_last_seen_at
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = result.rows[0];
  const progress = row?.onboarding_progress && typeof row.onboarding_progress === "object"
    ? row.onboarding_progress
    : {};
  return {
    completed: validSteps(progress.completed),
    skipped: validSteps(progress.skipped),
    dismissedAt: iso(row?.onboarding_dismissed_at),
    lastSeenAt: iso(row?.onboarding_last_seen_at),
  };
}

export async function updateOnboardingProgress(input: {
  tenantId: string;
  completed?: string[] | null;
  skipped?: string[] | null;
  dismissed?: boolean | null;
  editorId?: string | null;
}): Promise<OnboardingProgress> {
  const current = await getOnboardingProgress(input.tenantId);
  const completed = input.completed == null ? current.completed : validSteps(input.completed);
  const skipped = (input.skipped == null ? current.skipped : validSteps(input.skipped))
    .filter((step) => !completed.includes(step));
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, input.editorId ? { editorId: input.editorId } : undefined);
    await client.query(
      `INSERT INTO bms_store_profile
         (tenant_id, onboarding_progress, onboarding_dismissed_at, onboarding_last_seen_at)
       VALUES ($1, $2::jsonb, CASE WHEN $3::boolean THEN now() ELSE NULL END, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         onboarding_progress = EXCLUDED.onboarding_progress,
         onboarding_dismissed_at = CASE
           WHEN $3::boolean THEN COALESCE(bms_store_profile.onboarding_dismissed_at, now())
           ELSE NULL
         END,
         onboarding_last_seen_at = now(),
         updated_at = now()`,
      [input.tenantId, JSON.stringify({ completed, skipped }), input.dismissed ?? Boolean(current.dismissedAt)]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  return getOnboardingProgress(input.tenantId);
}
