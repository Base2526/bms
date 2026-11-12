"use client";

import { useEffect, useState } from "react";
import { Button, InputNumber, Modal, Select, Space, Switch, Upload, message } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

type Item = { fileId: number; url: string; active: boolean; startsAt: string | null; endsAt: string | null };
type Settings = {
  version: number; timezone: string; enabled: boolean; defaultFileId: number | null; defaultUrl: string | null;
  intervalSeconds: number; transition: "FADE" | "SLIDE" | "CUT"; items: Item[];
};
const toLocal = (value: string | null, zone: string) => value ? dayjs(value).tz(zone).format("YYYY-MM-DDTHH:mm") : "";
const toIso = (value: string, zone: string) => value ? dayjs.tz(value, zone).toISOString() : null;

export default function QueueBoardMediaEditor({ location, onClose }: {
  location: { id: string; name: string } | null; onClose: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const locationId = location?.id;

  useEffect(() => {
    if (!locationId) { setSettings(null); return; }
    let active = true;
    setLoading(true);
    setError("");
    void fetch(`/api/bms/queue-board/media?locationId=${encodeURIComponent(locationId)}`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || t("queue_board_media.load_error"));
        if (active) setSettings(data.settings);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("queue_board_media.load_error")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locationId]);

  const patch = (next: Partial<Settings>) => setSettings((current) => current ? { ...current, ...next } : current);
  const patchItem = (index: number, next: Partial<Item>) => setSettings((current) => current ? {
    ...current, items: current.items.map((item, position) => position === index ? { ...item, ...next } : item),
  } : current);

  async function upload(file: File, asDefault: boolean) {
    if (!locationId || !settings) return false;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 5 * 1024 * 1024) {
      message.error(t("queue_board_media.image_rules")); return false;
    }
    if (!asDefault && settings.items.length >= 8) { message.error(t("queue_board_media.limit")); return false; }
    setUploading(true);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`/api/bms/queue-board/media/upload?locationId=${encodeURIComponent(locationId)}`,
        { method: "POST", body, credentials: "include" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.fileId) throw new Error(result?.error || t("queue_board_media.upload_error"));
      setSettings((current) => current ? asDefault
        ? { ...current, defaultFileId: result.fileId, defaultUrl: result.url }
        : { ...current, items: [...current.items, { fileId: result.fileId, url: result.url,
          active: true, startsAt: null, endsAt: null }] } : current);
    } catch (cause) { message.error(cause instanceof Error ? cause.message : t("queue_board_media.upload_error")); }
    finally { setUploading(false); }
    return false;
  }

  async function publish() {
    if (!locationId || !settings) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/bms/queue-board/media", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, settings: {
          expectedVersion: settings.version, enabled: settings.enabled, defaultFileId: settings.defaultFileId,
          intervalSeconds: settings.intervalSeconds, transition: settings.transition,
          items: settings.items.map(({ fileId, active, startsAt, endsAt }) => ({ fileId, active, startsAt, endsAt })),
        } }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t("queue_board_media.save_error"));
      setSettings(data.settings);
      message.success(t("queue_board_media.published"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("queue_board_media.save_error")); }
    finally { setSaving(false); }
  }

  const now = Date.now();
  const preview = settings?.enabled
    ? settings.items.find((item) => item.active && (!item.startsAt || Date.parse(item.startsAt) <= now)
      && (!item.endsAt || Date.parse(item.endsAt) > now))?.url ?? settings.defaultUrl
    : settings?.defaultUrl;
  return <Modal open={!!location} title={`${t("queue_board_media.title")} · ${location?.name ?? ""}`}
    onCancel={onClose} width={820} footer={<Space><Button onClick={onClose}>{t("queue_board_media.close")}</Button>
      <Button type="primary" loading={saving} disabled={!settings || loading || uploading}
        onClick={() => void publish()}>{t("queue_board_media.publish")}</Button></Space>}>
    {loading && <p>{t("queue_board_media.loading")}</p>}
    {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    {settings && <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Switch checked={settings.enabled} onChange={(enabled) => patch({ enabled })} />
        {t("queue_board_media.enabled")}
      </label>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label>{t("queue_board_media.interval")}<br /><InputNumber min={4} max={30} precision={0}
          value={settings.intervalSeconds} onChange={(value) => patch({ intervalSeconds: value ?? 8 })} /></label>
        <label>{t("queue_board_media.transition")}<br /><Select style={{ width: 185 }} value={settings.transition}
          onChange={(transition) => patch({ transition })} options={([
            ["FADE", "fade"], ["SLIDE", "slide"], ["CUT", "cut"],
          ] as const).map(([value, key]) => ({ value, label: t(`queue_board_media.${key}`) }))} /></label>
      </div>
      <p style={{ margin: 0, color: "#985400" }}>{t("queue_board_media.public_notice")}</p>
      <div><strong>{t("queue_board_media.default")}</strong><p style={{ margin: "3px 0 8px", color: "#667085" }}>{t("queue_board_media.default_hint")}</p>
        <Space align="start" wrap>{settings.defaultUrl && <img src={settings.defaultUrl} alt={t("queue_board_media.default")}
          style={{ width: 170, height: 96, objectFit: "cover", borderRadius: 8 }} />}
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(file) => upload(file, true)}>
            <Button icon={<UploadOutlined />} loading={uploading}>{t("queue_board_media.upload_default")}</Button>
          </Upload>
          {settings.defaultFileId && <Button danger onClick={() => patch({ defaultFileId: null, defaultUrl: null })}>{t("queue_board_media.remove")}</Button>}</Space>
      </div>
      <div><strong>{t("queue_board_media.playlist")}</strong><p style={{ margin: "3px 0 9px", color: "#667085" }}>
        {t("queue_board_media.schedule_hint")} · {settings.timezone}</p>
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {settings.items.map((item, index) => <div key={item.fileId} style={{ display: "flex", gap: 10, alignItems: "center",
            border: "1px solid #d9e2df", borderRadius: 10, padding: 10, flexWrap: "wrap" }}>
            <img src={item.url} alt={`${t("queue_board_media.image")} ${index + 1}`}
              style={{ width: 120, height: 72, objectFit: "cover", borderRadius: 6 }} />
            <div style={{ flex: "1 1 310px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 7 }}>
                <strong>{index + 1}</strong><Switch size="small" checked={item.active} onChange={(active) => patchItem(index, { active })} />
                <span>{t("queue_board_media.active")}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label>{t("queue_board_media.starts")}<br /><input type="datetime-local" value={toLocal(item.startsAt, settings.timezone)}
                  onChange={(event) => patchItem(index, { startsAt: toIso(event.target.value, settings.timezone) })} /></label>
                <label>{t("queue_board_media.ends")}<br /><input type="datetime-local" value={toLocal(item.endsAt, settings.timezone)}
                  onChange={(event) => patchItem(index, { endsAt: toIso(event.target.value, settings.timezone) })} /></label>
              </div>
            </div>
            <Space><Button size="small" disabled={index === 0} onClick={() => {
              const items = [...settings.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; patch({ items });
            }}>↑</Button><Button size="small" disabled={index === settings.items.length - 1} onClick={() => {
              const items = [...settings.items]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; patch({ items });
            }}>↓</Button><Button size="small" danger icon={<DeleteOutlined />} aria-label={t("queue_board_media.remove")}
              onClick={() => patch({ items: settings.items.filter((_, position) => position !== index) })} /></Space>
          </div>)}
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(file) => upload(file, false)}>
            <Button icon={<PlusOutlined />} loading={uploading} disabled={settings.items.length >= 8}>{t("queue_board_media.add")}</Button>
          </Upload>
        </Space>
      </div>
      <div><strong>{t("queue_board_media.preview")}</strong><div style={{ marginTop: 8, background: "#102039", color: "white",
        borderRadius: 10, padding: 14, display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 12 }}>
        <div style={{ background: "#12643e", borderRadius: 8, padding: 15, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{t("queue_board_media.calling")}</span><strong style={{ fontSize: 46 }}>A042</strong></div>
        <div style={{ minHeight: 100, background: "#1f3327", borderRadius: 8, overflow: "hidden" }}>
          {preview ? <img src={preview} alt={t("queue_board_media.preview")} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <div style={{ padding: 12 }}>{t("queue_board_media.no_image")}</div>}</div>
      </div></div>
    </Space>}
  </Modal>;
}
