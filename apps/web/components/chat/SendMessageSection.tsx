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
  Modal,
  List,
  Spin,
  Typography,
  message,
  Grid,
} from "antd";
import {
  SendOutlined,
  SmileOutlined,
  PictureOutlined,
  AudioOutlined,
  EnvironmentOutlined,
  AimOutlined,
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

type MessageLocationInput = {
  latitude: number;
  longitude: number;
  placeName?: string | null;
  googleMapsUrl?: string | null;
};

type PlaceSearchResult = {
  placeName: string;
  latitude: number;
  longitude: number;
};

const DEFAULT_MAP_CENTER = { latitude: 13.7563, longitude: 100.5018, zoom: 14 }; // Bangkok

declare global {
  interface Window {
    L?: any;
  }
}

function buildGoogleMapsUrl(latitude: number, longitude: number) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `https://maps.google.com/?q=${lat},${lng}`;
}

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
      location?: MessageLocationInput | null;
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

  const [locationOpen, setLocationOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<PlaceSearchResult[]>([]);
  const [showLocationResults, setShowLocationResults] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pickedLat, setPickedLat] = useState<number>(DEFAULT_MAP_CENTER.latitude);
  const [pickedLng, setPickedLng] = useState<number>(DEFAULT_MAP_CENTER.longitude);
  const [pickedPlaceName, setPickedPlaceName] = useState<string>("");
  const [reverseBusy, setReverseBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationGeoBusy, setLocationGeoBusy] = useState(false);
  const [locationErr, setLocationErr] = useState<string>("");
  const locationReqIdRef = useRef(0);
  const reverseReqIdRef = useRef(0);
  const suppressNextSearchRef = useRef(false);

  const leafletLoadRef = useRef<Promise<any> | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any | null>(null);
  const programmaticMoveRef = useRef(false);

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

  const ensureLeafletLoaded = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (window.L) return window.L;

    if (!leafletLoadRef.current) {
      leafletLoadRef.current = new Promise((resolve, reject) => {
        try {
          const existingCss = document.querySelector('link[data-leaflet="1"]');
          if (!existingCss) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            link.setAttribute("data-leaflet", "1");
            document.head.appendChild(link);
          }

          const existing = document.querySelector('script[data-leaflet="1"]');
          if (existing) {
            const done = () => {
              if (window.L) resolve(window.L);
              else reject(new Error("Leaflet failed to load"));
            };
            if ((existing as any).dataset.loaded === "1") done();
            else {
              existing.addEventListener("load", done);
              existing.addEventListener("error", () => reject(new Error("Leaflet failed")));
            }
            return;
          }

          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.async = true;
          script.defer = true;
          script.setAttribute("data-leaflet", "1");
          script.onload = () => {
            (script as any).dataset.loaded = "1";
            if (window.L) resolve(window.L);
            else reject(new Error("Leaflet failed to load"));
          };
          script.onerror = () => reject(new Error("Leaflet failed to load"));
          document.body.appendChild(script);
        } catch (e) {
          reject(e);
        }
      });
    }

    return leafletLoadRef.current;
  }, []);

  const cleanupLeafletMap = useCallback(() => {
    try {
      leafletMapRef.current?.off?.();
      leafletMapRef.current?.remove?.();
    } catch {
      // ignore
    }
    leafletMapRef.current = null;
    setMapReady(false);
  }, []);

  const closeLocationModal = useCallback(() => {
    setLocationOpen(false);
    setLocationQuery("");
    setLocationResults([]);
    setShowLocationResults(false);
    setLocationErr("");
    setPickedLat(DEFAULT_MAP_CENTER.latitude);
    setPickedLng(DEFAULT_MAP_CENTER.longitude);
    setPickedPlaceName("");
  }, []);

  const openLocationModal = useCallback(() => {
    if (disabled) return;
    setShowEmoji(false);
    setLocationOpen(true);
    setLocationQuery("");
    setLocationResults([]);
    setShowLocationResults(true);
    setLocationErr("");
    setPickedLat(DEFAULT_MAP_CENTER.latitude);
    setPickedLng(DEFAULT_MAP_CENTER.longitude);
    setPickedPlaceName("");
  }, [disabled]);

  const setMapView = useCallback((latitude: number, longitude: number, zoom?: number) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setPickedLat(lat);
    setPickedLng(lng);

    const map = leafletMapRef.current;
    if (map && typeof map.setView === "function") {
      try {
        programmaticMoveRef.current = true;
        const z = typeof zoom === "number" && Number.isFinite(zoom) ? zoom : map.getZoom?.();
        map.setView([lat, lng], z, { animate: true });
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!locationOpen) return;
    let cancelled = false;

    const init = async () => {
      try {
        const L = await ensureLeafletLoaded();
        if (cancelled) return;
        if (!L) return;
        const el = mapDivRef.current;
        if (!el) return;

        // Re-init if needed.
        if (leafletMapRef.current) {
          setMapReady(true);
          return;
        }

        const map = L.map(el, {
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: true,
          doubleClickZoom: true,
          dragging: true,
          touchZoom: true,
        }).setView([pickedLat, pickedLng], DEFAULT_MAP_CENTER.zoom);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(map);

        const onMove = () => {
          try {
            const c = map.getCenter();
            const lat = Number(c?.lat);
            const lng = Number(c?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            setPickedLat(lat);
            setPickedLng(lng);
            if (programmaticMoveRef.current) {
              programmaticMoveRef.current = false;
            } else {
              setPickedPlaceName("");
            }
            setLocationErr("");
          } catch {
            // ignore
          }
        };

        map.on("moveend", onMove);
        map.on("zoomend", onMove);

        leafletMapRef.current = map;
        setMapReady(true);

        // Force correct sizing when opening inside modal.
        setTimeout(() => {
          try {
            map.invalidateSize();
          } catch {
            // ignore
          }
        }, 80);
      } catch {
        if (!cancelled) setLocationErr("Map failed to load");
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [ensureLeafletLoaded, locationOpen, pickedLat, pickedLng]);

  useEffect(() => {
    if (!locationOpen) return;
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }
    const q = locationQuery.trim();
    if (q.length < 3) {
      setLocationResults([]);
      setLocationErr("");
      return;
    }

    const reqId = (locationReqIdRef.current += 1);
    let cancelled = false;

    const tick = window.setTimeout(async () => {
      try {
        setLocationErr("");
        const resp = await fetch("/api/geocode/search?q=" + encodeURIComponent(q));
        const json = (await resp.json()) as any;
        const resultsRaw = Array.isArray(json?.results) ? json.results : [];

        const mapped: PlaceSearchResult[] = resultsRaw
          .map((r: any) => {
            const placeName = String(r?.placeName ?? "").trim();
            const latitude = Number(r?.latitude);
            const longitude = Number(r?.longitude);
            if (!placeName) return null;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
            return { placeName, latitude, longitude } satisfies PlaceSearchResult;
          })
          .filter((v: any): v is PlaceSearchResult => !!v);

        if (!cancelled && reqId === locationReqIdRef.current) {
          setLocationResults(mapped);
        }
      } catch {
        if (!cancelled && reqId === locationReqIdRef.current) {
          setLocationErr("Search failed");
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(tick);
    };
  }, [locationOpen, locationQuery]);

  useEffect(() => {
    if (!locationOpen) return;
    const lat = Number(pickedLat);
    const lng = Number(pickedLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const reqId = (reverseReqIdRef.current += 1);
    setReverseBusy(true);

    let cancelled = false;
    const tick = window.setTimeout(async () => {
      try {
        const resp = await fetch(
          "/api/geocode/reverse?lat=" +
            encodeURIComponent(String(lat)) +
            "&lng=" +
            encodeURIComponent(String(lng))
        );
        const json = (await resp.json()) as any;
        const placeName = String(json?.placeName ?? "").trim();
        if (!cancelled && reqId === reverseReqIdRef.current) {
          setPickedPlaceName(placeName);
          setReverseBusy(false);
        }
      } catch {
        if (!cancelled && reqId === reverseReqIdRef.current) {
          setReverseBusy(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(tick);
    };
  }, [locationOpen, pickedLat, pickedLng]);

  const useCurrentLocation = useCallback(async () => {
    if (locationGeoBusy || disabled) return;
    if (typeof window === "undefined") return;
    if (!navigator?.geolocation) {
      message.error("Geolocation is not supported in this browser.");
      return;
    }

    setLocationGeoBusy(true);
    setLocationErr("");

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });

      const latitude = Number(pos?.coords?.latitude);
      const longitude = Number(pos?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        message.error("Current location unavailable.");
        return;
      }

      let placeName = "";
      try {
        const resp = await fetch(
          "/api/geocode/reverse?lat=" +
            encodeURIComponent(String(latitude)) +
            "&lng=" +
            encodeURIComponent(String(longitude))
        );
        const json = (await resp.json()) as any;
        placeName = String(json?.placeName ?? "").trim();
      } catch {
        // ignore
      }

      const selected: PlaceSearchResult = {
        placeName: placeName || "Current location",
        latitude,
        longitude,
      };
      setPickedPlaceName(selected.placeName);
      suppressNextSearchRef.current = true;
      setLocationQuery(placeName || "");
      setShowLocationResults(false);
      setLocationResults([]);
      setMapView(latitude, longitude, 16);
    } catch (e: any) {
      const code = Number(e?.code);
      if (code === 1) message.error("Location permission denied.");
      else message.error("Unable to get current location.");
    } finally {
      setLocationGeoBusy(false);
    }
  }, [disabled, locationGeoBusy, setMapView]);

  const sendPickedLocation = useCallback(async () => {
    if (!sel || disabled) return;
    if (locationBusy) return;

    const latitude = Number(pickedLat);
    const longitude = Number(pickedLng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      message.error("Invalid location.");
      return;
    }

    const placeName = String(pickedPlaceName ?? "").trim() || null;
    const googleMapsUrl = buildGoogleMapsUrl(latitude, longitude);

    const nowIso = new Date().toISOString();
    const tempId = "temp-loc-" + nowIso;

    setLocationBusy(true);
    try {
      await send({
        variables: {
          chat_id: sel,
          text: "",
          to_user_ids: toUserIds,
          images: [],
          audio: null,
          audio_duration_sec: null,
          location: {
            latitude,
            longitude,
            placeName,
            googleMapsUrl,
          },
          reply_to_id: replyTarget?.id ?? null,
        },
        optimisticResponse: {
          sendMessage: {
            __typename: "Message",
            id: tempId,
            chat_id: sel,
            text: "",
            type: "LOCATION",
            location: {
              __typename: "MessageLocation",
              latitude,
              longitude,
              placeName,
              googleMapsUrl,
            },
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
            images: [],
            audio: null,
          },
        },
      } as any);

      closeLocationModal();
      setReplyTarget(null);
    } catch (e) {
      console.error("[send location] error:", e);
      message.error("Send failed.");
    } finally {
      setLocationBusy(false);
    }
  }, [closeLocationModal, disabled, locationBusy, me?.id, me?.name, pickedLat, pickedLng, pickedPlaceName, replyTarget?.id, sel, send, setReplyTarget, toUserIds]);

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
            type: voiceFile ? "AUDIO" : uploadedImages.length && !trimmed ? "IMAGE" : "TEXT",
            text: trimmed,
            location: null,
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

    const replyLoc = replyTarget?.location;
    const replyLocLat = Number(replyLoc?.latitude);
    const replyLocLng = Number(replyLoc?.longitude);
    const replyLocName = String(replyLoc?.placeName ?? "").trim();
    const replyLocLabel =
      replyLocName ||
      (Number.isFinite(replyLocLat) && Number.isFinite(replyLocLng)
        ? `📍 ${replyLocLat.toFixed(5)}, ${replyLocLng.toFixed(5)}`
        : "");

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

          {(replyText || replyLocLabel) && (
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
              {replyText || replyLocLabel}
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

        {/* Share location */}
        <Button
          type="text"
          icon={
            <EnvironmentOutlined
              style={{ fontSize: isMobile ? 18 : 20, color: "var(--app-muted)" }}
            />
          }
          onClick={openLocationModal}
          disabled={disabled || isRecording}
          style={{ border: "none" }}
          size={isMobile ? "small" : "middle"}
          title="Share location"
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

      {/* ===== LOCATION PICKER (Phase 1) ===== */}
      <Modal
        open={locationOpen}
        onCancel={closeLocationModal}
        afterClose={cleanupLeafletMap}
        title="Share location"
        footer={null}
        width={isMobile ? "100%" : 560}
        style={isMobile ? { top: 0, paddingBottom: 0 } : undefined}
        bodyStyle={
          isMobile
            ? { height: "calc(100vh - 110px)", overflow: "hidden" }
            : { height: 560, overflow: "hidden" }
        }
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            height: "100%",
          }}
        >
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Input
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Search a place"
              allowClear
              autoFocus
              onFocus={() => setShowLocationResults(true)}
            />
            <Button
              icon={<AimOutlined />}
              onClick={() => void useCurrentLocation()}
              disabled={locationGeoBusy}
            >
              {locationGeoBusy ? "Locating…" : "Use current"}
            </Button>
          </div>

          {locationErr ? (
            <div style={{ color: "var(--text-danger)", fontSize: 12 }}>{locationErr}</div>
          ) : null}

          {showLocationResults && locationQuery.trim().length >= 3 ? (
            <div
              style={{
                maxHeight: 220,
                overflow: "auto",
                border: "1px solid var(--app-border)",
                borderRadius: 12,
              }}
            >
              {!locationResults.length && !locationErr ? (
                <div style={{ padding: 10, fontSize: 12, color: "var(--app-muted)" }}>No results</div>
              ) : null}

              <List
                size="small"
                dataSource={locationResults}
                renderItem={(r) => (
                  <List.Item
                    style={{ cursor: "pointer", paddingLeft: 10, paddingRight: 10 }}
                    onClick={() => {
                      setShowLocationResults(false);
                      setLocationResults([]);
                      suppressNextSearchRef.current = true;
                      setLocationQuery(r.placeName);
                      setPickedPlaceName(r.placeName);
                      setMapView(r.latitude, r.longitude, 16);
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.placeName}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--app-muted)" }}>
                        {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          ) : locationQuery.trim().length < 3 ? (
            <div style={{ fontSize: 12, color: "var(--app-muted)", flexShrink: 0 }}>
              Type at least 3 characters to search.
            </div>
          ) : null}

          <div style={{ position: "relative", flex: 1, minHeight: isMobile ? 260 : 320 }}>
            <div
              ref={mapDivRef}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid var(--app-border)",
                background: "rgba(var(--app-text-rgb),0.04)",
                touchAction: "none",
              }}
              onMouseDown={() => setShowLocationResults(false)}
              onTouchStart={() => setShowLocationResults(false)}
            />

            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -100%)",
                pointerEvents: "none",
                fontSize: 32,
                lineHeight: 1,
                filter: "drop-shadow(0 6px 10px rgba(var(--app-shadow-rgb),0.20))",
              }}
            >
              📍
            </div>

            {!mapReady ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(var(--app-surface-rgb),0.80)",
                  borderRadius: 12,
                }}
              >
                <Spin />
              </div>
            ) : null}
          </div>

          <div
            style={{
              flexShrink: 0,
              padding: 10,
              borderRadius: 12,
              border: "1px solid var(--app-border)",
              background: "rgba(var(--app-text-rgb),0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {pickedPlaceName || (reverseBusy ? "Looking up place…" : "Dropped pin")}
                </div>
                <div style={{ fontSize: 12, color: "var(--app-muted)" }}>
                  {Number(pickedLat).toFixed(5)}, {Number(pickedLng).toFixed(5)}
                </div>
                <a
                  href={buildGoogleMapsUrl(pickedLat, pickedLng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12 }}
                >
                  Open in Google Maps
                </a>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button onClick={closeLocationModal}>Cancel</Button>
                <Button type="primary" onClick={() => void sendPickedLocation()} disabled={locationBusy || !mapReady}>
                  {locationBusy ? <Spin size="small" /> : "Share"}
                </Button>
              </div>
            </div>
          </div>

        </div>
      </Modal>
    </div>
  );
}
