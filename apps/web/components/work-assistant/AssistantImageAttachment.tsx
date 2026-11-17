"use client";

import { Button, Space, Typography } from "antd";
import { CameraOutlined, CloseOutlined, PaperClipOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export type AssistantDraftImage = {
  file: File;
  previewUrl: string;
};

export function useAssistantImageAttachment(en: boolean) {
  const [draft, setDraft] = useState<AssistantDraftImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
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
    setDraft({ file, previewUrl });
    setError(null);
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

  const captureScreen = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(en ? "Screen capture is unavailable in this browser. Paste or attach an image." : "เบราว์เซอร์นี้จับภาพหน้าจอไม่ได้ กรุณาวางหรือแนบภาพแทน");
      return;
    }
    setError(null);
    setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth || !video.videoHeight) throw new Error();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2560 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error();
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error()), "image/png");
      });
      selectFile(new File([blob], `screen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, { type: "image/png" }));
      video.srcObject = null;
    } catch (caught: any) {
      if (caught?.name !== "NotAllowedError") {
        setError(en ? "Could not capture the screen. Try pasting a screenshot instead." : "จับภาพหน้าจอไม่สำเร็จ กรุณาลองวางภาพหน้าจอแทน");
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setCapturing(false);
    }
  };

  return { draft, error, capturing, selectFile, removeDraft, takeDraft, releaseAll, pasteImage, dropImage, captureScreen };
}

export function AssistantImageAttachmentControls({
  en, draft, error, capturing, disabled, onSelect, onRemove, onCapture,
}: {
  en: boolean;
  draft: AssistantDraftImage | null;
  error: string | null;
  capturing: boolean;
  disabled: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  onCapture: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <Space size={8} wrap>
        <Button icon={<PaperClipOutlined />} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {en ? "Attach image" : "แนบภาพ"}
        </Button>
        <Button icon={<CameraOutlined />} disabled={disabled} loading={capturing} onClick={onCapture}>
          {en ? "Capture screen" : "จับภาพหน้าจอ"}
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
