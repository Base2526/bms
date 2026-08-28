'use client';

import { gql, useApolloClient, useQuery } from "@apollo/client";
import { Button, Drawer, Input, Space, Tag, Typography, message as toast } from "antd";
import { CheckOutlined, CloseOutlined, LinkOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18nContext";
import { WORK_ASSISTANT_CONFIRM_MUTATIONS } from "./confirmMutations";

const WORK_ASSISTANT = gql`
  mutation BmsWorkAssistant($input: BmsWorkAssistantInput!) {
    bmsWorkAssistant(input: $input) {
      reply
      answerType
      citations { kind id title summary path status accessible missingPermissions accessRequirement accessNote }
      links { label path }
      proposals { tool mutation args summary }
      trace { tool ok summary }
    }
  }
`;

const Q_WORK_ASSISTANT_ACTOR = gql`
  query WorkAssistantActor { bmsMe { id tenant { id } } }
`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Proposal = { tool: string; mutation: string; args: any; summary: string };
type Citation = {
  kind: string; id: string; title: string; summary: string; path?: string | null;
  status?: string | null; accessible: boolean; missingPermissions: string[];
  accessRequirement: string; accessNote?: string | null;
};
type AssistantLink = { label: string; path: string };
type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  answerType?: string;
  citations?: Citation[];
  links?: AssistantLink[];
  proposals?: Proposal[];
  proposalStates?: Record<number, "done" | "dismissed">;
};

const PAGE_ID_BY_SEGMENT: Record<string, string> = {
  dashboard: "dashboard", inbox: "inbox", products: "products", orders: "orders",
  payment: "payments", shipment: "shipping", purchase: "purchase", customers: "customers",
  coupons: "coupons", loyalty: "loyalty", reports: "reports", users: "users",
  "pos-manual": "pos", "pos-devices": "pos", "pos-readiness": "pos",
  "pharmacy-manual": "pharmacy", "pharmacy-queue": "pharmacy",
  "system-health": "system-health",
};

function pageIdFromPath(pathname: string): string | null {
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  return PAGE_ID_BY_SEGMENT[segment] ?? (segment || null);
}

function persisted(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ role, text, answerType, citations, links }) => ({ role, text, answerType, citations, links }));
}

