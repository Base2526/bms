'use client';
import { gql, useApolloClient, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  List,
  Row,
  Space,
  Tag,
  Typography,
  message,
  Popconfirm,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CopyOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  ReadOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  buildCustomerConfirmationLinesFromAnswers,
  formatCustomerConfirmationClipboardText,
  getCompletenessTagMeta,
  getCustomerConfirmationTagMeta,
} from "@/lib/bms/pharmacy/customerConfirmation";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph, Title } = Typography;

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const CHAT_STORAGE_KEY = "bms-pharmacy-intake-lab-chat-v1";

// ---- วันที่ — ยืมธรรมเนียมเดิมจาก Inbox/Assistant มาตรงๆ (app/(admin)/admin/assistant/page.tsx)
// เพื่อให้ label "วันนี้/เมื่อวาน/วันที่" ตรงกันทั้งระบบ (Asia/Bangkok ทุกเครื่อง ไม่ขึ้นกับ timezone browser)
// จำเป็นที่นี่เพราะแชทเก็บถาวรใน localStorage แล้ว เปิดมาอีกวันจะเห็นข้อความคนละวันปนกันถ้าไม่มีตัวแบ่ง
const BKK = "Asia/Bangkok";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
function dayLabel(iso: string, t: TFn) {
  const key = dayKey(iso);
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === todayKey) return t("admin_pharmacy_intake_lab.day_today");
  if (key === dayKey(y.toISOString())) return t("admin_pharmacy_intake_lab.day_yesterday");
  return new Intl.DateTimeFormat("th-TH", { timeZone: BKK, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

const M_PHARMACY_TEST = gql`
  mutation BmsPharmacyAssistantTest($message: String!, $session: BmsPharmacyAssistantSessionInput) {
    bmsPharmacyAssistantTest(message: $message, session: $session) {
      reply
      session
    }
  }
`;
const M_SEED_PHARMACY_QUEUE = gql`
  mutation BmsSeedPharmacyQueueDemo($protocolKey: String, $answers: JSON, $transcript: JSON) {
    bmsSeedPharmacyQueueDemo(protocolKey: $protocolKey, answers: $answers, transcript: $transcript) {
      createdCount
      assessmentId
      assessmentIds
    }
  }
`;
const M_START_REVIEW = gql`
  mutation BmsStartPharmacistReview($id: ID!) {
    bmsStartPharmacistReview(assessmentId: $id) { id status version }
  }
`;
const M_SUGGEST_MEDICATION = gql`
  mutation BmsGenerateMedicationSuggestions($id: ID!) {
    bmsGenerateMedicationSuggestions(assessmentId: $id) { id medicationSuggestions }
  }
`;
const M_CREATE_PHARMACY_LAB_ORDER = gql`
  mutation BmsCreatePharmacyLabOrder($items: [BmsPharmacyLabCartItemInput!]!) {
    bmsCreatePharmacyLabOrder(items: $items) {
      status
      orderId
      total
      message
    }
  }
`;
const Q_ME = gql`
  query {
    bmsMe {
      id
      tenant { id }
    }
  }
`;
const Q_STORE_PROFILE = gql`
  query {
    bmsStoreProfile {
      businessArchetype
    }
  }
`;
const Q_PHARMACY_PROTOCOL_STARTERS = gql`
  query BmsPharmacyProtocolStarters {
    bmsPharmacyProtocols {
      id protocolKey displayLabel status clinicallyApproved enabled platformAllowed
    }
  }
`;

type PharmacySession = {
  protocolKey?: string;
  phase?: string;
  protocolId?: string;
  answers?: Record<string, string | number>;
  currentQuestionKey?: string | null;
  currentFieldKey?: string | null;
};

type Bubble = {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  error?: boolean;
  retryText?: string;
};

type QuickReply = { label: string; value: string };

type ProductCartItem = {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  salePolicy: string;
  size?: string;
};

const PRODUCT_SESSION_KEYS = {
  sku: "__product_sku",
  salePolicy: "__product_sale_policy",
  cart: "__product_cart",
  options: "__product_options",
  sizeOptions: "__product_size_options",
} as const;

function hasSessionProductCart(session: PharmacySession | null): boolean {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.cart];
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function getSessionProductSalePolicy(session: PharmacySession | null): string | null {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.salePolicy];
  return typeof value === "string" ? value : null;
}

function getSessionProductSku(session: PharmacySession | null): string | null {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.sku];
  return typeof value === "string" ? value : null;
}

