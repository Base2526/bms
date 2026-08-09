'use client';
import { gql, useApolloClient, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Input,
  List,
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
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import {
  buildCustomerConfirmationLinesFromAnswers,
  formatCustomerConfirmationClipboardText,
  getCompletenessTagMeta,
  getCustomerConfirmationTagMeta,
} from "@/lib/bms/pharmacy/customerConfirmation";

const { Text, Paragraph, Title } = Typography;

const CHAT_STORAGE_KEY = "bms-pharmacy-intake-lab-chat-v1";

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

function getPharmacyQuickReplies(session: PharmacySession | null): QuickReply[] {
  if (!session) return [];
  if (session.phase === "AWAITING_INTENT_CLARIFICATION") {
    return [
      { label: "มีสินค้าที่ต้องการ", value: "มีชื่อสินค้าที่ต้องการซื้อแล้วค่ะ" },
      { label: "ให้เภสัชกรประเมิน", value: "ให้เภสัชกรช่วยประเมินอาการค่ะ" },
      { label: "ไม่ใช่ / ยกเลิก", value: "ไม่ใช่ค่ะ" },
    ];
  }
  if (session.phase === "AWAITING_CONSENT") {
    return [
      { label: "ยินยอม", value: "ยินยอม" },
      { label: "ไม่ยินยอม", value: "ไม่ยินยอม" },
    ];
  }
  if (session.phase === "PENDING_CONFIRMATION") {
    return [
      { label: "ข้อมูลถูกต้อง", value: "ข้อมูลถูกต้อง" },
      { label: "ยืนยัน", value: "ยืนยัน" },
      { label: "ขอแก้ไข", value: "ขอแก้ไข" },
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
      { label: "เพิ่มสินค้า", value: "เพิ่มสินค้า" },
      { label: "ดูตะกร้า", value: "ดูตะกร้า" },
      { label: "ยืนยันตะกร้า", value: "ยืนยันตะกร้า" },
      { label: "ลบรายการล่าสุด", value: "ลบรายการล่าสุด" },
      { label: "ล้างตะกร้า", value: "ล้างตะกร้า" },
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
      { label: "มี", value: "มี" },
      { label: "ไม่มี", value: "ไม่มี" },
    ];
  }
  if (fieldKey === "severity") {
    return [{ label: "3", value: "3" }, { label: "5", value: "5" }, { label: "7", value: "7" }];
  }
  if (fieldKey === "duration_days") {
    return [{ label: "1 วัน", value: "1 วัน" }, { label: "3 วัน", value: "3 วัน" }, { label: "7 วัน", value: "7 วัน" }];
  }
  if (fieldKey === "duration_hours") {
    return [{ label: "6 ชม.", value: "6 ชั่วโมง" }, { label: "12 ชม.", value: "12 ชั่วโมง" }, { label: "1 วัน", value: "24 ชั่วโมง" }];
  }
  if (fieldKey === "frequency_per_day") {
    return [{ label: "1 ครั้ง", value: "1" }, { label: "3 ครั้ง", value: "3" }, { label: "5 ครั้ง", value: "5" }];
  }
  if (fieldKey === "patient_age_years") {
    return [{ label: "1 ปี", value: "1" }, { label: "6 ปี", value: "6" }, { label: "18 ปี", value: "18" }];
  }
  if (fieldKey === "biological_sex") {
    return [{ label: "หญิง", value: "หญิง" }, { label: "ชาย", value: "ชาย" }];
  }
  if (fieldKey === "patient_relationship") {
    return [
      { label: "ตัวเอง", value: "ตัวเอง" },
      { label: "ลูก", value: "ลูก" },
      { label: "พ่อแม่", value: "พ่อแม่" },
      { label: "บุคคลอื่น", value: "บุคคลอื่น" },
    ];
  }
  if (fieldKey === "sputum") {
    return [
      { label: "ไม่มีเสมหะ", value: "ไม่มีเสมหะ" },
      { label: "เสมหะใส", value: "เสมหะใส" },
      { label: "เสมหะเหลือง", value: "เสมหะเหลือง" },
    ];
  }
  if (fieldKey === "allergies") return [{ label: "ไม่เคยแพ้ยา", value: "ไม่เคยแพ้ยา" }];
  if (fieldKey === "current_medications") return [{ label: "ไม่ได้ใช้ยาอยู่", value: "ไม่ได้ใช้ยาอยู่" }];
  return [];
}

export default function PharmacyIntakeLabPage() {
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
  const [showInfoNotice, setShowInfoNotice] = useState(true);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [session, setSession] = useState<PharmacySession | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const storageKey = [CHAT_STORAGE_KEY, meData?.bmsMe?.tenant?.id || "no-tenant", meData?.bmsMe?.id || "no-user"].join(":");
  const isPharmacyShop = storeProfileData?.bmsStoreProfile?.businessArchetype === "pharmacy";
  const starters: QuickReply[] = [
    { label: "ซื้อสินค้า", value: "ซื้อสินค้า" },
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
        message.warning(e?.message || "สร้างเคสแล้ว แต่ยัง auto รับเคสไม่ได้");
      }

      try {
        await client.mutate({ mutation: M_SUGGEST_MEDICATION, variables: { id: assessmentId } });
      } catch (e: any) {
        message.warning(e?.message || "สร้างเคสแล้ว แต่ยังดึงคำแนะนำยาอัตโนมัติไม่ได้");
      }

      setAutoQueueStatus("done");
      message.success(`ส่งเคสเข้าคิวแล้ว: ${assessmentId}`);
      return assessmentId;
    } catch (e: any) {
      setAutoQueueStatus("error");
      message.error(e?.message || "สร้างเคสเข้าคิวอัตโนมัติไม่สำเร็จ");
      return null;
    } finally {
      setSeedingQueue(false);
    }
  };

  const createDirectSaleOrder = async (nextSession: PharmacySession | null | undefined) => {
    const cart = parseSessionProductCart(nextSession ?? null);
    if (cart.length === 0) {
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
        message.success(result.message || "สร้างออร์เดอร์แล้ว");
        return {
          ok: true as const,
          orderId: String(result.orderId),
          total: typeof result.total === "number" ? result.total : null,
          message: String(result.message || "สร้างออร์เดอร์แล้ว"),
        };
      }
      return {
        ok: false as const,
        message: String(result?.message || "สร้างออร์เดอร์จาก Lab ไม่สำเร็จ"),
        retryable: false,
      };
    } catch (e: any) {
      message.error(e?.message || "สร้างออร์เดอร์จาก Lab ไม่สำเร็จ");
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
          assistantBubble = {
            ...assistantBubble,
            text: `ยืนยันตะกร้าแล้วค่ะ\nสร้าง Order จริงเรียบร้อยแล้ว\nหมายเลขออเดอร์: ${orderResult.orderId}\n${orderResult.total != null ? `ยอดรวม: ${orderResult.total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n` : ""}ดูรายการต่อได้ที่หน้า Orders ค่ะ`,
          };
          sessionAfterTurn = null;
          setAutoQueueStatus("idle");
        } else {
          sessionAfterTurn = nextSession ? { ...nextSession, phase: "PRODUCT_PURCHASE" } : session;
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
      message.error(e?.message || "เรียก Pharmacy lab ไม่สำเร็จ");
      setChat((prev) => [
        ...prev,
        {
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

  const quickReplies = getPharmacyQuickReplies(session);
  const cartItems = parseSessionProductCart(session);
  const primaryReplies = quickReplies.length > 0 ? quickReplies : starters;

  const copySummary = async () => {
    if (summaryRows.length === 0) {
      message.warning("ยังไม่มี summary ให้คัดลอก");
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
      message.success("คัดลอก summary แล้ว");
    } catch {
      message.error("คัดลอก summary ไม่สำเร็จ");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100dvh - 120px)", minHeight: 0 }}>
      {!storeProfileLoading && !isPharmacyShop && showArchetypeNotice ? (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setShowArchetypeNotice(false)}
          message="หน้านี้ใช้ได้เฉพาะร้าน archetype = Pharmacy"
          description="ร้านนี้ไม่ได้ตั้งเป็น Pharmacy ระบบกำลังพากลับไปที่ผู้ช่วย AI ปกติ"
        />
      ) : null}

      <AdminPageHeader
        title={<Title level={4} style={{ margin: 0 }}>Pharmacy Intake Lab</Title>}
      >
        <Space>
          <Button onClick={() => router.push("/admin/pharmacy-queue")}>ไปหน้า Queue</Button>
          <Popconfirm
            title="ล้างบทสนทนาทดสอบนี้?"
            okText="ล้าง"
            okType="danger"
            cancelText="ยกเลิก"
            onConfirm={clearLab}
            disabled={chat.length === 0}
          >
            <Button icon={<DeleteOutlined />} disabled={chat.length === 0}>ล้าง lab</Button>
          </Popconfirm>
        </Space>
      </AdminPageHeader>

      {showInfoNotice ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setShowInfoNotice(false)}
          message="หน้าทดสอบเฉพาะ Pharmacy intake"
          description="ใช้สำหรับจำลองบทสนทนาซักอาการ, quick reply, summary confirmation และการส่งเคสเข้าคิว โดยแยกออกจากผู้ช่วย AI หลังบ้านปกติ"
        />
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>
        <Card
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%", minHeight: 0 }}
          styles={{ body: { flex: 1, display: "flex", flexDirection: "column", padding: 0, minHeight: 0 } }}
        >
          <div ref={logRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 16 }}>
            {chat.length === 0 ? (
              <div style={{ height: "100%", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
                <Space direction="vertical" size={12}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(var(--app-primary-rgb),0.12)", display: "grid", placeItems: "center", color: "var(--app-primary)", fontSize: 26, margin: "0 auto" }}>
                    <ExperimentOutlined />
                  </div>
                  <Text strong style={{ fontSize: 16 }}>เริ่มทดสอบบทสนทนาร้านยา</Text>
                  <Text type="secondary">{starters.length > 0 ? `กด starter ด้านล่างหรือพิมพ์อาการ เช่น ${starterExample}` : "ยังไม่มี Protocol ที่ผ่านการอนุมัติ เปิดใช้งาน และอยู่ใน Platform allowlist"}</Text>
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
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                {chat.map((bubble, idx) => (
                  <div key={idx} style={{ textAlign: bubble.role === "user" ? "right" : "left" }}>
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
                        ลองอีกครั้ง
                      </Button>
                    ) : null}
                  </div>
                ))}
              </Space>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--app-border)", background: "var(--app-surface-2)", padding: 12 }}>
            {session?.phase === "PRODUCT_PURCHASE" && cartItems.length > 0 ? (
              <div style={{ marginBottom: 10 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>ลบรายสินค้า</Text>
                <Space wrap style={{ display: "flex", marginTop: 6 }}>
                  {cartItems.map((item) => (
                    <Button
                      key={`remove-${item.sku}`}
                      size="small"
                      shape="round"
                      danger
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
                placeholder="พิมพ์อาการหรือคำตอบ เช่น 'มีไข้ 38.5' หรือ 'ข้อมูลถูกต้อง'"
                disabled={sending}
              />
              <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()}>
                ส่ง
              </Button>
            </div>
          </div>
        </Card>

        <Card
          title="Lab Controls"
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%", minHeight: 0 }}
          styles={{ body: { flex: 1, display: "flex", flexDirection: "column", padding: 0, minHeight: 0 } }}
        >
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            <Alert
              type="warning"
              showIcon
              message="แยกจากผู้ช่วย AI ปกติ"
              description="หน้านี้ใช้ state ทดสอบของ pharmacy โดยเฉพาะ ไม่ปนกับ /admin/assistant"
            />

            <div>
              <Text strong>Session state</Text>
              <div style={{ marginTop: 8 }}>
                <Tag color="blue">phase: {session?.phase || "NONE"}</Tag>
                <Tag>protocol: {session?.protocolKey || "—"}</Tag>
                <Tag color={autoQueueStatus === "done" ? "green" : autoQueueStatus === "running" ? "gold" : autoQueueStatus === "error" ? "red" : "default"}>
                  queue: {autoQueueStatus}
                </Tag>
              </div>
            </div>

            <div>
              <Text strong>Quick replies</Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {quickReplies.length > 0 ? (
                  quickReplies.map((opt) => (
                    <Button key={opt.value} size="small" onClick={() => send(opt.value)} disabled={sending}>
                      {opt.label}
                    </Button>
                  ))
                ) : (
                  <Text type="secondary">ยังไม่มี quick reply สำหรับสถานะนี้</Text>
                )}
              </div>
            </div>

            <div>
              <Text strong>Customer confirmation snapshot</Text>
              <Card
                size="small"
                style={{ marginTop: 8, background: "var(--app-surface-2)" }}
                styles={{ body: { display: "flex", flexDirection: "column", gap: 8 } }}
              >
                <Space wrap>
                  <Text strong>ความครบถ้วน:</Text>
                  <Tag color={completenessMeta.color}>{completenessMeta.text}</Tag>
                  <Text strong>การยืนยัน:</Text>
                  <Tag color={confirmationMeta.color}>{confirmationMeta.text}</Tag>
                  <Tag>{session?.protocolKey || "ยังไม่เลือก protocol"}</Tag>
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
                          <Text strong>{row.label}</Text>
                          <Text>{row.valueText}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Text type="secondary">ยังไม่มีข้อมูลสรุปสำหรับยืนยัน</Text>
                )}
              </Card>
            </div>

            <div>
              <Text strong>Current answers</Text>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", padding: 10, borderRadius: 8, background: "var(--app-surface-2)", border: "1px solid var(--app-border)", fontSize: 12 }}>
                {JSON.stringify(session?.answers || {}, null, 2)}
              </pre>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--app-border)", background: "var(--app-surface-1)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <Button onClick={() => setSession(null)}>รีเซ็ต session</Button>
            {lastSeededAssessmentId ? (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <Text type="secondary">เคสล่าสุด</Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Input value={lastSeededAssessmentId} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lastSeededAssessmentId);
                        message.success("คัดลอกหมายเลขเคสแล้ว");
                      } catch {
                        message.error("คัดลอกหมายเลขเคสไม่สำเร็จ");
                      }
                    }}
                  />
                </Space.Compact>
                <Button onClick={() => router.push("/admin/pharmacy-queue")}>
                  เปิด queue list
                </Button>
                <Button onClick={() => router.push(`/admin/pharmacy-queue/${lastSeededAssessmentId}`)}>
                  เปิด case detail ล่าสุด
                </Button>
              </Space>
            ) : null}
            {lastCreatedOrderId ? (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <Text type="secondary">ออเดอร์ล่าสุด</Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Input value={lastCreatedOrderId} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lastCreatedOrderId);
                        message.success("คัดลอกหมายเลขออเดอร์แล้ว");
                      } catch {
                        message.error("คัดลอกหมายเลขออเดอร์ไม่สำเร็จ");
                      }
                    }}
                  />
                </Space.Compact>
                <Button onClick={() => router.push("/admin/orders")}>
                  เปิด Orders
                </Button>
              </Space>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
