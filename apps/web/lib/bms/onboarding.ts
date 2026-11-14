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
  return progressFromRow(result.rows[0]);
}

function progressFromRow(row: any): OnboardingProgress {
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
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, input.editorId ? { editorId: input.editorId } : undefined);
    // Serializes the first upsert as well as edits to an existing profile.
    const tenant = await client.query(`SELECT id FROM bms_tenants WHERE id=$1 FOR UPDATE`, [input.tenantId]);
    if (!tenant.rowCount) throw new Error("ไม่พบร้าน");
    const previous = await client.query(
      `SELECT onboarding_progress, onboarding_dismissed_at, onboarding_last_seen_at
         FROM bms_store_profile WHERE tenant_id=$1 FOR UPDATE`,
      [input.tenantId]
    );
    const current = progressFromRow(previous.rows[0]);
    const completed = input.completed == null ? current.completed : validSteps(input.completed);
    const skipped = (input.skipped == null ? current.skipped : validSteps(input.skipped))
      .filter((step) => !completed.includes(step));
    const updated = await client.query(
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
         updated_at = now()
       RETURNING onboarding_progress, onboarding_dismissed_at, onboarding_last_seen_at`,
      [input.tenantId, JSON.stringify({ completed, skipped }), input.dismissed ?? Boolean(current.dismissedAt)]
    );
    const result = progressFromRow(updated.rows[0]);
    if (input.editorId) {
      await client.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'onboarding.progress_update',$1,$3::jsonb)`,
        [input.tenantId, input.editorId, JSON.stringify({
          completed: result.completed, skipped: result.skipped, dismissed: Boolean(result.dismissedAt),
        })]
      );
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
