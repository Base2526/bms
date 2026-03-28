"use client";

import React, {
  useMemo,
  useCallback,
  KeyboardEvent,
  useState,
  useRef,
  useEffect,
} from "react";
import {
  Input,
  Button,
  Upload,
  Image,
  Typography,
  message,
  Grid,
} from "antd";
import {
  SendOutlined,
  SmileOutlined,
  PictureOutlined,
  AudioOutlined,
  DeleteOutlined,
  CloseOutlined,
} from "@ant-design/icons";

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ★ กำหนดจำนวนรูปสูงสุดต่อหนึ่งข้อความ
const MAX_IMAGES = 4;

type Member = { id: string; name?: string };
type Chat = { id: string; members?: Member[] };
type Me = { id: string; name?: string } | null;

export default function SendMessageSection({
  chats,
  sel,
  text,
  setText,
  send,
  me,
  replyTarget,
  setReplyTarget,
}: {
  chats?: { myChats?: Chat[] };
  sel: string | null;
  text: string;
  setText: (s: string) => void;
  send: (args: {
    variables: {
      chat_id: string;
      text: string;
      to_user_ids: string[];
      images?: File[];
      audio?: File | null;
      audio_duration_sec?: number | null;
      reply_to_id?: string | null;
    };
  }) => Promise<any>;
  me: Me;
  replyTarget: any | null;
  setReplyTarget: (t: any | null) => void;
}) {
  const screens = useBreakpoint();
  const isMobile = !screens.md; // md ขึ้นไปถือว่า desktop

  const [showEmoji, setShowEmoji] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const textAreaRef = useRef<any>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);

  // หา chat ที่เลือก
  const chat = useMemo(
    () => chats?.myChats?.find((i) => i.id === sel),
    [chats, sel]
  );

  const otherMembers = useMemo(() => {
    if (!chat?.members) return [];
    return chat.members.filter((m) => m.id !== me?.id);
  }, [chat?.members, me?.id]);

  const toUserIds = useMemo(
    () => otherMembers.map((m) => m.id),
    [otherMembers]
  );

  const trimmed = text.trim();
  const canSend =
    !!me?.id &&
    !!sel &&
    !!chat &&
    (trimmed || uploadedImages.length > 0 || !!voiceFile) &&
    toUserIds.length > 0;

  const disabled = !me?.id || !chat || !sel;

  // ============= SEND MESSAGE ============
  const handleSend = useCallback(async () => {
    if (!canSend) return;
    console.log("[handleSend] = ", sel, toUserIds, replyTarget?.id);

    const nowIso = new Date().toISOString();
    const tempId = "temp-" + nowIso;

    try {
      await send({
        variables: {
          chat_id: sel!,
          text: trimmed,
          to_user_ids: toUserIds,
          images: uploadedImages,
          audio: voiceFile,
          audio_duration_sec: voiceDurationSec,
          reply_to_id: replyTarget?.id ?? null,
        },
        optimisticResponse: {
          sendMessage: {
            __typename: "Message",
            id: tempId,
            chat_id: sel!,
            text: trimmed,
            created_at: nowIso,
            reply_to_id: replyTarget?.id ?? null,
            reply_to: null,

            sender: {
              __typename: "User",
              id: me?.id,
              name: me?.name || "Me",
              avatar: null,
            },

            myReceipt: {
              __typename: "MessageReceipt",
              deliveredAt: nowIso,
              isRead: true,
              readAt: nowIso,
            },
            readers: [],
            readersCount: 0,
            deleted_at: null,
            is_deleted: false,

            images: uploadedImages.map((file, idx) => ({
              __typename: "ChatImage",
              id: `temp-img-${idx}`,
              url: URL.createObjectURL(file),
              file_id: null,
              mime: file.type,
            })),

            audio: voiceFile
              ? {
                  __typename: "MessageAudio",
                  file_id: `temp-audio-${nowIso}`,
                  url: voicePreviewUrl || "",
                  mime: voiceFile.type || null,
                  duration_sec: voiceDurationSec,
                }
              : null,
          },
        },
      } as any);

      setText("");
      setUploadedImages([]);
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
      setVoiceFile(null);
      setVoicePreviewUrl(null);
      setVoiceDurationSec(null);
      setReplyTarget(null);
    } catch (e) {
      console.error("[send] error:", e);
    }
  }, [
    canSend,
    sel,
    trimmed,
    uploadedImages,
    toUserIds,
    replyTarget,
    send,
    setText,
    setReplyTarget,
    me?.id,
    me?.name,
    voiceFile,
    voicePreviewUrl,
    voiceDurationSec,
  ]);

  const cleanupRecording = useCallback(() => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const stream = recordStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    recordStreamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    setRecordMs(0);
  }, []);

  const discardVoice = useCallback(() => {
    if (isRecording) {
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
      cleanupRecording();
    }
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    setVoiceFile(null);
    setVoicePreviewUrl(null);
    setVoiceDurationSec(null);
  }, [cleanupRecording, isRecording, voicePreviewUrl]);

  const toggleRecord = useCallback(async () => {
    if (disabled) return;

    // stop
    if (isRecording) {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        cleanupRecording();
      }
      return;
    }

    if (typeof window === "undefined") return;
    if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      message.error("Recording not supported in this browser.");
      return;
    }

    // start
    try {
      discardVoice();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;

      const pickRecorderMime = () => {
        const candidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/ogg",
          "audio/mp4",
        ];
        for (const c of candidates) {
          try {
            if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
              return c;
            }
          } catch {}
        }
        return "";
      };

      const preferredMime = pickRecorderMime();
      const mr = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: mr.mimeType || "audio/webm",
          });
          const effectiveMime = String(preferredMime || blob.type || mr.mimeType || "")
            .split(";")[0]
            .trim()
            .toLowerCase();

          const ext =
            effectiveMime === "audio/ogg"
              ? ".ogg"
              : effectiveMime === "audio/mp4"
              ? ".m4a"
              : ".webm";

          const filename = `voice-${Date.now()}${ext}`;
          const file = new File([blob], filename, {
            type: effectiveMime || blob.type || "audio/webm",
          });

          const url = URL.createObjectURL(blob);
          setVoiceFile(file);
          setVoicePreviewUrl(url);

          // Duration is best-effort.
          const audioEl = document.createElement("audio");
          audioEl.preload = "metadata";
          audioEl.src = url;
          await new Promise<void>((resolve) => {
            audioEl.onloadedmetadata = () => resolve();
            audioEl.onerror = () => resolve();
          });

          const d = Number(audioEl.duration);
          if (Number.isFinite(d) && d > 0) setVoiceDurationSec(Math.round(d));
          else setVoiceDurationSec(null);
        } finally {
          cleanupRecording();
        }
      };

      mr.start();
      setIsRecording(true);
      setRecordMs(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordMs((ms) => ms + 250);
      }, 250);
    } catch (e) {
      console.error("[voice] record start failed", e);
      cleanupRecording();
      message.error("Unable to start recording.");
    }
  }, [cleanupRecording, disabled, discardVoice, isRecording]);

  useEffect(() => {
    return () => {
      cleanupRecording();
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [cleanupRecording, voicePreviewUrl]);

  // Enter to send
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Emoji Picker
  const emojis = [
    "😀",
    "😁",
    "😂",
    "🤣",
    "😊",
    "😍",
    "😎",
    "🤔",
    "😢",
    "🙏",
    "👍",
    "🔥",
    "💯",
    "🎉",
    "✨",
    "❤️",
    "😡",
  ];

  const appendEmoji = (emoji: string) => {
    setText(text + emoji);
    textAreaRef.current?.focus?.();
  };

  // ปิด emoji dialog เมื่อคลิกนอกพื้นที่
  useEffect(() => {
    if (!showEmoji) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        emojiPickerRef.current &&
        target &&
        !emojiPickerRef.current.contains(target)
      ) {
        setShowEmoji(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showEmoji]);

  // ★ Image Upload — จำกัดสูงสุด 4 รูป
  const beforeUpload = (file: File) => {
    setUploadedImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        message.warning(`You can upload up to ${MAX_IMAGES} images per message.`);
        return prev;
      }

      const next = [...prev, file].slice(0, MAX_IMAGES);
      if (next.length >= MAX_IMAGES && prev.length < MAX_IMAGES) {
        message.warning(`You can upload up to ${MAX_IMAGES} images per message.`);
      }
      return next;
    });
    return false;
  };

  const removeImage = (file: File) => {
    setUploadedImages((prev) => prev.filter((f) => f !== file));
  };

  // =========== RENDER REPLY PREVIEW ==========
  const renderReplyPreview = () => {
    if (!replyTarget) return null;

    const isMine = replyTarget?.sender?.id === me?.id;
    const senderLabel = isMine ? "You" : replyTarget?.sender?.name || "User";

    const replyText: string =
      typeof replyTarget?.text === "string" ? replyTarget.text : "";

    const replyImages: any[] = Array.isArray(replyTarget?.images)
      ? replyTarget.images
      : [];

    const hasImages = replyImages.length > 0;

    const getSrc = (img: any) =>
      img?.file_id ? `/api/files/${img.file_id}` : img?.url || "";

    return (
      <div
        style={{
          marginBottom: 10,
          padding: isMobile ? "5px 8px" : "6px 10px",
          borderRadius: 10,
          background: "rgba(var(--app-primary-rgb),0.10)",
          borderLeft: "3px solid var(--app-primary)",
          fontSize: isMobile ? 11 : 12,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              marginBottom: 4,
              color: "var(--app-primary)",
            }}
          >
            Replying to {senderLabel}
          </div>

          {replyText && (
            <div
              style={{
                marginBottom: hasImages ? 4 : 0,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "rgba(var(--app-text-rgb),0.78)",
              }}
            >
              {replyText}
            </div>
          )}

          {hasImages && (
            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
              {replyImages.slice(0, 3).map((img: any, i: number) => {
                const extra = replyImages.length - 3;
                const isLast = i === 2 && extra > 0;

                return (
                  <div
                    key={i}
                    style={{
                      width: isMobile ? 40 : 45,
                      height: isMobile ? 40 : 45,
                      borderRadius: 6,
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <Image
                      src={getSrc(img)}
                      preview={false}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: isLast ? "brightness(0.6)" : "none",
                      }}
                    />

                    {isLast && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(var(--app-shadow-rgb),0.55)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        +{extra}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={() => setReplyTarget(null)}
          style={{ padding: 0, color: "var(--app-muted)" }}
          size={isMobile ? "small" : "middle"}
        />
      </div>
    );
  };

  // ======================== RENDER ========================
  return (
    <div
      style={{
        width: "100%",
        padding: isMobile ? 8 : 12,
        background: "var(--app-surface)",
        borderTop: "1px solid var(--app-border)",
        position: "relative",
      }}
    >
      {/* ===== Reply Preview ===== */}
      {renderReplyPreview()}

      {/* ===== IMAGE PREVIEW ===== */}
      {uploadedImages.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 6,
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
            {uploadedImages.map((img, index) => (
              <div
                key={index}
                style={{
                  position: "relative",
                  width: isMobile ? 70 : 80,
                  height: isMobile ? 70 : 80,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid var(--app-border)",
                  flexShrink: 0,
                }}
              >
                <Image
                  src={URL.createObjectURL(img)}
                  alt="preview"
                  width={isMobile ? 70 : 80}
                  height={isMobile ? 70 : 80}
                  style={{ objectFit: "cover" }}
                  preview={false}
                />

                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined style={{ color: "#fff" }} />}
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    background: "rgba(var(--app-shadow-rgb),0.55)",
                    borderRadius: 0,
                  }}
                  onClick={() => removeImage(img)}
                />
              </div>
            ))}
          </div>
          <Text
            type="secondary"
            style={{
              fontSize: 12,
              marginBottom: 6,
              display: "block",
            }}
          >
            {uploadedImages.length}/{MAX_IMAGES} images
          </Text>
        </>
      )}

      {/* ===== VOICE PREVIEW ===== */}
      {!!voicePreviewUrl && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 12,
            background: "rgba(var(--app-text-rgb),0.06)",
            border: "1px solid rgba(var(--app-text-rgb),0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <Text type="secondary">Voice message</Text>
            <Button
              type="text"
              size={isMobile ? "small" : "middle"}
              icon={<CloseOutlined />}
              onClick={discardVoice}
              style={{ padding: 0, color: "var(--app-muted)" }}
            />
          </div>

          <audio
            controls
            preload="metadata"
            src={voicePreviewUrl}
            style={{ width: "100%" }}
          />

          {typeof voiceDurationSec === "number" ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "var(--app-muted)",
              }}
            >
              Duration: {Math.floor(voiceDurationSec / 60)
                .toString()
                .padStart(2, "0")}:{Math.floor(voiceDurationSec % 60)
                .toString()
                .padStart(2, "0")}
            </div>
          ) : null}
        </div>
      )}

      {/* ===== INPUT BAR ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--app-surface)",
          borderRadius: 24,
          padding: isMobile ? "4px 8px" : "6px 12px",
          border: "1px solid var(--app-border)",
          boxShadow: "0 1px 4px rgba(var(--app-shadow-rgb),0.10)",
          gap: isMobile ? 6 : 10,
        }}
      >
        {/* Upload */}
        <Upload
          beforeUpload={beforeUpload}
          multiple
          showUploadList={false}
          accept="image/*"
          disabled={disabled || uploadedImages.length >= MAX_IMAGES}
        >
          <Button
            type="text"
            icon={
              <PictureOutlined
                style={{ fontSize: isMobile ? 18 : 20, color: "var(--app-muted)" }}
              />
            }
            style={{ border: "none" }}
            size={isMobile ? "small" : "middle"}
          />
        </Upload>

        {/* Emoji */}
        <Button
          type="text"
          icon={
            <SmileOutlined
              style={{ fontSize: isMobile ? 18 : 20, color: "var(--app-muted)" }}
            />
          }
          onClick={() => setShowEmoji((s) => !s)}
          disabled={disabled}
          style={{ border: "none" }}
          size={isMobile ? "small" : "middle"}
        />

        {/* Voice record */}
        <Button
          type="text"
          icon={
            <AudioOutlined
              style={{
                fontSize: isMobile ? 18 : 20,
                color: isRecording ? "var(--text-danger)" : "var(--app-muted)",
              }}
            />
          }
          onClick={() => void toggleRecord()}
          disabled={disabled}
          style={{ border: "none" }}
          size={isMobile ? "small" : "middle"}
          title={isRecording ? "Stop recording" : "Record voice"}
        />

        {/* Text Area */}
        <Input.TextArea
          ref={textAreaRef}
          autoSize={{ minRows: 1, maxRows: isMobile ? 3 : 4 }}
          placeholder="Type a message..."
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            border: "none",
            boxShadow: "none",
            resize: "none",
            fontSize: isMobile ? 14 : 16,
            lineHeight: "20px",
            paddingTop: isMobile ? 4 : 8,
            flex: 1,
            background: "transparent",
            color: "var(--app-text)",
          }}
        />

        {/* SEND */}
        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined />}
          disabled={!canSend || isRecording}
          onClick={handleSend}
          size={isMobile ? "middle" : "large"}
          style={{
            width: isMobile ? 36 : 42,
            height: isMobile ? 36 : 42,
            fontSize: isMobile ? 16 : 18,
            boxShadow: canSend
              ? "0 4px 10px rgba(var(--app-shadow-rgb),0.18)"
              : "none",
            flexShrink: 0,
          }}
        />
      </div>

      {isRecording && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--app-muted)" }}>
          Recording… {Math.floor(recordMs / 1000)}s
        </div>
      )}

      {/* ===== EMOJI PICKER ===== */}
      {showEmoji && !disabled && (
        <div
          ref={emojiPickerRef}
          style={{
            position: "absolute",
            bottom: isMobile ? 60 : 70,
            left: isMobile ? 8 : 20,
            background: "rgba(var(--app-surface-rgb),0.98)",
            border: "1px solid var(--app-border)",
            borderRadius: 12,
            padding: 10,
            boxShadow: "0 4px 14px rgba(var(--app-shadow-rgb),0.18)",
            display: "grid",
            gridTemplateColumns: `repeat(${isMobile ? 6 : 8}, 1fr)`,
            gap: 6,
            zIndex: 20,
            maxWidth: isMobile ? 260 : 300,
          }}
        >
          {emojis.map((em) => (
            <button
              key={em}
              onClick={() => appendEmoji(em)}
              style={{
                fontSize: isMobile ? 20 : 22,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
              }}
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
