import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type OperationKind = "GitHub Action" | "Cron Endpoint";
export type OperationStatus = "Scheduled" | "Ready but unscheduled";

export type OperationScheduleRow = {
  key: string;
  name: string;
  kind: OperationKind;
  status: OperationStatus;
  when: string;
  trigger: string;
  purpose: string;
  evidence: string;
  sourcePath: string;
  docsPath?: string;
  aiView?: {
    input: string[];
    safeguards: string[];
    outcome: string[];
  };
};

type OperationDefinition = {
  key: string;
  name: string;
  kind: OperationKind;
  sourcePath: string;
  docsPath?: string;
  triggerHint?: string;
  purposeFallback: string;
  whenFallback: string;
  statusFallback: OperationStatus;
  triggerFallback: string;
  evidenceFallback: string;
};

const DEFINITIONS: OperationDefinition[] = [
  {
    key: "daily-log-triage",
    name: "Daily Log Triage",
    kind: "GitHub Action",
    sourcePath: ".github/workflows/daily-log-triage.yml",
    docsPath: "docs/architecture/system.md",
    purposeFallback:
      "Collect recent errors, redact sensitive data, ask AI to analyze them, then open a draft PR.",
    whenFallback: "Every day at 22:00 UTC",
    statusFallback: "Scheduled",
    triggerFallback: "GitHub Actions schedule + manual run",
    evidenceFallback: "Configured as cron 0 22 * * * with workflow_dispatch enabled.",
  },
  {
    key: "support-diagnostics-retention",
    name: "Support Diagnostics Retention",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/support-diagnostics/purge-expired/route.ts",
    docsPath: "docs/business/support-diagnostics.md",
    triggerHint: "POST /api/bms/support-diagnostics/purge-expired",
    purposeFallback: "Physically delete expired private diagnostic bundles and soft-delete their file records.",
    whenFallback: "Recommended daily",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/support-diagnostics/purge-expired",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "release-expired",
    name: "Release Expired Orders",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/orders/release-expired/route.ts",
    docsPath: "docs/architecture/api.md",
    triggerHint: "POST /api/bms/orders/release-expired?minutes=30",
    purposeFallback: "Cancel stale RESERVED orders and return reserved stock.",
    whenFallback: "Recommended every 5 minutes",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/orders/release-expired?minutes=30",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "menu-availability-reset",
    name: "Restaurant Menu Availability Reset",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/menu-availability/reset/route.ts",
    docsPath: "docs/business/pos.md",
    triggerHint: "POST /api/bms/menu-availability/reset",
    purposeFallback: "Reopen branch-scoped menus whose tenant-local service-day reset time has arrived.",
    whenFallback: "Every 15 minutes",
    statusFallback: "Scheduled",
    triggerFallback: "GitHub Actions frequent schedule",
    evidenceFallback: "Called by the frequent matrix in .github/workflows/bms-cron.yml.",
  },
  {
    key: "loyalty-maintenance",
    name: "Loyalty Maintenance",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/loyalty/maintenance/route.ts",
    docsPath: "docs/business/pos.md",
    triggerHint: "POST /api/bms/loyalty/maintenance",
    purposeFallback:
      "Expire overdue loyalty points (FIFO) and re-evaluate membership tiers for every shop with the program enabled.",
    whenFallback: "Recommended daily (e.g. 03:00)",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/loyalty/maintenance",
    evidenceFallback:
      "Cron endpoint is available and idempotent, but no repository-level scheduler is configured — points do not expire until it runs.",
  },
  {
    key: "channel-health",
    name: "Channel Health Check",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/channels/check-health/route.ts",
    docsPath: "docs/architecture/system.md",
    triggerHint: "POST /api/bms/channels/check-health",
    purposeFallback: "Detect channels with no inbound events for too long and flag them for ops.",
    whenFallback: "Recommended daily",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/channels/check-health",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "ai-health",
    name: "AI Provider Health Check",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/ai/check-health/route.ts",
    docsPath: "docs/architecture/system.md",
    triggerHint: "POST /api/bms/ai/check-health",
    purposeFallback: "Run real provider checks and update shared AI health status.",
    whenFallback: "Recommended hourly",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/ai/check-health",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "report-digest",
    name: "Sales Digest Delivery",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/reports/send-digest/route.ts",
    docsPath: "docs/ui/dashboard.md",
    triggerHint: "POST /api/bms/reports/send-digest",
    purposeFallback:
      "Send daily, weekly, and monthly digest reports when each shop schedule matches the current hour.",
    whenFallback: "Recommended hourly",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/reports/send-digest",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "followups",
    name: "Follow-up Automation Run",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/followups/run/route.ts",
    docsPath: "docs/business/crm.md",
    triggerHint: "POST /api/bms/followups/run",
    purposeFallback:
      "Schedule new follow-up jobs for idle conversations, then process due jobs and record the outcomes.",
    whenFallback: "Recommended every 2-5 minutes",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/followups/run",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
  {
    key: "carrier-tracking-sync",
    name: "Carrier Tracking Sync",
    kind: "Cron Endpoint",
    sourcePath: "apps/web/app/api/bms/shipping/sync-carriers/route.ts",
    docsPath: "docs/architecture/api.md",
    triggerHint: "POST /api/bms/shipping/sync-carriers",
    purposeFallback: "Refresh active Flash/Kerry shipment statuses from configured carrier adapters.",
    whenFallback: "Recommended every 15 minutes",
    statusFallback: "Ready but unscheduled",
    triggerFallback: "POST /api/bms/shipping/sync-carriers",
    evidenceFallback: "Cron endpoint is available, but no repository-level scheduler is configured.",
  },
];

async function readSourceIfAvailable(sourcePath: string) {
  const candidates = new Set([
    path.join(process.cwd(), sourcePath),
    path.join(process.cwd(), sourcePath.replace(/^apps\/web\//, "")),
    path.resolve(process.cwd(), "..", sourcePath),
    path.resolve(process.cwd(), "../..", sourcePath),
    path.resolve(process.cwd(), "../../..", sourcePath),
  ]);

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function cleanCommentLine(line: string) {
  return line
    .replace(/^\s*\/\/\s?/, "")
    .replace(/^\s*#\s?/, "")
    .trim();
}

function extractTopCommentLines(content: string) {
  return content
    .split("\n")
    .slice(0, 18)
    .map(cleanCommentLine)
    .filter(Boolean)
    .filter((line) => !/^=+$/.test(line) && !/^-+$/.test(line));
}

function inferPurposeFromComments(lines: string[], fallback: string) {
  const candidate = lines.find(
    (line) =>
      !line.startsWith("curl ") &&
      !line.startsWith("-H ") &&
      !line.startsWith("ป้องกันด้วย header") &&
      !line.startsWith("ตั้ง cron") &&
      !line.startsWith("ยังไม่ได้ตั้ง cron") &&
      !line.startsWith("Different from") &&
      !line.startsWith("ต่างจาก") &&
      !line.startsWith("Jobs") &&
      !line.startsWith("ENV:")
  );
  return candidate || fallback;
}

function cronToText(cron: string) {
  if (cron === "0 22 * * *") return "Every day at 22:00 UTC";
  return cron;
}

function inferWhenFromComments(lines: string[], fallback: string) {
  const scheduled = lines.find((line) => line.includes("cron:"));
  if (scheduled) {
    const cron = scheduled.match(/cron:\s*"([^"]+)"/)?.[1];
    return cron ? cronToText(cron) : scheduled;
  }

  const recommendation = lines.find(
    (line) =>
      line.startsWith("ตั้ง cron") ||
      line.startsWith("Doesn't need to run") ||
      line.startsWith("ตั้ง cron ให้ยิง") ||
      line.startsWith("DeepSeek/Anthropic OCR/Qwen")
  );
  return recommendation || fallback;
}

async function buildWorkflowRow(def: OperationDefinition): Promise<OperationScheduleRow> {
  const source = await readSourceIfAvailable(def.sourcePath);
  if (!source) return buildFallbackRow(def);
  const lines = extractTopCommentLines(source);
  const cron = source.match(/cron:\s*"([^"]+)"/)?.[1];
  const hasManualRun = /workflow_dispatch:/m.test(source);
  const when = cron ? cronToText(cron) : def.whenFallback;
  const trigger = hasManualRun ? "GitHub Actions schedule + manual run" : "GitHub Actions schedule";

  return {
    key: def.key,
    name: def.name,
    kind: def.kind,
    status: cron ? "Scheduled" : "Ready but unscheduled",
    when,
    trigger,
    purpose: inferPurposeFromComments(lines, def.purposeFallback),
    evidence: cron
      ? `Cron ${cron} found in ${def.sourcePath}${hasManualRun ? " with workflow_dispatch enabled." : "."}`
      : `Workflow file exists at ${def.sourcePath}, but no schedule was found.`,
    sourcePath: def.sourcePath,
    docsPath: def.docsPath,
    aiView: def.key === "daily-log-triage" ? buildDailyLogTriageAiView(source) : undefined,
  };
}

async function buildRouteRow(def: OperationDefinition): Promise<OperationScheduleRow> {
  const source = await readSourceIfAvailable(def.sourcePath);
  if (!source) return buildFallbackRow(def);
  const workflow = await readSourceIfAvailable(".github/workflows/bms-cron.yml");
  const lines = extractTopCommentLines(source);
  const when = inferWhenFromComments(lines, def.whenFallback);
  const unauthorizedGuard = source.includes("x-cron-secret");
  const trigger =
    def.triggerHint ||
    source.match(/POST\s+(\/api\/[^\s—]+)/)?.[1] ||
    def.sourcePath;
  const routePath = trigger.replace(/^POST\s+/, "");
  const scheduled = Boolean(workflow?.includes(`path: ${routePath}`));

  return {
    key: def.key,
    name: def.name,
    kind: def.kind,
    status: scheduled ? "Scheduled" : "Ready but unscheduled",
    when,
    trigger,
    purpose: inferPurposeFromComments(lines, def.purposeFallback),
    evidence: scheduled
      ? `${def.sourcePath} exposes the cron entrypoint and .github/workflows/bms-cron.yml calls it${unauthorizedGuard ? " with x-cron-secret" : ""}.`
      : `${def.sourcePath} exposes the cron entrypoint${unauthorizedGuard ? " and checks x-cron-secret" : ""}; no repo-level scheduler was found for it.`,
    sourcePath: def.sourcePath,
    docsPath: def.docsPath,
  };
}

function buildFallbackRow(def: OperationDefinition): OperationScheduleRow {
  return {
    key: def.key,
    name: def.name,
    kind: def.kind,
    status: def.statusFallback,
    when: def.whenFallback,
    trigger: def.triggerFallback,
    purpose: def.purposeFallback,
    evidence: `${def.evidenceFallback} Source inspection is unavailable in this deployment; showing the verified operations registry.`,
    sourcePath: def.sourcePath,
    docsPath: def.docsPath,
    aiView: def.key === "daily-log-triage" ? buildDailyLogTriageAiFallback() : undefined,
  };
}

function buildDailyLogTriageAiView(source: string): NonNullable<OperationScheduleRow["aiView"]> {
  const windowHours = source.match(/LOG_WINDOW_HOURS:\s*"(\d+)"/)?.[1] || "24";
  const maxGroups = source.match(/LOG_MAX_GROUPS:\s*"(\d+)"/)?.[1] || "30";
  const promptTarget = source.includes("อ่านไฟล์ `bms-log-report.md`")
    ? "`bms-log-report.md`"
    : "redacted log report";

  return {
    input: [
      `AI reads ${promptTarget}, not raw database rows directly.`,
      `The report contains error groups from the last ${windowHours} hours, capped at ${maxGroups} groups.`,
      "Each group includes category, redacted message, count, latest timestamp, optional route, and up to 20 stack lines.",
    ],
    safeguards: [
      "Collector redacts email, phone, bearer token, API key, encrypted blobs, long hex strings, and IPv4 addresses before export.",
      "Workflow allows only limited tools for AI: read/edit code, git/gh, typecheck, and npm.",
      "Prompt forbids touching migrations, secrets, env, or broad config changes, and requires minimal high-confidence fixes only.",
    ],
    outcome: [
      "If errors exist, AI analyzes the report and opens a draft PR for human review.",
      "If no confident fix is available, the draft PR should contain analysis only instead of risky code changes.",
      "Nothing auto-merges or auto-deploys from this workflow.",
    ],
  };
}

function buildDailyLogTriageAiFallback(): NonNullable<OperationScheduleRow["aiView"]> {
  return {
    input: [
      "AI receives a redacted `bms-log-report.md` summary instead of raw logs.",
      "That report is built from recent grouped errors with counts, timestamps, route hints, and stack samples.",
      "The verified registry says the workflow uses a 24-hour log window before sending the report to AI.",
    ],
    safeguards: [
      "Sensitive values are redacted before the report leaves the collector step.",
      "The workflow is constrained to code-editing and verification tools only.",
      "The process is draft-PR only, so a human must review before merge.",
    ],
    outcome: [
      "Expected output is a draft PR with analysis and, only when confidence is high, a minimal patch proposal.",
      "If no safe fix is found, the report should still be surfaced for human review without forced code changes.",
      "Automatic deploy is intentionally excluded.",
    ],
  };
}

export async function listOperationSchedules(): Promise<OperationScheduleRow[]> {
  return Promise.all(
    DEFINITIONS.map((def) =>
      def.kind === "GitHub Action" ? buildWorkflowRow(def) : buildRouteRow(def)
    )
  );
}
