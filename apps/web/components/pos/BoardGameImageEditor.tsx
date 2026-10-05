"use client";

import { useRef, useState } from "react";
import { Alert, Button, Modal, Space } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

export default function BoardGameImageEditor({ title, onClose, onSaved }: {
  title: { id: string; title: string; imageUrl?: string | null };
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(file: File | null) {
    if (saving.current) return;
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError(t("admin_board_game.image_invalid")); return;
    }
    saving.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/bms/board-game/library/image?titleId=${encodeURIComponent(title.id)}`, {
        method: file ? "POST" : "DELETE", headers: file ? { "Content-Type": file.type } : undefined, body: file ?? undefined,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("admin_board_game.image_failed"));
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("admin_board_game.image_failed")); }
    finally { saving.current = false; setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <Modal open title={`${t("admin_board_game.game_image")} · ${title.title}`} footer={null}
    closable={!busy} maskClosable={!busy} onCancel={() => { if (!busy) onClose(); }}>
    {error && <Alert type="error" showIcon closable onClose={() => setError("")} message={error} />}
    <p>{t("admin_board_game.image_public")}</p>
    {title.imageUrl && <img src={title.imageUrl} alt={title.title} style={{ width: "100%", height: 240, objectFit: "contain", marginBottom: 16 }} />}
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => {
      const file = e.target.files?.[0]; if (file) void save(file);
    }} />
    <Space wrap>
      <Button type="primary" icon={<UploadOutlined />} loading={busy} onClick={() => input.current?.click()}>{t("admin_board_game.image_upload")}</Button>
      <Button danger icon={<DeleteOutlined />} disabled={busy || !title.imageUrl} onClick={() => Modal.confirm({
        title: t("admin_board_game.image_remove_confirm"), onOk: () => save(null),
      })}>{t("admin_board_game.image_remove")}</Button>
    </Space>
  </Modal>;
}
