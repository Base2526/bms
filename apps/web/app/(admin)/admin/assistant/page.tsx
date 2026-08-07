'use client';
import { gql, useApolloClient, useQuery } from "@apollo/client";
import {
  Card, Input, Button, Space, Tag, Typography, Alert, message, Tooltip, Popconfirm, Drawer, Switch,
} from "antd";
import { useState, useRef, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  SendOutlined, RobotOutlined, CheckOutlined, CloseOutlined, ToolOutlined, DownloadOutlined,
  DeleteOutlined, BulbOutlined, SaveOutlined, DownOutlined, CopyOutlined, ReloadOutlined,
  ArrowDownOutlined, MailOutlined, WarningOutlined, FileExcelOutlined,
} from "@ant-design/icons";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

const { Text, Paragraph } = Typography;

// เก็บแชทไว้ในเครื่องนี้อัตโนมัติ (ต่อเบราว์เซอร์ ไม่ sync ข้ามอุปกรณ์/แท็บอื่น) — ผู้ใช้ต้องกด
// "ล้างแชท" เองเท่านั้น ไม่มีการล้างอัตโนมัติ (เช่น ตอนปิดแท็บ/refresh)
const CHAT_STORAGE_KEY = "bms-assistant-chat-v1";

// ---- วันที่/เวลา — ยืมธรรมเนียมเดิมจาก Inbox (app/(admin)/admin/inbox/page.tsx) ตรงๆ ไม่คิดใหม่
// เพื่อให้ label "วันนี้/เมื่อวาน/วันที่" ตรงกันทั้งระบบ (Asia/Bangkok ทุกเครื่อง ไม่ขึ้นกับ timezone browser) ----
const BKK = "Asia/Bangkok";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: BKK, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
function dayLabel(iso: string) {
  const key = dayKey(iso);
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === todayKey) return "วันนี้";
  if (key === dayKey(y.toISOString())) return "เมื่อวาน";
  return new Intl.DateTimeFormat("th-TH", { timeZone: BKK, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

// ข้อความจาก AI เป็น markdown แบบพูด (**หนา**/`โค้ด`/ลิงก์) แต่โปรเจกต์นี้ไม่มี markdown renderer
// เต็มรูปแบบติดตั้งอยู่ — parse เท่าที่ต้องใช้จริง (bold/inline code/URL) แทนที่จะโชว์ asterisk ดิบๆ
// ไม่ใช้ dangerouslySetInnerHTML เลย จึงไม่มีความเสี่ยง XSS จากข้อความที่ AI แต่งขึ้น
const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\/api\/bms\/reports\/download\/\d+|https?:\/\/[^\s)]+)/g;
const REPORT_DOWNLOAD_RE = /^\/api\/bms\/reports\/download\/\d+$/;

