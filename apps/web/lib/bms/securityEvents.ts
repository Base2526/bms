import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";

export type SecurityEventInput = {
  tenantId?: string | null;
  actorUserId?: string | null;
  event: "auth.login" | "auth.logout" | "auth.login_denied" | "auth.password_reset" |
    "access.sensitive_read" | "tenant.impersonate.enter" | "tenant.impersonate.exit" | "tenant.delete";
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  source: string;
  reasonCode?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

/** Never persist a bearer token or the raw admin JWT jti in audit evidence. */
function sessionReference(sessionId: string | null | undefined): string | null {
  return sessionId ? createHash("sha256").update(sessionId).digest("hex") : null;
}

/** Required before returning a successful privileged login or a sensitive file. */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  await writeSecurityEvent(query, input);
}

export async function insertSecurityEventInTx(client: PoolClient, input: SecurityEventInput): Promise<void> {
  await writeSecurityEvent((sql, params) => client.query(sql, params), input);
}

async function writeSecurityEvent(
  run: (sql: string, params: unknown[]) => Promise<unknown>,
  input: SecurityEventInput
): Promise<void> {
  await run(
    `INSERT INTO bms_security_events
       (tenant_id, actor_user_id, event, outcome, source, session_ref,
        reason_code, request_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [input.tenantId ?? null, input.actorUserId ?? null, input.event,
      input.outcome, input.source, sessionReference(input.sessionId),
      input.reasonCode ?? null, input.requestId ?? null, JSON.stringify(input.meta ?? {})]
  );
}

/** Failed anonymous attempts are diagnostic; audit storage must not reveal account existence. */
export async function recordSecurityEventBestEffort(input: SecurityEventInput): Promise<void> {
  try {
    await recordSecurityEvent(input);
  } catch (error) {
    console.error("[BMS] security event failed", error instanceof Error ? error.name : "unknown");
  }
}
