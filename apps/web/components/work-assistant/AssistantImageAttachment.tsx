"use client";

import { Button, Checkbox, Space, Typography } from "antd";
import { CloseOutlined, PaperClipOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export type AssistantDraftImage = {
  file: File;
  previewUrl: string;
  confirmedBms: boolean;
};

export function useAssistantImageAttachment(en: boolean) {
  const [draft, setDraft] = useState<AssistantDraftImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  const removeDraft = () => {
    if (draft) {
      URL.revokeObjectURL(draft.previewUrl);
      urls.current.delete(draft.previewUrl);
    }
    setDraft(null);
    setError(null);
  };

  const selectFile = (file: File) => {
    if (!ACCEPTED_MIME.has(file.type)) {
      setError(en ? "Choose a PNG, JPEG, or WebP image." : "เลือกภาพ PNG, JPEG หรือ WebP");
      return;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setError(en ? "The image must be under 10 MB." : "ภาพต้องไม่เกิน 10 MB");
      return;
    }
    if (draft) {
      URL.revokeObjectURL(draft.previewUrl);
      urls.current.delete(draft.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    urls.current.add(previewUrl);
    setDraft({ file, previewUrl, confirmedBms: false });
    setError(null);
  };

  const confirmBms = (confirmed: boolean) => {
    setDraft((current) => current ? { ...current, confirmedBms: confirmed } : null);
  };

  const takeDraft = () => {
    const value = draft;
    setDraft(null);
    setError(null);
    return value;
  };

  const releaseAll = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setDraft(null);
    setError(null);
  };

  const pasteImage = (event: ClipboardEvent<HTMLElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    selectFile(file);
  };

  const dropImage = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  };

  return { draft, error, selectFile, confirmBms, removeDraft, takeDraft, releaseAll, pasteImage, dropImage };
}

export function AssistantImageAttachmentControls({
  en, draft, error, disabled, onSelect, onConfirmBms, onRemove,
}: {
  en: boolean;
  draft: AssistantDraftImage | null;
  error: string | null;
  disabled: boolean;
  onSelect: (file: File) => void;
  onConfirmBms: (confirmed: boolean) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <Space size={8} wrap>
        <Button icon={<PaperClipOutlined />} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {en ? "Attach image" : "แนบภาพ"}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {en ? "Or paste a screenshot (Ctrl/⌘+V)" : "หรือวางภาพหน้าจอ (Ctrl/⌘+V)"}
        </Typography.Text>
      </Space>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }} />
      {draft ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%", background: "var(--app-surface-muted, #f5f5f5)", borderRadius: 8, padding: 6 }}>
          <img src={draft.previewUrl} alt={en ? "Image ready to send" : "ภาพที่เตรียมส่ง"}
            style={{ width: 52, height: 42, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
          <Typography.Text ellipsis style={{ minWidth: 0, flex: 1 }}>{draft.file.name}</Typography.Text>
          <Button type="text" shape="circle" icon={<CloseOutlined />} disabled={disabled}
            aria-label={en ? "Remove attached image" : "ลบภาพที่แนบ"} onClick={onRemove} />
        </div>
      ) : null}
      {draft ? <Checkbox checked={draft.confirmedBms} disabled={disabled} onChange={(event) => onConfirmBms(event.target.checked)}>
        {en ? "I confirm this shows a BMS screen. Images from other apps are out of scope." : "ยืนยันว่าภาพนี้เป็นหน้าจอ BMS — ไม่รองรับภาพจากระบบอื่น"}
      </Checkbox> : null}
      {error ? <Typography.Text type="danger" role="alert">{error}</Typography.Text> : null}
      {draft ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {en ? "The image is sent to the AI with your question. It is not saved in chat history." : "ภาพจะถูกส่งให้ AI พร้อมคำถาม และไม่บันทึกไฟล์ภาพลงในประวัติแชต"}
      </Typography.Text> : null}
    </div>
  );
}

export function AssistantSentImage({ name, previewUrl, en }: { name: string; previewUrl?: string; en: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, minWidth: 0 }}>
      {previewUrl ? <img src={previewUrl} alt={en ? "Attached screenshot" : "ภาพหน้าจอที่แนบ"}
        style={{ width: 72, height: 56, objectFit: "cover", borderRadius: 6 }} /> : <PaperClipOutlined />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </div>
  );
}
