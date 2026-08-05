'use client';
import { gql, useApolloClient } from "@apollo/client";
import {
  Card, Input, Button, Space, Tag, Typography, Empty, Alert, message, Tooltip, Popconfirm, Drawer,
} from "antd";
import { useState, useRef, useEffect, Fragment } from "react";
import {
  SendOutlined, RobotOutlined, CheckOutlined, CloseOutlined, ToolOutlined, DownloadOutlined,
  DeleteOutlined, BulbOutlined, SaveOutlined, DownOutlined,
} from "@ant-design/icons";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

const { Text, Paragraph } = Typography;

// เก็บแชทไว้ในเครื่องนี้อัตโนมัติ (ต่อเบราว์เซอร์ ไม่ sync ข้ามอุปกรณ์/แท็บอื่น) — ผู้ใช้ต้องกด
// "ล้างแชท" เองเท่านั้น ไม่มีการล้างอัตโนมัติ (เช่น ตอนปิดแท็บ/refresh)
const CHAT_STORAGE_KEY = "bms-assistant-chat-v1";

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
};

type Proposal = { tool: string; mutation: string; args: any; summary: string };
type TraceEntry = { tool: string; ok: boolean; summary: string };
type Bubble = {
  role: "user" | "assistant";
  text: string;
  proposals?: Proposal[];
  trace?: TraceEntry[];
  /** สถานะ proposal ต่อ index: undefined=รอ, 'done'=ยืนยันแล้ว, 'dismissed'=ยกเลิก */
  proposalStates?: Record<number, "done" | "dismissed">;
};

const EXAMPLE_GROUPS: Array<{ label: string; sensitive?: boolean; items: string[] }> = [
  {
    label: "ถามข้อมูล (อ่านอย่างเดียว)",
    items: [
      "ยอดขาย 7 วันล่าสุดเป็นยังไง",
      "สินค้าอะไรใกล้หมดบ้าง",
      "ออร์เดอร์ล่าสุดของลูกค้ามีอะไรบ้าง",
    ],
  },
  {
    label: "สร้างไฟล์/รายงาน",
    items: [
      "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel",
      "Export inventory report เป็น PDF พร้อมสรุปให้ด้วย",
    ],
  },
  {
    label: "คำสั่งที่ต้องยืนยัน",
    sensitive: true,
    items: [
      "คืนเงินการชำระ (payment id ...)",
      "ปรับสต็อก NIKE-001 ไซซ์ XL ลบ 2 ชิ้น เพราะของเสีย",
    ],
  },
];
const EXAMPLE_COUNT = EXAMPLE_GROUPS.reduce((n, g) => n + g.items.length, 0);