function renderAssistantText(text: string) {
  return text.split(INLINE_TOKEN_RE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      // AI มักห่อลิงก์ดาวน์โหลดด้วย backtick เอง เช่น `/api/bms/reports/download/7546` —
      // ต้องเช็คเนื้อในก่อนตัดสินใจว่าเป็นโค้ดเฉยๆ หรือควรเป็นปุ่มดาวน์โหลดจริง
      const inner = part.slice(1, -1);
      if (REPORT_DOWNLOAD_RE.test(inner)) {
        part = inner;
      } else {
        return <Text code key={i}>{inner}</Text>;
      }
    }
    if (REPORT_DOWNLOAD_RE.test(part)) {
      // route เดิมตั้ง Content-Disposition: attachment ให้แล้ว (ดู
      // app/api/bms/reports/download/[id]/route.ts) — ลิงก์ปกติกดแล้วดาวน์โหลดได้เลย ไม่ต้องเปิดแท็บใหม่
      return (
        <Button
          key={i}
          type="primary"
          ghost
          size="small"
          icon={<DownloadOutlined />}
          href={part}
          style={{ marginTop: 4, marginBottom: 4 }}
        >
          ดาวน์โหลดไฟล์
        </Button>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const M_ASSISTANT = gql`
  mutation BmsAssistant($message: String!, $history: [BmsAssistantTurn!]) {
    bmsAssistant(message: $message, history: $history) {
      reply
      proposals { tool mutation args summary }
      trace { tool ok summary }
    }
  }
`;
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
    bmsSeedPharmacyQueueDemo(protocolKey: $protocolKey, answers: $answers, transcript: $transcript)
  }
`;
const Q_ME = gql`
  query {
    bmsMe {
      id
      email
      tenant { id slug }
    }
  }
`;

// A3 sensitive → ปุ่ม Confirm ยิง mutation เดิม (permission-gated ที่ backend อยู่แล้ว)
const CONFIRM_MUTATIONS: Record<
  string,
  { doc: any; vars: (a: any) => Record<string, unknown> }
> = {
  bmsConfirmPayment: {
    doc: gql`mutation($id: ID!) { bmsConfirmPayment(id: $id) { __typename } }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsRejectPayment: {
    doc: gql`mutation($id: ID!, $note: String) { bmsRejectPayment(id: $id, note: $note) }`,
    vars: (a) => ({ id: a.id, note: a.note ?? null }),
  },
  bmsRefundPayment: {
    doc: gql`mutation($id: ID!) { bmsRefundPayment(id: $id) }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsCancelOrder: {
    doc: gql`mutation($id: ID!) { bmsCancelOrder(id: $id) }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsReturnOrder: {
    doc: gql`mutation($id: ID!) { bmsReturnOrder(id: $id) }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsAdjustStock: {
    doc: gql`mutation($sku: String!, $size: String!, $delta: Int!, $note: String) {
      bmsAdjustStock(sku: $sku, size: $size, delta: $delta, note: $note) { __typename }
    }`,
    vars: (a) => ({ sku: a.sku, size: a.size, delta: a.delta, note: a.note ?? null }),
  },
  bmsMergeCustomers: {
    doc: gql`mutation($keepId: ID!, $mergeId: ID!) { bmsMergeCustomers(keepId: $keepId, mergeId: $mergeId) }`,
    vars: (a) => ({ keepId: a.keepId, mergeId: a.mergeId }),
  },
  bmsCancelPurchaseOrder: {
    doc: gql`mutation($id: ID!) { bmsCancelPurchaseOrder(id: $id) }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsCancelShipment: {
    doc: gql`mutation($id: ID!) { bmsCancelShipment(id: $id) }`,
    vars: (a) => ({ id: a.id }),
  },
  bmsSendMessage: {
    doc: gql`mutation($id: ID!, $body: String) { bmsSendMessage(id: $id, body: $body) { status } }`,
    vars: (a) => ({ id: a.id, body: a.body }),
  },
  bmsEmailReport: {
    doc: gql`mutation($fileId: Int!, $to: String!, $subject: String) {
      bmsEmailReport(fileId: $fileId, to: $to, subject: $subject) { fileId to reportType format }
    }`,
    vars: (a) => ({ fileId: a.fileId, to: a.to, subject: a.subject ?? null }),
  },
};

const REPORT_TYPE_LABEL_TH: Record<string, string> = {
  SALES: "ยอดขาย",
  INVENTORY: "สต็อกสินค้า",
  PROFIT: "กำไร (ประมาณการ)",
};

type Proposal = { tool: string; mutation: string; args: any; summary: string };
type TraceEntry = { tool: string; ok: boolean; summary: string };
type Bubble = {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp — บับเบิลเก่าที่เคยเซฟไว้ก่อนมี field นี้จะไม่มีค่า ให้ render ข้ามเวลาไปเฉยๆ */
  createdAt?: string;
  proposals?: Proposal[];
  trace?: TraceEntry[];
  /** สถานะ proposal ต่อ index: undefined=รอ, 'done'=ยืนยันแล้ว, 'dismissed'=ยกเลิก */
  proposalStates?: Record<number, "done" | "dismissed">;
  /** true = เรียก AI ไม่สำเร็จ (ต่างจาก error ทางธุรกิจที่ AI ตอบเองว่าทำไม่ได้) — ให้ปุ่ม "ลองอีกครั้ง" ส่ง retryText ซ้ำ */
  error?: boolean;
  retryText?: string;
};
type PharmacySession = {
  protocolKey?: string;
  phase?: string;
  protocolId?: string;
  answers?: Record<string, string | number>;
  currentQuestionKey?: string | null;
  currentFieldKey?: string | null;
};

type QuickReply = { label: string; value: string };

function getPharmacyQuickReplies(session: PharmacySession | null): QuickReply[] {
  if (!session) return [];
  if (session.phase === "AWAITING_CONSENT") {
    return [
      { label: "ยินยอม", value: "ยินยอม" },
      { label: "ไม่ยินยอม", value: "ไม่ยินยอม" },
    ];
  }

  const fieldKey = session.currentFieldKey ?? session.currentQuestionKey ?? "";
  if (["has_fever", "hydration_status", "blood_in_sputum", "blood_in_stool", "neck_stiffness", "worst_ever", "neuro_symptoms", "recent_head_injury", "breathing_difficulty", "chest_pain", "high_fever", "pregnancy_status", "breastfeeding_status"].includes(fieldKey)) {
    return [
      { label: "มี", value: "มี" },
      { label: "ไม่มี", value: "ไม่มี" },
    ];
  }
  if (fieldKey === "severity") {
    return [
      { label: "1", value: "1" },
      { label: "3", value: "3" },
      { label: "5", value: "5" },
      { label: "7", value: "7" },
      { label: "10", value: "10" },
    ];
  }
  if (fieldKey === "duration_days") {
    return [
      { label: "1 วัน", value: "1" },
      { label: "3 วัน", value: "3" },
      { label: "7 วัน", value: "7" },
      { label: "2 สัปดาห์", value: "14" },
    ];
  }
  if (fieldKey === "duration_hours") {
    return [
      { label: "6 ชม.", value: "6" },
      { label: "12 ชม.", value: "12" },
      { label: "1 วัน", value: "24" },
      { label: "2 วัน", value: "48" },
    ];
  }
  if (fieldKey === "frequency_per_day") {
    return [
      { label: "1 ครั้ง", value: "1" },
      { label: "3 ครั้ง", value: "3" },
      { label: "5 ครั้ง", value: "5" },
      { label: "มากกว่า 5", value: "6" },
    ];
  }
  if (fieldKey === "patient_age_years") {
    return [
      { label: "น้อยกว่า 2 ปี", value: "1" },
      { label: "2-12 ปี", value: "6" },
      { label: "ผู้ใหญ่", value: "18" },
    ];
  }
  if (fieldKey === "biological_sex") {
    return [
      { label: "หญิง", value: "หญิง" },
      { label: "ชาย", value: "ชาย" },
    ];
  }
  if (fieldKey === "sputum") {
    return [
      { label: "ไม่มีเสมหะ", value: "ไม่มีเสมหะ" },
      { label: "เสมหะใส", value: "เสมหะใส" },
      { label: "เสมหะเหลือง/เขียว", value: "เสมหะเหลืองหรือเขียว" },
    ];
  }
  if (fieldKey === "allergies") {
    return [{ label: "ไม่เคยแพ้ยา", value: "ไม่เคยแพ้ยา" }];
  }
  if (fieldKey === "current_medications") {
    return [{ label: "ไม่ได้ใช้ยาอยู่", value: "ไม่ได้ใช้ยาอยู่" }];
  }
  return [];
}

// ครอบคลุมกว้างกว่าเดิม ตามหมวดทูลจริงใน tools/catalog.ts (อ่าน A1 / เขียนไม่ sensitive A2 / เขียน sensitive A3)
// ไม่ใช่ทุกทูลที่มี — เลือกตัวแทนแต่ละหมวดที่พนักงานพิมพ์ถามจริงบ่อยที่สุด
const EXAMPLE_GROUPS: Array<{ label: string; sensitive?: boolean; items: string[] }> = [
  {
    label: "ถามข้อมูล (อ่านอย่างเดียว)",
    items: [
      "ยอดขาย 7 วันล่าสุดเป็นยังไง",
      "สินค้าอะไรใกล้หมดบ้าง",
      "ออร์เดอร์ล่าสุดของลูกค้ามีอะไรบ้าง",
      "สินค้าขายดี 5 อันดับเดือนนี้คืออะไร",
      "การชำระเงินที่รอตรวจสอบมีกี่รายการ",
      "ใบสั่งซื้อที่ยังไม่ได้รับของมีอะไรบ้าง",
      "ลูกค้าเบอร์ 08x-xxx-xxxx เคยซื้ออะไรบ้าง",
      "สรุปภาพรวมร้านวันนี้ให้หน่อย",
      "มูลค่าสต็อกทั้งหมดตอนนี้เท่าไหร่",
      "เลขพัสดุของออร์เดอร์ #1234 คืออะไร",
      "ซัพพลายเออร์ที่มีในระบบมีใครบ้าง",
      "ใบสั่งซื้อ #PO-1234 มีรายการอะไรบ้าง",
    ],
  },
  {
    label: "สร้างไฟล์/รายงาน",
    items: [
      "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel",
      "Export inventory report เป็น PDF พร้อมสรุปให้ด้วย",
      "ขอรายงานกำไรไตรมาสนี้เป็นไฟล์ CSV",
      "สร้างใบเสนอราคา NIKE-001 ไซซ์ XL 10 ชิ้น",
      "ออกใบแจ้งหนี้ของออร์เดอร์ #1234",
      "พยากรณ์ยอดขาย 30 วันข้างหน้าของ NIKE-001",
      "สินค้าตัวไหนมีแนวโน้มของหมดเร็วที่สุด",
    ],
  },
  {
    label: "สั่งงานได้ทันที",
    items: [
      "สร้างใบสั่งซื้อจาก supplier ก. สินค้า NIKE-001 ไซซ์ XL 10 ชิ้น",
      "สร้างการจัดส่งออร์เดอร์ #1234 ด้วย Kerry",
      "ปักแท็ก VIP ให้ลูกค้าเบอร์ 08x-xxx-xxxx",
      "อัปเดตเลขพัสดุออร์เดอร์ #1234 เป็น TH1234567890XX",
      "รับของเข้าใบสั่งซื้อ #PO-1234 ครบตามจำนวน",
      "บันทึกโน้ตในแชทลูกค้าคนนี้ว่า ขอให้โทรกลับช่วงเย็น",
    ],
  },
  {
    label: "คำสั่งที่ต้องยืนยัน",
    sensitive: true,
    items: [
      "คืนเงินการชำระ (payment id ...)",
      "ปรับสต็อก NIKE-001 ไซซ์ XL ลบ 2 ชิ้น เพราะของเสีย",
      "ยกเลิกออร์เดอร์ #1234",
      "คืนสินค้าออร์เดอร์ #1234 (ลูกค้าส่งของกลับมา)",
      "รวมลูกค้าที่ซ้ำกัน 2 คนเป็นคนเดียว",
      "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel แล้วส่ง email owner@example.com",
      "สรุปสต็อกสินค้าเป็น CSV แล้วส่งอีเมลให้ warehouse@example.com",
      "ขอรายงานกำไรเดือนที่แล้วเป็น PDF ส่งให้ manager@example.com หน่อย",
    ],
  },
];
const EXAMPLE_COUNT = EXAMPLE_GROUPS.reduce((n, g) => n + g.items.length, 0);

// ปุ่มเริ่มด่วนใน empty state — เลือกมาสั้นๆ 3 อัน ให้กดแล้วเริ่มได้ทันทีโดยไม่ต้องเลื่อนไปหา sidebar/Drawer
const QUICK_START: Array<{ label: string; fill: string }> = [
  { label: "ยอดขาย 7 วันล่าสุด", fill: "ยอดขาย 7 วันล่าสุดเป็นยังไง" },
  { label: "สินค้าใกล้หมด", fill: "สินค้าอะไรใกล้หมดบ้าง" },
  { label: "สร้างรายงาน Excel", fill: "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel" },
  { label: "ส่งรายงานทางอีเมล", fill: "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel แล้วส่ง email owner@example.com" },
];

export default function Page() {
  const router = useRouter();
  const client = useApolloClient();
  const { data: meData } = useQuery(Q_ME);
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // ที่อยู่อีเมลที่แก้ไขได้ก่อนกด "ยืนยันส่ง" ของ proposal email_report — key = "bubbleIdx:propIdx"
  // เริ่มต้นจาก p.args.to ที่ AI เสนอมา แต่แก้ไขได้เสมอก่อนยิงจริง (ปลายทางเป็น free text ไม่ผ่านการยืนยันตัวตน)
  const [emailEdits, setEmailEdits] = useState<Record<string, string>>({});
  const [pharmacyMode, setPharmacyMode] = useState(false);
  const [pharmacySession, setPharmacySession] = useState<PharmacySession | null>(null);
  const [seedingQueue, setSeedingQueue] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const chatStorageKey = [
    "bms-assistant-chat-v1",
    meData?.bmsMe?.tenant?.id || "no-tenant",
    meData?.bmsMe?.id || "no-user",
  ].join(":");

  // โหลดแชทที่บันทึกไว้ตอน mount ครั้งเดียว — ต้องรอ mount ก่อน (localStorage ไม่มีบน server)
  // ไม่งั้น hydration mismatch; chatLoaded กันไม่ให้ effect เซฟทับค่าว่างก่อนโหลดเสร็จ
  useEffect(() => {
    try {
      const raw = localStorage.getItem(chatStorageKey);
      if (raw) setChat(JSON.parse(raw));
    } catch {
      // เก็บพัง (เช่น quota/JSON เพี้ยน) — เริ่มแชทใหม่เงียบๆ ดีกว่าทำหน้าอื่นพังไปด้วย
    } finally {
      setChatLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!chatLoaded) return;
    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(chat));
    } catch {
      // เต็ม/ปิด storage ไว้ — ปล่อยผ่าน ไม่ใช่ error ที่ควรขัดจังหวะการคุย
    }
  }, [chat, chatLoaded, chatStorageKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  // ปุ่ม "ข้อความล่าสุด" โผล่เฉพาะตอนผู้ใช้เลื่อนขึ้นไปดูของเก่าเอง (ไม่เกี่ยวกับ auto-scroll ตอนมีข้อความใหม่ด้านบน)
  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollLatest(distanceFromBottom > 120);
  };
  const scrollToLatest = () => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  };

  const copyText = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      message.error("คัดลอกไม่สำเร็จ — เบราว์เซอร์นี้อาจไม่รองรับ");
    }
  };

  const clearChat = () => {
    setChat([]);
    setPharmacySession(null);
    try {
      localStorage.removeItem(chatStorageKey);
    } catch {
      // ไม่มีผลต่อ state ในหน้า — เคลียร์ที่ setChat([]) ไปแล้ว
    }
  };

  const seedPharmacyQueue = async () => {
    setSeedingQueue(true);
    try {
      const { data } = await client.mutate({
        mutation: M_SEED_PHARMACY_QUEUE,
        variables: {
          protocolKey: pharmacySession?.protocolKey ?? null,
          answers: pharmacySession?.answers ?? null,
          transcript: chat.map((bubble) => ({
            role: bubble.role,
            text: bubble.text,
            createdAt: bubble.createdAt ?? null,
          })),
        },
      });
      if (!data?.bmsSeedPharmacyQueueDemo) throw new Error("seed failed");
      message.success("ส่งเคสจากบทสนทนานี้เข้าคิวเภสัชกรแล้ว");
      router.push("/admin/pharmacy-queue");
    } catch (e: any) {
      message.error(e?.message || "สร้างเคสเข้าคิวไม่สำเร็จ");
    } finally {
      setSeedingQueue(false);
    }
  };

  const pickExample = (ex: string) => {
    setText(ex);
    inputRef.current?.focus?.();
    setExamplesOpen(false); // ปิด drawer เสมอ (จอกว้างไม่เคยเปิด drawer นี้อยู่แล้ว ปิดซ้ำไม่มีผล)
  };

  const send = async (msg?: string) => {
    const m = (msg ?? text).trim();
    if (!m || sending) return;
    setSending(true);
    // history = สายก่อนหน้า ไม่รวมข้อความใหม่ และไม่รวมบับเบิล error (ไม่ใช่คำตอบจริงของ AI ครั้งก่อน)
    const history = chat.filter((b) => !b.error).map((b) => ({ role: b.role, text: b.text }));
    setChat((c) => [...c, { role: "user", text: m, createdAt: new Date().toISOString() }]);
    setText("");
    try {
      const { data } = pharmacyMode
        ? await client.mutate({
            mutation: M_PHARMACY_TEST,
            variables: { message: m, session: pharmacySession },
          })
        : await client.mutate({
            mutation: M_ASSISTANT,
            variables: { message: m, history },
          });
      const res = pharmacyMode ? data?.bmsPharmacyAssistantTest : data?.bmsAssistant;
      if (pharmacyMode) setPharmacySession(res?.session ?? null);
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: res?.reply ?? "—",
          createdAt: new Date().toISOString(),
          proposals: res?.proposals ?? [],
          trace: res?.trace ?? [],
          proposalStates: {},
        },
      ]);
    } catch (e: any) {
      message.error(e?.message || "เรียกผู้ช่วย AI ไม่สำเร็จ");
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: "ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ",
          createdAt: new Date().toISOString(),
          trace: [],
          error: true,
          retryText: m,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  // แทนที่บับเบิล error ตัวเดิมในตำแหน่งเดิม ไม่ดันข้อความผู้ใช้ซ้ำอีกแถว (ต่างจากพิมพ์คำถามเดิมส่งใหม่)
  const retry = async (idx: number) => {
    const bubble = chat[idx];
    if (!bubble?.retryText || sending) return;
    const m = bubble.retryText;
    setSending(true);
    // ประวัติที่ถูกต้องคือทุกอย่างก่อนข้อความผู้ใช้ที่ทำให้เกิด error นี้ (อยู่ตำแหน่ง idx-1 เสมอ ตาม send())
    const history = chat.slice(0, Math.max(idx - 1, 0)).filter((b) => !b.error).map((b) => ({ role: b.role, text: b.text }));
    try {
      const { data } = pharmacyMode
        ? await client.mutate({ mutation: M_PHARMACY_TEST, variables: { message: m, session: pharmacySession } })
        : await client.mutate({ mutation: M_ASSISTANT, variables: { message: m, history } });
      const res = pharmacyMode ? data?.bmsPharmacyAssistantTest : data?.bmsAssistant;
      if (pharmacyMode) setPharmacySession(res?.session ?? null);
      setChat((c) =>
        c.map((b, i) =>
          i === idx
            ? {
                role: "assistant",
                text: res?.reply ?? "—",
                createdAt: new Date().toISOString(),
                proposals: res?.proposals ?? [],
                trace: res?.trace ?? [],
                proposalStates: {},
              }
            : b
        )
      );
    } catch (e: any) {
      message.error(e?.message || "เรียกผู้ช่วย AI ไม่สำเร็จ");
      setChat((c) => c.map((b, i) => (i === idx ? { ...b, createdAt: new Date().toISOString() } : b)));
    } finally {
      setSending(false);
    }
  };

  const confirmProposal = async (bubbleIdx: number, propIdx: number, p: Proposal, argsOverride?: Record<string, unknown>) => {
    const entry = CONFIRM_MUTATIONS[p.mutation];
    if (!entry) {
      message.error(`ไม่รองรับการยืนยัน: ${p.mutation}`);
      return;
    }
    const args = argsOverride ? { ...p.args, ...argsOverride } : p.args;
    try {
      await client.mutate({ mutation: entry.doc, variables: entry.vars(args) });
      message.success(`ยืนยันแล้ว: ${p.summary}`);
      setChat((c) =>
        c.map((b, i) =>
          i === bubbleIdx ? { ...b, proposalStates: { ...b.proposalStates, [propIdx]: "done" } } : b
        )
      );
    } catch (e: any) {
      message.error(e?.message || "ยืนยันไม่สำเร็จ (อาจไม่มีสิทธิ์)");
    }
  };

  const dismissProposal = (bubbleIdx: number, propIdx: number) => {
    setChat((c) =>
      c.map((b, i) =>
        i === bubbleIdx ? { ...b, proposalStates: { ...b.proposalStates, [propIdx]: "dismissed" } } : b
      )
    );
  };

  // ใช้ร่วมกันทั้ง sidebar (จอกว้าง, โชว์ค้าง) และ Drawer (จอแคบ, เปิดตามสั่ง) — เนื้อหาชุดเดียว
  // ไม่ duplicate ป้องกันแก้ตัวอย่างที่นึงแล้วอีกที่ไม่ตรงกัน
  // แถวเดียว ตัด ellipsis ถ้ายาวเกิน (ดูชื่อเต็มจาก Tooltip) แทนปุ่มบล็อกที่ห่อ 2-3 บรรทัดแล้วสูงไม่เท่ากัน
  const exampleGroupsContent = (
    <Space direction="vertical" style={{ width: "100%" }} size={0}>
      {EXAMPLE_GROUPS.map((group) => (
        <div key={group.label}>
          <Text
            type="secondary"
            style={{
              display: "block",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              padding: "10px 10px 4px",
            }}
          >
            {group.label}
          </Text>
          {group.items.map((ex) => (
            <Tooltip key={ex} title={ex} placement="left" mouseEnterDelay={0.4}>
              <button
                onClick={() => pickExample(ex)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  color: "var(--app-text)",
                  borderRadius: 8,
                  padding: "9px 10px",
                  fontSize: 12.8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--app-surface-3, var(--app-surface-2))")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {group.sensitive && (
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: "#faad14", flex: "none" }} />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ex}
                </span>
                {group.sensitive && (
                  <Tag color="warning" style={{ margin: 0, fontSize: 9.5, flex: "none" }}>
                    ยืนยัน
                  </Tag>
                )}
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </Space>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 96px)", minHeight: 0 }}>
      {/* ไม่มี maxWidth ของตัวเอง — AdminLayoutClient's <Content> ให้ padding มาแล้ว
          ทุกหน้า admin (ตาม convention ของ /admin/orders ฯลฯ) เดิมหน้านี้ประกาศ maxWidth:1080
          เองด้วย ทำให้เหลือพื้นที่ว่างข้างขวาบนจอกว้างโดยไม่จำเป็น
          สูง = เต็มความสูงที่เหลือของ viewport ลบ header/alert/margin ด้านบนของหน้านี้เอง (ประมาณ 96px) */}
      <style jsx>{`
        .bms-assistant-typing-dot {
          display: inline-block;
          animation: bms-assistant-bounce 1.2s ease-in-out infinite;
        }
        @keyframes bms-assistant-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bms-assistant-typing-dot { animation: none; opacity: 0.8; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <Space align="center">
          <RobotOutlined style={{ fontSize: 22 }} />
          <Typography.Title level={4} style={{ margin: 0 }}>ผู้ช่วย AI (หลังบ้าน)</Typography.Title>
        </Space>
        <Space size={14}>
          <Tooltip title="บันทึกไว้ในเครื่องนี้อัตโนมัติ (เบราว์เซอร์นี้เท่านั้น ไม่ sync ข้ามอุปกรณ์)">
            <Text type="secondary" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              <SaveOutlined /> {!isMobile && "บันทึกไว้ในเครื่องนี้อัตโนมัติ"}
            </Text>
          </Tooltip>
          <Popconfirm
            title="ล้างประวัติแชททั้งหมดในเครื่องนี้?"
            description="กู้คืนไม่ได้"
            okText="ล้างแชท"
            okType="danger"
            cancelText="ยกเลิก"
            onConfirm={clearChat}
            disabled={chat.length === 0}
          >
            <Button size="small" icon={<DeleteOutlined />} disabled={chat.length === 0}>
              ล้างแชท
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="ถาม/สั่งงานด้วยภาษาพูดได้ — AI ดึงข้อมูลจริงและทำงานตามสิทธิ์ของคุณ งานที่กระทบเงิน/สต็อก/ลบข้อมูลจะเป็น 'คำขอ' ให้กดยืนยันเองก่อนเสมอ"
      />
      <Alert
        type={pharmacyMode ? "success" : "warning"}
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <Space wrap>
            <span>Pharmacy test mode</span>
            <Switch
              checked={pharmacyMode}
              onChange={(checked) => {
                setPharmacyMode(checked);
                setPharmacySession(null);
              }}
            />
          </Space>
        }
        description="เปิดเพื่อทดสอบ flow ซักอาการแบบร้านยาในหน้าผู้ช่วยนี้ โดยจะใช้ state ทดสอบแยกจาก assistant ปกติ"
      />

      {isMobile && (
        <Button
          block
          onClick={() => setExamplesOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <Space>
            <BulbOutlined style={{ color: "var(--app-primary)" }} />
            ตัวอย่างคำสั่ง
            <Tag color="blue" style={{ marginInlineStart: 0 }}>{EXAMPLE_COUNT}</Tag>
          </Space>
          <DownOutlined style={{ fontSize: 11, color: "var(--text-secondary)" }} />
        </Button>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 280px",
          gap: 16,
          alignItems: "stretch",
          flex: 1,
          minHeight: 0,
        }}
      >
      <Card
        style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}
        styles={{ body: { padding: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } }}
      >
        <div ref={logRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "16px 16px 6px", position: "relative" }}>
          {chat.length === 0 ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                textAlign: "center",
                padding: 20,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: "rgba(var(--app-primary-rgb), 0.12)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--app-primary)",
                  fontSize: 24,
                }}
              >
                <RobotOutlined />
              </div>
              <Typography.Text strong style={{ fontSize: 15 }}>ยังไม่มีบทสนทนา</Typography.Text>
              <Text type="secondary" style={{ fontSize: 13, maxWidth: 320 }}>
                {isMobile
                  ? "พิมพ์คำถามด้านล่าง หรือเริ่มจากตัวอย่างที่ใช้บ่อย"
                  : "พิมพ์คำถามด้านล่าง หรือเริ่มจากตัวอย่างที่ใช้บ่อยทางขวา"}
              </Text>
              <Space wrap size={8} style={{ justifyContent: "center" }}>
                {QUICK_START.map((q) => (
                  <Button key={q.fill} shape="round" size="small" onClick={() => pickExample(q.fill)}>
                    {q.label}
                  </Button>
                ))}
              </Space>
            </div>
          ) : (
            <>
            <Space direction="vertical" style={{ width: "100%" }} size={4}>
              {chat.map((b, i) => {
                // เส้นแบ่งวัน — ยืมธรรมเนียม Inbox มาตรงๆ เพราะแชทนี้เก็บถาวรใน localStorage แล้ว
                // (ไม่ใช่แชทที่หายตอนปิดแท็บ) เปิดมาอีกวันแล้วไม่มีตัวแบ่งจะดูเหมือนข้อความคนละวันปนกัน
                const prevDay = i > 0 && chat[i - 1].createdAt ? dayKey(chat[i - 1].createdAt!) : null;
                const curDay = b.createdAt ? dayKey(b.createdAt) : null;
                const showDaySep = curDay && curDay !== prevDay;
                return (
                  <div key={i}>
                    {showDaySep && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
                        <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
                        <Text style={{ fontSize: 11, fontWeight: 700, color: "var(--text-soft, var(--text-secondary))", whiteSpace: "nowrap" }}>
                          {dayLabel(b.createdAt!)}
                        </Text>
                        <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
                      </div>
                    )}
                    <div
                      style={{ textAlign: b.role === "user" ? "right" : "left", marginBottom: 10 }}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx((h) => (h === i ? null : h))}
                    >
                      <div style={{ display: "inline-flex", alignItems: "flex-end", gap: 6, maxWidth: "88%" }}>
                        <div
                          style={{
                            display: "inline-block",
                            textAlign: "left",
                            background: b.error
                              ? "rgba(255, 77, 79, 0.1)"
                              : b.role === "user"
                                ? "rgba(var(--app-primary-rgb), 0.12)"
                                : "var(--app-surface-2)",
                            border: b.error ? "1px solid rgba(255, 77, 79, 0.35)" : "1px solid var(--app-border)",
                            borderRadius: 10,
                            padding: "8px 12px",
                            order: b.role === "user" ? 1 : 0,
                          }}
                        >
                          <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {renderAssistantText(b.text)}
                          </Paragraph>
                        </div>
                        {b.role === "assistant" && !b.error && (
                          <Tooltip title={copiedIdx === i ? "คัดลอกแล้ว" : "คัดลอกข้อความนี้"}>
                            <Button
                              type="text"
                              size="small"
                              icon={copiedIdx === i ? <CheckOutlined style={{ color: "#52c41a" }} /> : <CopyOutlined />}
                              onClick={() => copyText(b.text, i)}
                              style={{
                                opacity: hoveredIdx === i || copiedIdx === i ? 1 : 0,
                                transition: "opacity 120ms ease",
                                color: "var(--text-secondary)",
                              }}
                            />
                          </Tooltip>
                        )}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <Text style={{ fontSize: 11, color: "var(--text-soft, var(--text-secondary))" }}>
                          {b.createdAt ? timeLabel(b.createdAt) : ""}
                          {b.error && (
                            <Text style={{ fontSize: 11, color: "#ff4d4f", fontWeight: 600, marginInlineStart: 6 }}>
                              · ส่งไม่สำเร็จ
                            </Text>
                          )}
                        </Text>
                      </div>
                      {b.error && (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => retry(i)}
                          disabled={sending}
                          style={{ marginTop: 4, fontSize: 11.5, color: "#ff4d4f", borderColor: "rgba(255,77,79,.35)" }}
                          >
                          ลองส่งอีกครั้ง
                        </Button>
                      )}

                  {/* proposal cards (A3) — email_report มี UI เฉพาะของมัน (แก้ปลายทางได้ + เตือนอีเมล
                      แปลกหน้า) เพราะปลายทางเป็น free text ที่ไม่ผ่านการยืนยันตัวตน ต่างจาก proposal อื่น
                      ที่พารามิเตอร์ทั้งหมดมาจากระบบที่รู้จักอยู่แล้ว (orderId/paymentId/sku ฯลฯ) */}
                  {(b.proposals ?? []).map((p, pi) => {
                    const state = b.proposalStates?.[pi];
                    if (p.tool === "email_report") {
                      const editKey = `${i}:${pi}`;
                      const toValue = emailEdits[editKey] ?? String(p.args.to ?? "");
                      const isKnown = p.args.isKnownRecipient === true;
                      const reportLabel = REPORT_TYPE_LABEL_TH[String(p.args.reportType)] ?? String(p.args.reportType ?? "");
                      return (
                        <Card
                          key={pi}
                          size="small"
                          style={{ marginTop: 8, maxWidth: "92%", borderColor: "#faad14", overflow: "hidden" }}
                          styles={{ body: { padding: 0 } }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(250,173,20,0.10)", borderBottom: "1px solid rgba(250,173,20,0.35)" }}>
                            <Tag color="orange" style={{ margin: 0 }}>ต้องยืนยัน</Tag>
                            <Text code style={{ fontSize: 11.5 }}>email_report</Text>
                          </div>
                          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                            <Text strong>{p.summary}</Text>

                            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--app-border)", background: "var(--app-surface-2)", borderRadius: 8, padding: "7px 11px", width: "fit-content" }}>
                              <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(26,138,82,0.12)", color: "#1a8a52", display: "grid", placeItems: "center", flex: "none" }}>
                                <FileExcelOutlined style={{ fontSize: 13 }} />
                              </div>
                              <div>
                                <div style={{ fontSize: 12.5, fontWeight: 600 }}>รายงาน{reportLabel} · {String(p.args.format ?? "")}</div>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>สร้างไฟล์เรียบร้อยแล้ว — ดาวน์โหลดเองได้ปกติแม้ยกเลิกคำขอนี้</div>
                              </div>
                            </div>

                            {state === undefined && (
                              <div
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  border: "1px solid var(--app-border)", borderRadius: 8, padding: "6px 10px",
                                }}
                              >
                                <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>ถึง</Text>
                                <Input
                                  size="small"
                                  variant="borderless"
                                  value={toValue}
                                  onChange={(e) => setEmailEdits((m) => ({ ...m, [editKey]: e.target.value }))}
                                  style={{ fontFamily: "monospace", fontSize: 12.5 }}
                                />
                              </div>
                            )}

                            {!isKnown && (
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", border: "1px solid rgba(255,77,79,.35)", background: "rgba(255,77,79,.08)", borderRadius: 8, padding: "8px 10px" }}>
                                <WarningOutlined style={{ color: "#ff4d4f", fontSize: 13, marginTop: 2 }} />
                                <Text style={{ fontSize: 12, color: "#ff4d4f" }}>
                                  <Text strong style={{ color: "#ff4d4f", fontSize: 12 }}>{toValue || "(ยังไม่ระบุ)"}</Text>{" "}
                                  ไม่ตรงกับอีเมลติดต่อที่บันทึกไว้ในระบบร้าน — ตรวจสอบก่อนกดยืนยัน
                                </Text>
                              </div>
                            )}

                            {state === "done" ? (
                              <Tag icon={<CheckOutlined />} color="success" style={{ width: "fit-content" }}>
                                ส่งไปที่ {toValue} แล้ว
                              </Tag>
                            ) : state === "dismissed" ? (
                              <Tag color="default" style={{ width: "fit-content" }}>ยกเลิกคำขอแล้ว — ไม่มีอีเมลถูกส่ง</Tag>
                            ) : (
                              <Space>
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<MailOutlined />}
                                  disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toValue.trim())}
                                  onClick={() => confirmProposal(i, pi, p, { to: toValue.trim() })}
                                >
                                  ยืนยันส่ง
                                </Button>
                                <Button size="small" icon={<CloseOutlined />} onClick={() => dismissProposal(i, pi)}>
                                  ยกเลิกคำขอ
                                </Button>
                              </Space>
                            )}
                          </div>
                        </Card>
                      );
                    }
                    return (
                      <Card
                        key={pi}
                        size="small"
                        style={{ marginTop: 8, maxWidth: "88%", borderColor: "#faad14" }}
                        styles={{ body: { padding: 12 } }}
                      >
                        <Space direction="vertical" style={{ width: "100%" }} size={6}>
                          <Space wrap>
                            <Tag color="orange">ต้องยืนยัน</Tag>
                            <Text code>{p.tool}</Text>
                          </Space>
                          <Text strong>{p.summary}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {p.mutation}({Object.entries(p.args || {})
                              .map(([k, v]) => `${k}: ${v === null ? "—" : v}`)
                              .join(", ")})
                          </Text>
                          {state === "done" ? (
                            <Tag icon={<CheckOutlined />} color="success">ยืนยันแล้ว</Tag>
                          ) : state === "dismissed" ? (
                            <Tag color="default">ยกเลิกคำขอแล้ว</Tag>
                          ) : (
                            <Space>
                              <Button
                                type="primary"
                                size="small"
                                icon={<CheckOutlined />}
                                onClick={() => confirmProposal(i, pi, p)}
                              >
                                ยืนยัน
                              </Button>
                              <Button size="small" icon={<CloseOutlined />} onClick={() => dismissProposal(i, pi)}>
                                ยกเลิก
                              </Button>
                            </Space>
                          )}
                        </Space>
                      </Card>
                    );
                  })}

                  {/* trace: เครื่องมือ (function/tool) จริงที่ AI เลือกเรียกใช้เพื่อตอบข้อความนี้ —
                      เช่น "generate_report" คือฟังก์ชันสร้างไฟล์รายงานที่ AI เพิ่งเรียกไป (ดูสรุปผลใน tooltip) */}
                  {b.role === "assistant" && (b.trace?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Space wrap size={4}>
                        <Tooltip title="เครื่องมือ (tool/function) ที่ AI เลือกเรียกใช้จริงเพื่อตอบข้อความนี้ — ชื่อในกล่องคือชื่อฟังก์ชันในระบบ">
                          <ToolOutlined style={{ color: "var(--text-secondary)", fontSize: 12 }} />
                        </Tooltip>
                        {b.trace!.map((t, ti) => (
                          <Tooltip
                            key={ti}
                            title={`เรียกฟังก์ชัน "${t.tool}" — ${t.ok ? `สำเร็จ${t.summary && t.summary !== "ok" ? `: ${t.summary}` : ""}` : `ไม่สำเร็จ: ${t.summary}`}`}
                          >
                            <Tag color={t.ok ? "blue" : "red"} style={{ fontSize: 11 }}>{t.tool}</Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    </div>
                  )}
                    </div>
                  </div>
                );
              })}
            </Space>

            {sending && (
              <div style={{ display: "flex", marginTop: 4 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: "var(--app-surface-2)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 10,
                    padding: "11px 14px",
                  }}
                >
                  <span className="bms-assistant-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-soft, var(--text-secondary))" }} />
                  <span className="bms-assistant-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-soft, var(--text-secondary))", animationDelay: "0.15s" }} />
                  <span className="bms-assistant-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-soft, var(--text-secondary))", animationDelay: "0.3s" }} />
                </div>
              </div>
            )}
            </>
          )}

          {showScrollLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              style={{
                position: "absolute",
                bottom: 8,
                right: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--app-text)",
                boxShadow: "0 8px 20px rgba(0,0,0,0.14)",
                cursor: "pointer",
              }}
            >
              <ArrowDownOutlined style={{ fontSize: 11 }} />
              ข้อความล่าสุด
            </button>
          )}
        </div>

        {/* composer เย็บเป็นส่วนเดียวกับการ์ดแชท (เส้นแบ่ง + พื้นหลังต่างเฉด) ไม่ใช่แถบลอยแยกที่มีช่องว่างเหมือนเดิม */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderTop: "1px solid var(--app-border)",
            background: "var(--app-surface-2)",
          }}
        >
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={() => send()}
            placeholder="พิมพ์คำถามหรือคำสั่ง เช่น 'ยอดขายเดือนนี้เท่าไหร่'"
            disabled={sending}
          />
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()}>
            ส่ง
          </Button>
        </div>

        {pharmacyMode && (
          <div
            style={{
              padding: "0 12px 12px",
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-surface-2)",
            }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
                <Text strong style={{ fontSize: 12.5 }}>Quick reply สำหรับโหมด pharmacy</Text>
                <Space wrap>
                  <Button size="small" onClick={() => setPharmacySession(null)}>
                    รีเซ็ตคำถาม
                  </Button>
                  <Button
                    size="small"
                    onClick={seedPharmacyQueue}
                    loading={seedingQueue}
                    disabled={!pharmacySession?.protocolKey || Object.keys(pharmacySession.answers ?? {}).length === 0}
                  >
                    ส่งเคสนี้เข้าคิว
                  </Button>
                </Space>
              </Space>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {getPharmacyQuickReplies(pharmacySession).length > 0 ? (
                  getPharmacyQuickReplies(pharmacySession).map((opt) => (
                    <Button
                      key={opt.value}
                      size="small"
                      onClick={() => send(opt.value)}
                      disabled={sending}
                      style={{
                        borderRadius: 999,
                        paddingInline: 14,
                        height: 34,
                      }}
                    >
                      {opt.label}
                    </Button>
                  ))
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    ยังไม่มี quick reply สำหรับสถานะนี้ ลองพิมพ์อาการหรือกด “สร้างเคสเข้าคิว” เพื่อเทสหน้า queue
                  </Text>
                )}
              </div>
            </Space>
          </div>
        )}
      </Card>

      {!isMobile && (
        <Card
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}
          styles={{ body: { padding: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } }}
        >
          <div
            style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid var(--app-border)",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div>
              <Space size={6}>
                <BulbOutlined style={{ color: "var(--app-primary)" }} />
                <Text strong style={{ fontSize: 13 }}>ตัวอย่างคำสั่ง</Text>
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5 }}>กดเพื่อใส่ลงช่องพิมพ์ทันที</Text>
              </div>
            </div>
            {chat.length > 0 && (
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                {chat.length} ข้อความ
              </Text>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>{exampleGroupsContent}</div>
        </Card>
      )}
      </div>

      {isMobile && (
        <Drawer
          placement="bottom"
          height="72vh"
          open={examplesOpen}
          onClose={() => setExamplesOpen(false)}
          title={
            <Space>
              <BulbOutlined style={{ color: "var(--app-primary)" }} />
              ตัวอย่างคำสั่ง
            </Space>
          }
          styles={{ body: { paddingTop: 8 } }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
            กดที่ตัวอย่างเพื่อใส่ลงช่องพิมพ์ได้ทันที
          </Text>
          {exampleGroupsContent}
        </Drawer>
      )}
    </div>
  );
}