function parseSessionProductCart(session: PharmacySession | null): ProductCartItem[] {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.cart];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSessionProductOptions(session: PharmacySession | null): Array<{ sku: string; name: string }> {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.options];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSessionProductSizeOptions(session: PharmacySession | null): Array<{ size: string; available: number }> {
  const value = session?.answers?.[PRODUCT_SESSION_KEYS.sizeOptions];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ⚠️ `label` = ข้อความบนปุ่ม (แปลได้) แต่ `value` = ข้อความที่ถูกส่งเข้า pharmacy assistant แทน
// ข้อความของ "ลูกค้า" จริง ซึ่ง backend จับคู่ด้วย pattern ภาษาไทย — ต้องคงเป็นภาษาไทยทุกตัว
// ห้ามแปล ไม่ว่า UI ของแอดมินจะตั้งเป็นภาษาอะไร
function getPharmacyQuickReplies(session: PharmacySession | null, t: TFn): QuickReply[] {
  if (!session) return [];
  if (session.phase === "AWAITING_INTENT_CLARIFICATION") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_have_product"), value: "มีชื่อสินค้าที่ต้องการซื้อแล้วค่ะ" },
      { label: t("admin_pharmacy_intake_lab.qr_pharmacist_assess"), value: "ให้เภสัชกรช่วยประเมินอาการค่ะ" },
      { label: t("admin_pharmacy_intake_lab.qr_no_cancel"), value: "ไม่ใช่ค่ะ" },
    ];
  }
  if (session.phase === "AWAITING_CONSENT") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_consent"), value: "ยินยอม" },
      { label: t("admin_pharmacy_intake_lab.qr_no_consent"), value: "ไม่ยินยอม" },
    ];
  }
  if (session.phase === "PENDING_CONFIRMATION") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_info_correct"), value: "ข้อมูลถูกต้อง" },
      { label: t("admin_pharmacy_intake_lab.qr_confirm"), value: "ยืนยัน" },
      { label: t("admin_pharmacy_intake_lab.qr_request_edit"), value: "ขอแก้ไข" },
    ];
  }
  if (session.phase === "PRODUCT_PURCHASE") {
    const sizeOptions = parseSessionProductSizeOptions(session);
    if (sizeOptions.length > 1) {
      return sizeOptions.slice(0, 5).map((item, index) => ({
        label: `${index + 1}`,
        value: `${index + 1}`,
      }));
    }
  }
  if (
    session.phase === "PRODUCT_PURCHASE" &&
    hasSessionProductCart(session)
  ) {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_add_product"), value: "เพิ่มสินค้า" },
      { label: t("admin_pharmacy_intake_lab.qr_view_cart"), value: "ดูตะกร้า" },
      { label: t("admin_pharmacy_intake_lab.qr_confirm_cart"), value: "ยืนยันตะกร้า" },
      { label: t("admin_pharmacy_intake_lab.qr_remove_last"), value: "ลบรายการล่าสุด" },
      { label: t("admin_pharmacy_intake_lab.qr_clear_cart"), value: "ล้างตะกร้า" },
    ];
  }
  if (session.phase === "PRODUCT_PURCHASE") {
    const options = parseSessionProductOptions(session);
    if (options.length > 1) {
      return options.slice(0, 5).map((item, index) => ({
        label: `${index + 1}`,
        value: `${index + 1}`,
      }));
    }
  }

  const fieldKey = session.currentFieldKey ?? session.currentQuestionKey ?? "";
  if (["has_fever", "hydration_status", "blood_in_sputum", "blood_in_stool", "neck_stiffness", "worst_ever", "neuro_symptoms", "recent_head_injury", "breathing_difficulty", "chest_pain", "high_fever", "pregnancy_status", "breastfeeding_status"].includes(fieldKey)) {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_yes"), value: "มี" },
      { label: t("admin_pharmacy_intake_lab.qr_no"), value: "ไม่มี" },
    ];
  }
  if (fieldKey === "severity") {
    return [{ label: "3", value: "3" }, { label: "5", value: "5" }, { label: "7", value: "7" }];
  }
  if (fieldKey === "duration_days") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_days", { n: 1 }), value: "1 วัน" },
      { label: t("admin_pharmacy_intake_lab.qr_days", { n: 3 }), value: "3 วัน" },
      { label: t("admin_pharmacy_intake_lab.qr_days", { n: 7 }), value: "7 วัน" },
    ];
  }
  if (fieldKey === "duration_hours") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_hours", { n: 6 }), value: "6 ชั่วโมง" },
      { label: t("admin_pharmacy_intake_lab.qr_hours", { n: 12 }), value: "12 ชั่วโมง" },
      { label: t("admin_pharmacy_intake_lab.qr_days", { n: 1 }), value: "24 ชั่วโมง" },
    ];
  }
  if (fieldKey === "frequency_per_day") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_times", { n: 1 }), value: "1" },
      { label: t("admin_pharmacy_intake_lab.qr_times", { n: 3 }), value: "3" },
      { label: t("admin_pharmacy_intake_lab.qr_times", { n: 5 }), value: "5" },
    ];
  }
  if (fieldKey === "patient_age_years") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_years", { n: 1 }), value: "1" },
      { label: t("admin_pharmacy_intake_lab.qr_years", { n: 6 }), value: "6" },
      { label: t("admin_pharmacy_intake_lab.qr_years", { n: 18 }), value: "18" },
    ];
  }
  if (fieldKey === "biological_sex") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_female"), value: "หญิง" },
      { label: t("admin_pharmacy_intake_lab.qr_male"), value: "ชาย" },
    ];
  }
  if (fieldKey === "patient_relationship") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_self"), value: "ตัวเอง" },
      { label: t("admin_pharmacy_intake_lab.qr_child"), value: "ลูก" },
      { label: t("admin_pharmacy_intake_lab.qr_parent"), value: "พ่อแม่" },
      { label: t("admin_pharmacy_intake_lab.qr_other_person"), value: "บุคคลอื่น" },
    ];
  }
  if (fieldKey === "sputum") {
    return [
      { label: t("admin_pharmacy_intake_lab.qr_no_sputum"), value: "ไม่มีเสมหะ" },
      { label: t("admin_pharmacy_intake_lab.qr_clear_sputum"), value: "เสมหะใส" },
      { label: t("admin_pharmacy_intake_lab.qr_yellow_sputum"), value: "เสมหะเหลือง" },
    ];
  }
  if (fieldKey === "allergies") return [{ label: t("admin_pharmacy_intake_lab.qr_no_allergy"), value: "ไม่เคยแพ้ยา" }];
  if (fieldKey === "current_medications") return [{ label: t("admin_pharmacy_intake_lab.qr_no_medication"), value: "ไม่ได้ใช้ยาอยู่" }];
  return [];
}

