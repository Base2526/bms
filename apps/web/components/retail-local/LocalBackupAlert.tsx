"use client";
import useSWR from "swr";
import Link from "next/link";
import { Alert } from "antd";
import { useRetailLocalMode } from "./RetailLocalMode";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import type { LocalBackupState } from "@/lib/bms/localBackupView";
export default function LocalBackupAlert() {
  const local = useRetailLocalMode(); const { can } = useBmsPermissions(); const { lang } = useI18n(); const th = lang === "th";
  const enabled = local && can("retail_local.license.view");
  const { data, error, isLoading } = useSWR<{ status: LocalBackupState }>(enabled ? "/api/admin/retail-local/backup-status" : null, async url => {
    const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error("unknown"); return r.json();
  }, { refreshInterval: 60_000, shouldRetryOnError: false });
  if (!enabled || isLoading) return null;
  const state = error ? "unknown" : data?.status ?? "unknown";
  if (state === "passed") return null;
  const messages = {
    unknown: ["ตรวจสถานะ backup ไม่ได้ กรุณาตรวจบนเครื่องร้าน", "Backup status unavailable. Check the shop host."],
    not_configured: ["ยังไม่ได้ตั้ง backup นอกเครื่อง", "Off-host backup is not configured."],
    stale: ["backup นอกเครื่องล่าสุดเก่ากว่า 7 วัน", "The latest off-host backup is over 7 days old."],
    failed: ["backup นอกเครื่องครั้งล่าสุดล้มเหลว", "The latest off-host backup failed."],
  };
  const text = messages[state as keyof typeof messages] ?? messages.unknown;
  return <Alert key={state} closable showIcon type="warning" style={{ marginBottom: 16 }} message={text[th ? 0 : 1]} description={<>
    <Link href="/admin/retail-local-license#backup">{th ? "ดูวิธีตั้ง backup ไป USB/NAS ของร้าน" : "Set up backups to your own USB/NAS"}</Link>{" · "}
    <Link href="/admin/retail-local-license?guide=backup-setup#backup">{th ? "ฟังวิธี Backup / Restore" : "Listen to backup / restore guidance"}</Link>
  </>} />;
}