export default function WorkAssistantDrawer() {
  const pathname = usePathname();
  const excluded = pathname === "/admin/login" || pathname === "/admin/assistant";
  const { lang } = useI18n();
  const en = lang === "en";
  const client = useApolloClient();
  const { data: actorData } = useQuery(Q_WORK_ASSISTANT_ACTOR, { fetchPolicy: "cache-first", skip: excluded });
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [emailEdits, setEmailEdits] = useState<Record<string, string>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pageId = pageIdFromPath(pathname);
  const storageKey = useMemo(() => {
    const tenantId = actorData?.bmsMe?.tenant?.id;
    const userId = actorData?.bmsMe?.id;
    return tenantId && userId ? `bms-work-assistant-v1:${tenantId}:${userId}` : null;
  }, [actorData]);

  useEffect(() => {
    if (!storageKey || loadedKey === storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setMessages(raw ? JSON.parse(raw) : []);
    } catch {
      setMessages([]);
    }
    setLoadedKey(storageKey);
  }, [loadedKey, storageKey]);

  useEffect(() => {
    if (!storageKey || loadedKey !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(persisted(messages).slice(-40))); } catch { /* local history is best-effort */ }
  }, [loadedKey, messages, storageKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  if (excluded) return null;

  const send = async (preset?: string) => {
    const text = String(preset ?? input).trim();
    if (!text || sending) return;
    const history = messages.map((item) => ({ role: item.role, text: item.text })).slice(-10);
    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const { data } = await client.mutate({
        mutation: WORK_ASSISTANT,
        variables: { input: { message: text, history, currentPath: pathname, pageId, locale: en ? "en" : "th" } },
      });
      const result = data?.bmsWorkAssistant;
      setMessages((current) => [...current, {
        role: "assistant",
        text: result?.reply || "—",
        answerType: result?.answerType,
        citations: result?.citations || [],
        links: result?.links || [],
        proposals: result?.proposals || [],
      }]);
    } catch (error: any) {
      const fallback = error?.message || (en ? "The assistant is temporarily unavailable." : "ผู้ช่วยใช้งานไม่ได้ชั่วคราว");
      setMessages((current) => [...current, { role: "assistant", text: fallback }]);
    } finally {
      setSending(false);
    }
  };

  const setProposalState = (messageIndex: number, proposalIndex: number, state: "done" | "dismissed") => {
    setMessages((current) => current.map((item, index) => index === messageIndex
      ? { ...item, proposalStates: { ...(item.proposalStates ?? {}), [proposalIndex]: state } }
      : item));
  };

  const confirmProposal = async (
    proposal: Proposal,
    messageIndex: number,
    proposalIndex: number,
    argsOverride?: Record<string, unknown>
  ) => {
    const config = WORK_ASSISTANT_CONFIRM_MUTATIONS[proposal.mutation];
    if (!config) {
      toast.error(en ? "This confirmation is not supported here." : "ยังไม่รองรับการยืนยันรายการนี้ใน Drawer");
      return;
    }
    const args = argsOverride ? { ...proposal.args, ...argsOverride } : proposal.args;
    try {
      await client.mutate({ mutation: config.doc, variables: config.vars(args) });
      setProposalState(messageIndex, proposalIndex, "done");
      toast.success(en ? "Confirmed" : "ยืนยันแล้ว");
    } catch (error: any) {
      toast.error(error?.message || (en ? "Confirmation failed." : "ยืนยันไม่สำเร็จ"));
    }
  };

  const suggestions = en
    ? ["What can I do on this page?", "What can my account access?", "Can BMS export PDF or Excel?"]
    : ["หน้านี้ใช้งานอย่างไร", "บัญชีฉันทำอะไรได้บ้าง", "ระบบ export PDF หรือ Excel ได้ไหม"];

  return (
    <>
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<RobotOutlined />}
        aria-label={en ? "Open work assistant" : "เปิดผู้ช่วยการทำงาน"}
        onClick={() => setOpen(true)}
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 40, boxShadow: "0 8px 24px rgba(0,0,0,.22)" }}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="min(480px, 100vw)"
        title={en ? "Work Assistant" : "ผู้ช่วยการทำงาน"}
        styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
      >
        <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {messages.length === 0 ? (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                {en ? "Ask how to use BMS, what the system supports, live shop information, or actions allowed by your access." : "ถามวิธีใช้ ความสามารถของระบบ ข้อมูลร้านจริง หรือสั่งงานตามสิทธิ์ของคุณได้จากจุดเดียว"}
              </Typography.Text>
              <Space wrap>{suggestions.map((item) => <Button key={item} size="small" onClick={() => send(item)}>{item}</Button>)}</Space>
            </Space>
          ) : null}
          {messages.map((item, messageIndex) => (
            <div key={messageIndex} style={{ display: "flex", justifyContent: item.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
              <div style={{ maxWidth: "92%", borderRadius: 14, padding: "10px 12px", background: item.role === "user" ? "var(--app-primary, #1677ff)" : "var(--app-surface-muted, #f5f5f5)", color: item.role === "user" ? "#fff" : "var(--app-text)", whiteSpace: "pre-wrap" }}>
                <div>{item.text}</div>
                {(item.citations?.length ?? 0) > 0 ? (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--app-border, #ddd)" }}>
                    {item.citations!.slice(0, 3).map((citation) => (
                      <div key={citation.id} style={{ marginBottom: 6, fontSize: 12 }}>
                        <Space size={4} wrap>
                          <Tag color={citation.accessible ? "blue" : "default"}>{citation.status || citation.kind}</Tag>
                          <Typography.Text strong>{citation.title}</Typography.Text>
                        </Space>
                        <div style={{ color: "var(--app-text-secondary, #777)" }}>{citation.summary}</div>
                        {!citation.accessible ? <div>{citation.missingPermissions.length
                          ? `${en ? "Missing access: " : "ขาดสิทธิ์: "}${citation.missingPermissions.join(", ")}`
                          : en ? "This page is restricted to administrators." : "หน้านี้จำกัดเฉพาะผู้ดูแลระบบ"}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {(item.links?.length ?? 0) > 0 ? (
                  <Space wrap style={{ marginTop: 6 }}>
                    {item.links!.map((link) => <Link key={link.path} href={link.path} onClick={() => setOpen(false)}><Button size="small" icon={<LinkOutlined />}>{link.label}</Button></Link>)}
                  </Space>
                ) : null}
                {item.proposals?.map((proposal, proposalIndex) => {
                  const state = item.proposalStates?.[proposalIndex];
                  const isEmailReport = proposal.mutation === "bmsEmailReport";
                  const editKey = `${messageIndex}:${proposalIndex}`;
                  const toValue = isEmailReport
                    ? emailEdits[editKey] ?? String(proposal.args?.to ?? "")
                    : "";
                  const recipientValid = EMAIL_RE.test(toValue.trim());
                  return (
                    <div key={`${proposal.tool}-${proposalIndex}`} style={{ marginTop: 10, padding: 10, border: "1px solid #faad14", borderRadius: 10 }}>
                      <Tag color="orange">{en ? "Confirmation required" : "ต้องยืนยัน"}</Tag>
                      <div style={{ margin: "6px 0" }}>{proposal.summary}</div>
                      {/*
                        The summary is model prose. What actually executes is the mutation and its
                        server-composed arguments, so an informed confirmation has to show them —
                        the full-page assistant does the same.
                      */}
                      <div style={{ fontSize: 11.5, fontFamily: "monospace", color: "var(--app-text-secondary, #777)", wordBreak: "break-word", marginBottom: 6 }}>
                        {proposal.mutation}({Object.entries(proposal.args || {})
                          .map(([key, value]) => `${key}: ${value === null || value === undefined ? "—" : String(value)}`)
                          .join(", ")})
                      </div>
                      {isEmailReport && !state ? (
                        <div style={{ marginBottom: 6 }}>
                          <Input
                            size="small"
                            addonBefore={en ? "To" : "ถึง"}
                            value={toValue}
                            status={recipientValid ? undefined : "error"}
                            onChange={(event) => setEmailEdits((current) => ({ ...current, [editKey]: event.target.value }))}
                          />
                          {proposal.args?.isKnownRecipient === false ? (
                            <div style={{ color: "#ff4d4f", fontSize: 12, marginTop: 4 }}>
                              {en
                                ? "This address has not received a report from this shop before. Check it before sending."
                                : "อีเมลนี้ไม่เคยรับรายงานของร้านนี้มาก่อน ตรวจสอบก่อนส่ง"}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {state ? <Tag color={state === "done" ? "success" : "default"}>{state === "done" ? (en ? "Confirmed" : "ยืนยันแล้ว") : (en ? "Dismissed" : "ยกเลิกแล้ว")}</Tag> : (
                        <Space>
                          <Button
                            size="small"
                            type="primary"
                            icon={<CheckOutlined />}
                            disabled={isEmailReport && !recipientValid}
                            onClick={() => confirmProposal(
                              proposal,
                              messageIndex,
                              proposalIndex,
                              isEmailReport ? { to: toValue.trim() } : undefined
                            )}
                          >{en ? "Confirm" : "ยืนยัน"}</Button>
                          <Button size="small" icon={<CloseOutlined />} onClick={() => setProposalState(messageIndex, proposalIndex, "dismissed")}>{en ? "Dismiss" : "ยกเลิก"}</Button>
                        </Space>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {sending ? <Typography.Text type="secondary">{en ? "Checking verified information…" : "กำลังตรวจข้อมูลที่ยืนยันได้…"}</Typography.Text> : null}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--app-border, #ddd)" }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input.TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); send(); } }}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={en ? "Ask about this page or the whole system" : "ถามเกี่ยวกับหน้านี้หรือทั้งระบบ"}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()} />
          </Space.Compact>
        </div>
      </Drawer>
    </>
  );
}