export default function PharmacyIntakeLabPage() {
  const { t } = useI18n();
  const client = useApolloClient();
  const router = useRouter();
  const { data: meData } = useQuery(Q_ME, { fetchPolicy: "cache-first" });
  const { data: storeProfileData, loading: storeProfileLoading } = useQuery(Q_STORE_PROFILE, { fetchPolicy: "cache-first" });
  const { data: protocolData } = useQuery(Q_PHARMACY_PROTOCOL_STARTERS, { fetchPolicy: "cache-and-network" });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [seedingQueue, setSeedingQueue] = useState(false);
  const [lastSeededAssessmentId, setLastSeededAssessmentId] = useState<string | null>(null);
  const [lastCreatedOrderId, setLastCreatedOrderId] = useState<string | null>(null);
  const [autoQueueStatus, setAutoQueueStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [showArchetypeNotice, setShowArchetypeNotice] = useState(true);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [session, setSession] = useState<PharmacySession | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const storageKey = [CHAT_STORAGE_KEY, meData?.bmsMe?.tenant?.id || "no-tenant", meData?.bmsMe?.id || "no-user"].join(":");
  const isPharmacyShop = storeProfileData?.bmsStoreProfile?.businessArchetype === "pharmacy";
  const starters: QuickReply[] = [
    // value = ข้อความที่ส่งเข้า assistant แทนลูกค้า (backend จับคู่ภาษาไทย) — ห้ามแปล
    { label: t("admin_pharmacy_intake_lab.starter_buy"), value: "ซื้อสินค้า" },
    ...(protocolData?.bmsPharmacyProtocols || [])
    .filter((protocol: any) => protocol.enabled && protocol.clinicallyApproved && protocol.platformAllowed && protocol.status === "APPROVED")
    .map((protocol: any) => ({ label: protocol.displayLabel, value: protocol.displayLabel })),
  ];
  const starterExample = starters.map((item) => item.label).slice(0, 4).join(", ");
  const summaryRows = buildCustomerConfirmationLinesFromAnswers(session?.answers);
  const completenessMeta = getCompletenessTagMeta(
    session?.phase === "PENDING_CONFIRMATION" || session?.phase === "WAITING"
      ? "COMPLETE"
      : session?.phase === "ASKING"
        ? "INCOMPLETE"
        : null
  );
  const confirmationMeta = getCustomerConfirmationTagMeta(
    session?.phase === "PENDING_CONFIRMATION"
      ? "PENDING"
      : session?.phase === "WAITING"
        ? "CONFIRMED"
        : null
  );

  useEffect(() => {
    if (storeProfileLoading) return;
    if (storeProfileData?.bmsStoreProfile?.businessArchetype && !isPharmacyShop) {
      const timer = window.setTimeout(() => router.replace("/admin/assistant"), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [isPharmacyShop, router, storeProfileData, storeProfileLoading]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setChat(parsed.chat || []);
        setSession(parsed.session || null);
      }
    } catch {
    } finally {
      setChatLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!chatLoaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ chat, session }));
    } catch {
    }
  }, [chat, session, chatLoaded, storageKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  const clearLab = () => {
    setChat([]);
    setSession(null);
    setText("");
    setLastSeededAssessmentId(null);
    setLastCreatedOrderId(null);
    setAutoQueueStatus("idle");
    try {
      localStorage.removeItem(storageKey);
    } catch {
    }
  };

  const createQueueCase = async (
    nextSession: PharmacySession | null | undefined,
    transcript: Array<{ role: "user" | "assistant"; text: string; createdAt: string }>
  ): Promise<string | null> => {
    if (!nextSession?.protocolKey || !nextSession?.answers) {
      return null;
    }
    setAutoQueueStatus("running");
    setSeedingQueue(true);
    try {
      const { data } = await client.mutate({
        mutation: M_SEED_PHARMACY_QUEUE,
        variables: {
          protocolKey: nextSession.protocolKey ?? null,
          answers: nextSession.answers ?? null,
          transcript,
        },
      });
      const result = data?.bmsSeedPharmacyQueueDemo;
      const assessmentId = result?.assessmentId as string | null | undefined;
      if (!result?.createdCount || !assessmentId) throw new Error("seed failed");

      setLastSeededAssessmentId(assessmentId);

      try {
        await client.mutate({ mutation: M_START_REVIEW, variables: { id: assessmentId } });
      } catch (e: any) {
        message.warning(e?.message || t("admin_pharmacy_intake_lab.warn_review_auto"));
      }

      try {
        await client.mutate({ mutation: M_SUGGEST_MEDICATION, variables: { id: assessmentId } });
      } catch (e: any) {
        message.warning(e?.message || t("admin_pharmacy_intake_lab.warn_medication_auto"));
      }

      setAutoQueueStatus("done");
      message.success(t("admin_pharmacy_intake_lab.queue_sent", { id: assessmentId }));
      return assessmentId;
    } catch (e: any) {
      setAutoQueueStatus("error");
      message.error(e?.message || t("admin_pharmacy_intake_lab.queue_failed"));
      return null;
    } finally {
      setSeedingQueue(false);
    }
  };

  const createDirectSaleOrder = async (nextSession: PharmacySession | null | undefined) => {
    const cart = parseSessionProductCart(nextSession ?? null);
    if (cart.length === 0) {
      // ข้อความนี้ถูกฝังลงในคำตอบที่ "ลูกค้า" เห็นในบทสนทนาจำลอง (สาเหตุที่ยืนยันตะกร้าไม่ได้) — ต้องเป็นภาษาไทย
      return { ok: false as const, message: "ไม่มีรายการสินค้าในตะกร้า", retryable: false };
    }
    try {
      const { data } = await client.mutate({
        mutation: M_CREATE_PHARMACY_LAB_ORDER,
        variables: {
          items: cart.map((item) => ({
            sku: item.sku,
            qty: Number(item.qty),
            ...(item.size ? { size: item.size } : {}),
          })),
        },
      });
      const result = data?.bmsCreatePharmacyLabOrder;
      if (result?.status === "CREATED" && result?.orderId) {
        setLastCreatedOrderId(result.orderId);
        message.success(result.message || t("admin_pharmacy_intake_lab.order_created"));
        return {
          ok: true as const,
          orderId: String(result.orderId),
          total: typeof result.total === "number" ? result.total : null,
          message: String(result.message || t("admin_pharmacy_intake_lab.order_created")),
        };
      }
      // เหตุผลความล้มเหลวถูกฝังในคำตอบที่ลูกค้าเห็น (บทสนทนาจำลอง) — คงภาษาไทยไว้
      return {
        ok: false as const,
        message: String(result?.message || "สร้างออร์เดอร์จาก Lab ไม่สำเร็จ"),
        retryable: false,
      };
    } catch (e: any) {
      message.error(e?.message || t("admin_pharmacy_intake_lab.order_lab_failed"));
      // เหตุผลความล้มเหลวถูกฝังในคำตอบที่ลูกค้าเห็น (บทสนทนาจำลอง) — คงภาษาไทยไว้
      return {
        ok: false as const,
        message: String(e?.message || "สร้างออร์เดอร์จาก Lab ไม่สำเร็จ"),
        retryable: true,
      };
    }
  };

  const send = async (messageText?: string) => {
    const next = String(messageText ?? text).trim();
    if (!next || sending) return;
    const userBubble = { role: "user" as const, text: next, createdAt: new Date().toISOString() };
    setSending(true);
    setChat((prev) => [...prev, userBubble]);
    setText("");
    try {
      const { data } = await client.mutate({
        mutation: M_PHARMACY_TEST,
        variables: { message: next, session },
      });
      const result = data?.bmsPharmacyAssistantTest;
      let assistantBubble: Bubble = { role: "assistant", text: result?.reply ?? "—", createdAt: new Date().toISOString() };
      const nextSession = result?.session ?? null;
      let sessionAfterTurn = nextSession;

      const isDirectSaleCheckout =
        nextSession?.phase === "WAITING" &&
        getSessionProductSalePolicy(nextSession) === "DIRECT_SALE" &&
        Boolean(getSessionProductSku(nextSession)) &&
        hasSessionProductCart(nextSession);

      if (isDirectSaleCheckout) {
        const orderResult = await createDirectSaleOrder(nextSession);
        if (orderResult.ok) {
          // ข้อความในบับเบิลนี้คือคำตอบที่ "ลูกค้า" เห็นในบทสนทนาจำลอง (brand voice ค่ะ) — ห้ามแปล
          assistantBubble = {
            ...assistantBubble,
            text: `ยืนยันตะกร้าแล้วค่ะ\nสร้าง Order จริงเรียบร้อยแล้ว\nหมายเลขออเดอร์: ${orderResult.orderId}\n${orderResult.total != null ? `ยอดรวม: ${orderResult.total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n` : ""}ดูรายการต่อได้ที่หน้า Orders ค่ะ`,
          };
          sessionAfterTurn = null;
          setAutoQueueStatus("idle");
        } else {
          sessionAfterTurn = nextSession ? { ...nextSession, phase: "PRODUCT_PURCHASE" } : session;
          // คำตอบที่ลูกค้าเห็นในบทสนทนาจำลอง — ห้ามแปล
          assistantBubble = {
            role: "assistant",
            text: `ยืนยันตะกร้าแล้ว แต่ยังไม่ได้สร้าง Order จริง\nสาเหตุ: ${orderResult.message}\nกรุณาแก้ไขตะกร้าหรือข้อมูลที่ขาด แล้วลองยืนยันใหม่ค่ะ`,
            createdAt: new Date().toISOString(),
            error: orderResult.retryable,
            retryText: orderResult.retryable ? next : undefined,
          };
        }
      } else if (nextSession?.phase === "WAITING" && session?.phase !== "WAITING") {
        const transcript = [...chat, userBubble, assistantBubble].map((bubble) => ({
          role: bubble.role,
          text: bubble.text,
          createdAt: bubble.createdAt,
        }));
        const assessmentId = await createQueueCase(nextSession, transcript);
        if (assessmentId) {
          // ข้อความต่อท้ายที่ลูกค้าเห็นในบทสนทนาจำลอง — ห้ามแปล
          assistantBubble = {
            ...assistantBubble,
            text: `${assistantBubble.text}\n\nหมายเลขเคส: ${assessmentId}\nเก็บหมายเลขนี้ไว้เพื่อติดตามเคสได้ค่ะ`,
          };
          // Reset only after the real queue row exists. The transcript stays
          // visible and the case remains accessible through lastSeededAssessmentId.
          sessionAfterTurn = null;
        } else {
          // Keep the previous pre-confirmation state so Retry submits the same
          // answer and attempts queue creation again instead of getting stuck
          // forever in WAITING without a persisted case.
          sessionAfterTurn = session;
          // คำตอบที่ลูกค้าเห็นในบทสนทนาจำลอง — ห้ามแปล
          assistantBubble = {
            role: "assistant",
            text: "รับข้อมูลยืนยันแล้ว แต่สร้างเคสเข้าคิวไม่สำเร็จ กรุณากดลองอีกครั้งค่ะ",
            createdAt: new Date().toISOString(),
            error: true,
            retryText: next,
          };
        }
      }
      setSession(sessionAfterTurn);
      setChat((prev) => [...prev, assistantBubble]);
    } catch (e: any) {
      message.error(e?.message || t("admin_pharmacy_intake_lab.lab_call_failed"));
      setChat((prev) => [
        ...prev,
        {
          // คำตอบที่ลูกค้าเห็นในบทสนทนาจำลอง — ห้ามแปล
          role: "assistant",
          text: "ขออภัยค่ะ ระบบทดสอบร้านยาขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ",
          createdAt: new Date().toISOString(),
          error: true,
          retryText: next,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const retry = async (idx: number) => {
    const bubble = chat[idx];
    if (!bubble?.retryText || sending) return;
    await send(bubble.retryText);
  };

  const quickReplies = getPharmacyQuickReplies(session, t);
  const cartItems = parseSessionProductCart(session);
  const primaryReplies = quickReplies.length > 0 ? quickReplies : starters;

  const copySummary = async () => {
    if (summaryRows.length === 0) {
      message.warning(t("admin_pharmacy_intake_lab.no_summary_to_copy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(
        formatCustomerConfirmationClipboardText(summaryRows, {
          protocolKey: session?.protocolKey ?? null,
          completenessStatus: completenessMeta.text,
          confirmationStatus: confirmationMeta.text,
        })
      );
      message.success(t("admin_pharmacy_intake_lab.summary_copied"));
    } catch {
      message.error(t("admin_pharmacy_intake_lab.summary_copy_failed"));
    }
  };

  const queueStatusColor = autoQueueStatus === "done" ? "green" : autoQueueStatus === "running" ? "gold" : autoQueueStatus === "error" ? "red" : "default";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 20 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}>Pharmacy Intake Lab</Title>
          <Text type="secondary">
            {t("admin_pharmacy_intake_lab.subtitle", { path: "/admin/assistant" })}
          </Text>
        </div>
        <Space size={10} wrap>
          <Button icon={<ReadOutlined />} onClick={() => router.push("/admin/pharmacy-manual")}>{t("admin_pharmacy_intake_lab.btn_manual")}</Button>
          <Button onClick={() => router.push("/admin/pharmacy-queue")}>{t("admin_pharmacy_intake_lab.btn_queue_page")}</Button>
          <Popconfirm
            title={t("admin_pharmacy_intake_lab.clear_title")}
            okText={t("admin_pharmacy_intake_lab.clear_ok")}
            okType="danger"
            cancelText={t("admin_pharmacy_intake_lab.cancel")}
            onConfirm={clearLab}
            disabled={chat.length === 0}
          >
            <Button icon={<DeleteOutlined />} disabled={chat.length === 0}>{t("admin_pharmacy_intake_lab.btn_clear_lab")}</Button>
          </Popconfirm>
        </Space>
      </Space>

      {!storeProfileLoading && !isPharmacyShop && showArchetypeNotice ? (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setShowArchetypeNotice(false)}
          message={t("admin_pharmacy_intake_lab.archetype_warn")}
          description={t("admin_pharmacy_intake_lab.archetype_warn_desc")}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            style={{ borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", height: "min(74vh, 680px)" }}
            styles={{ body: { flex: 1, display: "flex", flexDirection: "column", padding: 0, minHeight: 0 } }}
          >
            <div ref={logRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 16 }}>
              {chat.length === 0 ? (
                <div style={{ height: "100%", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
                  <Space direction="vertical" size={12}>
                    <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(var(--app-primary-rgb),0.12)", display: "grid", placeItems: "center", color: "var(--app-primary)", fontSize: 26, margin: "0 auto" }}>
                      <ExperimentOutlined />
                    </div>
                    <Text strong style={{ fontSize: 16 }}>{t("admin_pharmacy_intake_lab.empty_title")}</Text>
                    <Text type="secondary">{starters.length > 0 ? t("admin_pharmacy_intake_lab.empty_hint", { examples: starterExample }) : t("admin_pharmacy_intake_lab.empty_no_protocol")}</Text>
                    <Space wrap style={{ justifyContent: "center" }}>
                      {starters.map((item) => (
                        <Button key={item.value} shape="round" onClick={() => send(item.value)}>
                          {item.label}
                        </Button>
                      ))}
                    </Space>
                  </Space>
                </div>
              ) : (
                <Space direction="vertical" style={{ width: "100%" }} size={4}>
                  {chat.map((bubble, idx) => {
                    const prevDay = idx > 0 ? dayKey(chat[idx - 1].createdAt) : null;
                    const curDay = dayKey(bubble.createdAt);
                    const showDaySep = curDay !== prevDay;
                    return (
                      <div key={idx}>
                        {showDaySep ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
                            <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
                            <Text style={{ fontSize: 11, fontWeight: 700, color: "var(--app-muted)", whiteSpace: "nowrap" }}>
                              {dayLabel(bubble.createdAt, t)}
                            </Text>
                            <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
                          </div>
                        ) : null}
                        <div style={{ textAlign: bubble.role === "user" ? "right" : "left", marginBottom: 8 }}>
                          <div
                            style={{
                              display: "inline-block",
                              maxWidth: "88%",
                              whiteSpace: "pre-wrap",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: bubble.error ? "1px solid rgba(255,77,79,.35)" : "1px solid var(--app-border)",
                              background: bubble.error
                                ? "rgba(255,77,79,.1)"
                                : bubble.role === "user"
                                  ? "rgba(var(--app-primary-rgb), 0.12)"
                                  : "var(--app-surface-2)",
                            }}
                          >
                            <Paragraph style={{ margin: 0 }}>{bubble.text}</Paragraph>
                          </div>
                          <div style={{ marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {new Date(bubble.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                            </Text>
                          </div>
                          {bubble.error ? (
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={() => retry(idx)}
                              disabled={sending}
                              style={{ marginTop: 6 }}
                            >
                              {t("admin_pharmacy_intake_lab.btn_retry")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </Space>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--app-border)", background: "var(--app-surface-2)", padding: 12 }}>
              {session?.phase === "PRODUCT_PURCHASE" && cartItems.length > 0 ? (
                <div style={{ marginBottom: 10 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_pharmacy_intake_lab.remove_item_label")}</Text>
                  <Space wrap style={{ display: "flex", marginTop: 6 }}>
                    {cartItems.map((item) => (
                      <Button
                        key={`remove-${item.sku}`}
                        size="small"
                        shape="round"
                        danger
                        /* คำสั่งที่ส่งเข้า assistant แทนลูกค้า — backend จับคู่คำว่า "ลบ" ภาษาไทย ห้ามแปล */
                        onClick={() => send(`ลบ ${item.sku}`)}
                        disabled={sending}
                      >
                        {`✕ ${item.name}`}
                      </Button>
                    ))}
                  </Space>
                </div>
              ) : null}
              <Space wrap style={{ marginBottom: 10 }}>
                {primaryReplies.map((item) => (
                  <Button key={item.value} size="small" shape="round" onClick={() => send(item.value)} disabled={sending}>
                    {item.label}
                  </Button>
                ))}
              </Space>
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPressEnter={() => send()}
                  placeholder={t("admin_pharmacy_intake_lab.input_placeholder")}
                  disabled={sending}
                />
                <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()}>
                  {t("admin_pharmacy_intake_lab.btn_send")}
                </Button>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {/* ===== สถานะ session ตอนนี้ — chip เดียวกับสไตล์ /admin/dashboard ===== */}
            <Card size="small" style={{ borderRadius: 10 }} styles={{ body: { padding: "12px 14px" } }}>
              <Text strong style={{ fontSize: 12.5, display: "block", marginBottom: 8 }}>{t("admin_pharmacy_intake_lab.session_status")}</Text>
              <Space wrap size={[8, 8]}>
                <Tag color="blue">phase: {session?.phase || "NONE"}</Tag>
                <Tag>protocol: {session?.protocolKey || "—"}</Tag>
                <Tag color={queueStatusColor}>queue: {autoQueueStatus}</Tag>
              </Space>
              <Button size="small" style={{ marginTop: 10 }} onClick={() => setSession(null)}>
                {t("admin_pharmacy_intake_lab.btn_reset_session")}
              </Button>
            </Card>

            <Card
              size="small"
              title={<Text strong style={{ fontSize: 12.5 }}>{t("admin_pharmacy_intake_lab.quick_replies_all")}</Text>}
              style={{ borderRadius: 10 }}
              styles={{ body: { padding: "12px 14px" } }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {quickReplies.length > 0 ? (
                  quickReplies.map((opt) => (
                    <Button key={opt.value} size="small" onClick={() => send(opt.value)} disabled={sending}>
                      {opt.label}
                    </Button>
                  ))
                ) : (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{t("admin_pharmacy_intake_lab.no_quick_reply")}</Text>
                )}
              </div>
            </Card>

            <Card
              size="small"
              title={<Text strong style={{ fontSize: 12.5 }}>Customer confirmation snapshot</Text>}
              style={{ borderRadius: 10 }}
              styles={{ body: { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 } }}
            >
              <Space wrap size={[8, 8]}>
                <Tag color={completenessMeta.color}>{t("admin_pharmacy_intake_lab.tag_completeness", { value: completenessMeta.text })}</Tag>
                <Tag color={confirmationMeta.color}>{t("admin_pharmacy_intake_lab.tag_confirmation", { value: confirmationMeta.text })}</Tag>
                <Button size="small" icon={<CopyOutlined />} onClick={copySummary} disabled={summaryRows.length === 0}>
                  copy summary
                </Button>
              </Space>
              {summaryRows.length > 0 ? (
                <List
                  size="small"
                  bordered
                  dataSource={summaryRows}
                  renderItem={(row) => (
                    <List.Item key={row.fieldKey}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Text strong style={{ fontSize: 12.5 }}>{row.label}</Text>
                        <Text style={{ fontSize: 12.5 }}>{row.valueText}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Text type="secondary" style={{ fontSize: 12.5 }}>{t("admin_pharmacy_intake_lab.no_summary_data")}</Text>
              )}
            </Card>

            {(lastSeededAssessmentId || lastCreatedOrderId) ? (
              <Card
                size="small"
                title={<Text strong style={{ fontSize: 12.5 }}>{t("admin_pharmacy_intake_lab.latest_results")}</Text>}
                style={{ borderRadius: 10 }}
                styles={{ body: { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 } }}
              >
                {lastSeededAssessmentId ? (
                  <Space direction="vertical" style={{ width: "100%" }} size={6}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_pharmacy_intake_lab.latest_case")}</Text>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input value={lastSeededAssessmentId} readOnly size="small" />
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(lastSeededAssessmentId);
                            message.success(t("admin_pharmacy_intake_lab.case_copied"));
                          } catch {
                            message.error(t("admin_pharmacy_intake_lab.case_copy_failed"));
                          }
                        }}
                      />
                    </Space.Compact>
                    <Space wrap size={6}>
                      <Button size="small" onClick={() => router.push("/admin/pharmacy-queue")}>{t("admin_pharmacy_intake_lab.btn_open_queue_list")}</Button>
                      <Button size="small" onClick={() => router.push(`/admin/pharmacy-queue/${lastSeededAssessmentId}`)}>{t("admin_pharmacy_intake_lab.btn_open_case_detail")}</Button>
                    </Space>
                  </Space>
                ) : null}
                {lastCreatedOrderId ? (
                  <Space direction="vertical" style={{ width: "100%" }} size={6}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_pharmacy_intake_lab.latest_order")}</Text>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input value={lastCreatedOrderId} readOnly size="small" />
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(lastCreatedOrderId);
                            message.success(t("admin_pharmacy_intake_lab.order_copied"));
                          } catch {
                            message.error(t("admin_pharmacy_intake_lab.order_copy_failed"));
                          }
                        }}
                      />
                    </Space.Compact>
                    <Button size="small" onClick={() => router.push("/admin/orders")}>{t("admin_pharmacy_intake_lab.btn_open_orders")}</Button>
                  </Space>
                ) : null}
              </Card>
            ) : null}
          </Space>
        </Col>
      </Row>

      {/* ===== debug ล้วน ๆ — ลดน้ำหนักภาพลงด้วยพื้นหลังทึบกว่า เหมือน "ภาพรวมธุรกิจ" ใน dashboard ===== */}
      <div style={{ background: "var(--app-surface-2)", border: "1px solid var(--app-border)", borderRadius: 12, padding: 12, marginTop: 16 }}>
        <Text strong style={{ display: "block", marginBottom: 8, fontSize: 12.5 }}>Current answers (debug)</Text>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, padding: 10, borderRadius: 8, background: "var(--app-surface)", border: "1px solid var(--app-border)", fontSize: 12 }}>
          {JSON.stringify(session?.answers || {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
