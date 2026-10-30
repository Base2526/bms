"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Drawer, Space } from "antd";
import { SoundOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const RetailLocalGuide = dynamic(() => import("./RetailLocalGuide"), { ssr: false });
export default function GuideLauncher() {
  const { lang } = useI18n(); const th = lang === "th";
  const [chapter, setChapter] = useState<string | null>(null);
  const search = useSearchParams();
  const requested = search?.get("guide") ?? null;
  const router = useRouter(); const pathname = usePathname();
  useEffect(() => {
    if (["activate", "backup-setup", "restore", "prepare"].includes(requested || "")) setChapter(requested);
  }, [requested]);
  const close = () => {
    setChapter(null);
    if (requested) {
      const params = new URLSearchParams(search?.toString() ?? ""); params.delete("guide");
      router.replace(`${pathname || "/admin/retail-local-license"}${params.size ? `?${params}` : ""}${window.location.hash}`, { scroll: false });
    }
  };
  return <>
    <Space wrap style={{ marginBottom: 16 }}>
      <Button icon={<SoundOutlined />} onClick={() => setChapter("activate")}>{th ? "ฟังวิธี Activate" : "Listen: activation"}</Button>
      <Button icon={<SoundOutlined />} onClick={() => setChapter("backup-setup")}>{th ? "ฟัง Backup / Restore" : "Listen: backup / restore"}</Button>
      <Button onClick={() => setChapter("prepare")}>{th ? "คู่มือครบทุกขั้น" : "Complete guide"}</Button>
    </Space>
    <Drawer title={th ? "คู่มือเสียง Retail Local" : "Retail Local audio guide"} open={chapter !== null}
      onClose={close} destroyOnClose width={1000}>
      {chapter && <RetailLocalGuide key={chapter} initialStep={chapter} />}
    </Drawer>
  </>;
}