export default function Page() {
  const client = useApolloClient();
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);

  // โหลดแชทที่บันทึกไว้ตอน mount ครั้งเดียว — ต้องรอ mount ก่อน (localStorage ไม่มีบน server)
  // ไม่งั้น hydration mismatch; chatLoaded กันไม่ให้ effect เซฟทับค่าว่างก่อนโหลดเสร็จ
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
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
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat));
    } catch {
      // เต็ม/ปิด storage ไว้ — ปล่อยผ่าน ไม่ใช่ error ที่ควรขัดจังหวะการคุย
    }
  }, [chat, chatLoaded]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  const clearChat = () => {
    setChat([]);
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // ไม่มีผลต่อ state ในหน้า — เคลียร์ที่ setChat([]) ไปแล้ว
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
    // history = สายก่อนหน้า (ไม่รวมข้อความใหม่)
    const history = chat.map((b) => ({ role: b.role, text: b.text }));
    setChat((c) => [...c, { role: "user", text: m }]);
    setText("");
    try {
      const { data } = await client.mutate({
        mutation: M_ASSISTANT,
        variables: { message: m, history },
      });
      const res = data?.bmsAssistant;
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: res?.reply ?? "—",
          proposals: res?.proposals ?? [],
          trace: res?.trace ?? [],
          proposalStates: {},
        },
      ]);
    } catch (e: any) {
      message.error(e?.message || "เรียกผู้ช่วย AI ไม่สำเร็จ");
      setChat((c) => [...c, { role: "assistant", text: "ขออภัย ระบบขัดข้อง ลองใหม่อีกครั้งนะครับ", trace: [] }]);
    } finally {
      setSending(false);
    }
  };

  const confirmProposal = async (bubbleIdx: number, propIdx: number, p: Proposal) => {
    const entry = CONFIRM_MUTATIONS[p.mutation];
    if (!entry) {
      message.error(`ไม่รองรับการยืนยัน: ${p.mutation}`);
      return;
    }
    try {
      await client.mutate({ mutation: entry.doc, variables: entry.vars(p.args) });
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
  const exampleGroupsContent = (
    <Space direction="vertical" style={{ width: "100%" }} size={14}>
      {EXAMPLE_GROUPS.map((group) => (
        <Space key={group.label} direction="vertical" style={{ width: "100%" }} size={6}>
          <Text
            type="secondary"
            style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}
          >
            {group.label}
          </Text>
          {group.items.map((ex) => (
            <Button
              key={ex}
              block
              style={{
                textAlign: "left",
                height: "auto",
                whiteSpace: "normal",
                padding: "8px 10px",
                borderLeft: group.sensitive ? "3px solid #faad14" : undefined,
              }}
              onClick={() => pickExample(ex)}
            >
              {ex}
              {group.sensitive && (
                <Tag color="warning" style={{ marginLeft: 6, fontSize: 10 }}>
                  ต้องยืนยัน
                </Tag>
              )}
            </Button>
          ))}
        </Space>
      ))}
    </Space>
  );

  return (
    <div style={{ maxWidth: isMobile ? 640 : 1080, margin: "0 auto", padding: 16 }}>
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
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 272px",
          gap: 16,
          alignItems: "start",
        }}
      >
      <div>
      <Card
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: 12 }}
      >
        <div ref={logRef} style={{ height: 460, overflowY: "auto", padding: 16 }}>
          {chat.length === 0 ? (
            <Empty
              description={
                isMobile
                  ? "ยังไม่มีบทสนทนา — ลองกดปุ่ม \"ตัวอย่างคำสั่ง\" ด้านบน หรือพิมพ์คำถามด้านล่าง"
                  : "ยังไม่มีบทสนทนา — ลองกดตัวอย่างด้านขวา หรือพิมพ์คำถามด้านล่าง"
              }
              style={{ marginTop: 120 }}
            />
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              {chat.map((b, i) => (
                <div key={i} style={{ textAlign: b.role === "user" ? "right" : "left" }}>
                  <div
                    style={{
                      display: "inline-block",
                      maxWidth: "88%",
                      textAlign: "left",
                      background:
                        b.role === "user"
                          ? "rgba(var(--app-primary-rgb), 0.12)"
                          : "var(--app-surface-2)",
                      border: "1px solid var(--app-border)",
                      borderRadius: 10,
                      padding: "8px 12px",
                    }}
                  >
                    <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {renderAssistantText(b.text)}
                    </Paragraph>
                  </div>

                  {/* proposal cards (A3) */}
                  {(b.proposals ?? []).map((p, pi) => {
                    const state = b.proposalStates?.[pi];
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
              ))}
            </Space>
          )}
        </div>
      </Card>

      <Space.Compact style={{ width: "100%" }}>
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
      </Space.Compact>
      </div>

      {!isMobile && (
        <Card size="small" title={<Space><BulbOutlined style={{ color: "var(--app-primary)" }} />ตัวอย่างคำสั่ง</Space>}>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
            กดที่ตัวอย่างเพื่อใส่ลงช่องพิมพ์ได้ทันที
          </Text>
          {exampleGroupsContent}
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
