// app/(admin)/admin/system-health/page.tsx
// gate: อยู่ใน system-health/layout.tsx (requirePlatformAdminPage)
//
// รวมของที่มีอยู่แล้วเป็นหน้าเดียว — ไม่สร้าง subsystem ใหม่:
//   - DB/Redis: read ใหม่ (เล็ก, read-only) เพราะยังไม่มีทางดูมาก่อนเลย
//   - AI Provider Health / Job Runs: reuse service เดิม 100% (listAiProviderHealth,
//     listLatestJobRunPerJob) — คนละหน้าเดียวกับ /admin/env, /admin/operations-schedule
//   - Channel Health / Failure Incidents: เพิ่ม read ข้ามร้าน (ของเดิม tenant-scoped
//     อย่างเดียว / ไม่มี list เลย) เพราะหน้านี้เป็นภาพรวมทั้งแพลตฟอร์ม
import "server-only";
import {
  getDbHealth,
  getRedisHealth,
  getChannelHealthOverview,
  getFailureIncidentsOverview,
} from "@/lib/bms/systemHealth";
import { listAiProviderHealth } from "@/lib/bms/aiProviderHealth";
import { listLatestJobRunPerJob } from "@/lib/bms/jobRuns";
import { listOperationSchedules } from "@/lib/bms/operationsSchedule";
import { getRequestMetrics } from "@/lib/bms/requestMetrics";
import SystemHealthClient from "./SystemHealthClient";

// อ่านสดทุกครั้ง — หน้านี้คือสถานะ ณ ตอนนี้ ห้ามให้ Next cache ค้าง
export const dynamic = "force-dynamic";

const ALLOWED_WINDOWS = [15, 60, 180];

export default async function SystemHealthPage({
  searchParams,
}: {
  searchParams?: { window?: string };
}) {
  const requested = Number(searchParams?.window);
  const windowMinutes = ALLOWED_WINDOWS.includes(requested) ? requested : 60;

  const [db, redis, aiProviders, jobRuns, jobDefs, channelHealth, failureIncidents, requestMetrics] =
    await Promise.all([
      getDbHealth(),
      getRedisHealth(),
      listAiProviderHealth().catch((err) => ({ error: String(err?.message ?? err) })),
      listLatestJobRunPerJob().catch((err) => ({ error: String(err?.message ?? err) })),
      listOperationSchedules().catch(() => []),
      getChannelHealthOverview(),
      getFailureIncidentsOverview(),
      getRequestMetrics(windowMinutes),
    ]);

  const jobNameByKey = new Map(jobDefs.map((d) => [d.key, d.name]));

  return (
    <SystemHealthClient
      generatedAt={new Date().toISOString()}
      db={db}
      redis={redis}
      aiProviders={Array.isArray(aiProviders) ? aiProviders : null}
      aiProvidersError={Array.isArray(aiProviders) ? null : aiProviders.error}
      jobRuns={Array.isArray(jobRuns) ? jobRuns : null}
      jobRunsError={Array.isArray(jobRuns) ? null : jobRuns.error}
      jobNameByKey={Object.fromEntries(jobNameByKey)}
      channelHealth={channelHealth}
      failureIncidents={failureIncidents}
      requestMetrics={requestMetrics}
      windowMinutes={windowMinutes}
      windowOptions={ALLOWED_WINDOWS}
    />
  );
}
