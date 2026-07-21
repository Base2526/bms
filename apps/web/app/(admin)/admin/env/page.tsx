// app/admin/env/page.tsx
import "server-only";
import EnvTableClient from "./EnvTableClient";

export type EnvRow = { key: string; value: string; masked: boolean };
// gate: อยู่ใน env/layout.tsx (requirePlatformAdminPage)

function maskValue(v: string) {
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 3)}***${v.slice(-3)}`;
}

function isSensitiveKey(key: string) {
  return /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|COOKIE|SESSION|AUTH|JWT)/i.test(key);
}

function pickEnv(obj: NodeJS.ProcessEnv): EnvRow[] {
  // ปรับ prefix ที่อยากแสดงได้ตามโปรเจค
  const allowPrefixes = [
    "NODE_",
    "NEXT_",
    "DATABASE_",
    "REDIS_",
    "S3_",
    "AWS_",
    "SMTP_",
    "MAIL_",
    "X_",
    "GOOGLE_",
    "LINE_",
    "ANTHROPIC_",
    "BMS_AI_MODEL",
  ];

  const out: EnvRow[] = [];
  for (const [k, raw] of Object.entries(obj)) {
    if (!allowPrefixes.some((p) => k.startsWith(p))) continue;

    const value = String(raw ?? "");
    const sensitive = isSensitiveKey(k);

    out.push({
      key: k,
      value: sensitive ? maskValue(value) : value,
      masked: sensitive,
    });
  }

  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

export default async function EnvPage() {
  const env = pickEnv(process.env);

  const meta = {
    nodeEnv: process.env.NODE_ENV ?? "-",
    runtime: process.env.NEXT_RUNTIME ?? "-",
    hostname: process.env.HOSTNAME ?? "-",
    pid: String(process.pid),
    uptimeSec: String(Math.floor(process.uptime())),
    now: new Date().toISOString(),
  };

  return <EnvTableClient env={env} meta={meta} />;
}
