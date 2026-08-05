'use client';
import { gql, useApolloClient } from "@apollo/client";
import {
  Card, Input, Button, Space, Tag, Typography, Empty, Alert, message, Tooltip,
} from "antd";
import { useState, useRef, useEffect, Fragment } from "react";
import {
  SendOutlined, RobotOutlined, CheckOutlined, CloseOutlined, ToolOutlined, DownloadOutlined,
} from "@ant-design/icons";

const { Text, Paragraph } = Typography;

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

const EXAMPLES = [
  "ยอดขาย 7 วันล่าสุดเป็นยังไง",
  "สินค้าอะไรใกล้หมดบ้าง",
  "ออร์เดอร์ล่าสุดของลูกค้ามีอะไรบ้าง",
  "คืนเงินการชำระ (payment id ...)",
];

export default function Page() {
  const client = useApolloClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState<Bubble[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

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

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 16 }}>
      <Space align="center" style={{ marginBottom: 8 }}>
        <RobotOutlined style={{ fontSize: 22 }} />
        <Typography.Title level={4} style={{ margin: 0 }}>ผู้ช่วย AI (หลังบ้าน)</Typography.Title>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="ถาม/สั่งงานด้วยภาษาพูดได้ — AI ดึงข้อมูลจริงและทำงานตามสิทธิ์ของคุณ งานที่กระทบเงิน/สต็อก/ลบข้อมูลจะเป็น 'คำขอ' ให้กดยืนยันเองก่อนเสมอ"
      />

      <Card
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: 12 }}
      >
        <div ref={logRef} style={{ height: 460, overflowY: "auto", padding: 16 }}>
          {chat.length === 0 ? (
            <Empty description="ยังไม่มีบทสนทนา" style={{ marginTop: 120 }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                {EXAMPLES.map((ex) => (
                  <Button key={ex} size="small" onClick={() => send(ex)}>{ex}</Button>
                ))}
              </Space>
            </Empty>
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
  );
}
