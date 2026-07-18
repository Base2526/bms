'use client';

import { gql, useMutation, useQuery, useSubscription } from "@apollo/client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  message,
  Progress,
  Row,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DisconnectOutlined,
  ExperimentOutlined,
  MessageOutlined,
  ReloadOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";

const { Text, Paragraph } = Typography;

const Q_ME = gql`
  query {
    bmsMe {
      id
      role
      is_platform_admin
      tenant { id name slug plan }
    }
  }
`;

const Q_DIAGNOSTICS = gql`
  query {
    bmsMyTenant { id name slug }
    bmsChannels { channel active has_token has_secret access_token_masked channel_secret_masked }
    bmsChannelHealth {
      channel active status status_detail
      last_error_at last_inbound_event_at last_outbound_success_at last_checked_at
    }
    bmsInboxDiagnosticLatest {
      channel
      conversationId
      customerRef
      lastInboundAt
    }
  }
`;

const S_INBOX_CHANGED = gql`
  subscription {
    bmsInboxChanged { conversationId kind occurredAt }
  }
`;

const M_EMIT_DIAGNOSTIC_EVENT = gql`
  mutation ($channel: String!, $probeId: ID!) {
    bmsEmitInboxDiagnosticEvent(channel: $channel, probeId: $probeId) {
      ok
      message
      channel
      conversationId
      kind
      occurredAt
    }
  }
`;

const M_CREATE_DIAGNOSTIC_MESSAGE = gql`
  mutation ($channel: String!) {
    bmsCreateInboxDiagnosticMessage(channel: $channel) {
      ok
      message
      channel
      conversationId
      messageId
      customerRef
      occurredAt
    }
  }
`;

type ChannelKey = "line" | "facebook" | "instagram" | "web" | "tiktok" | "shopee" | "lazada";

type ChannelModel = {
  key: ChannelKey;
  label: string;
  tokenSource: string;
  inbound: "ready" | "owned" | "inbound-only" | "beta";
  outbound: "push" | "response" | "none" | "beta";
  credential: string;
  productionNote: string;
  color: string;
};

const CHANNELS: ChannelModel[] = [
  {
    key: "line",
    label: "LINE OA",
    tokenSource: "LINE Developers Console",
    inbound: "ready",
    outbound: "push",
    credential: "Access token + Channel secret",
    productionNote: "รับ webhook, verify signature, ส่งกลับผ่าน LINE API",
    color: "green",
  },
  {
    key: "facebook",
    label: "Facebook Messenger",
    tokenSource: "Meta App / Page",
    inbound: "ready",
    outbound: "push",
    credential: "Page access token + App secret",
    productionNote: "รับ challenge/webhook, verify X-Hub-Signature-256, ส่งผ่าน Graph API",
    color: "blue",
  },
  {
    key: "instagram",
    label: "Instagram DM",
    tokenSource: "Meta App / IG-linked Page",
    inbound: "ready",
    outbound: "push",
    credential: "Page access token + App secret",
    productionNote: "ใช้ Messenger Platform ร่วมกับ Meta Graph API",
    color: "purple",
  },
  {
    key: "web",
    label: "Website Live Chat",
    tokenSource: "BMS widget",
    inbound: "owned",
    outbound: "response",
    credential: "ไม่ต้องใช้ token",
    productionNote: "ตอบกลับใน HTTP response ของ widget และ log เข้า Inbox",
    color: "geekblue",
  },
  {
    key: "tiktok",
    label: "TikTok",
    tokenSource: "TikTok for Business",
    inbound: "inbound-only",
    outbound: "none",
    credential: "Token/secret ตาม config",
    productionNote: "รับเข้า Inbox ได้ แต่ send API ยังเป็น roadmap",
    color: "magenta",
  },
  {
    key: "shopee",
    label: "Shopee",
    tokenSource: "Shopee Open Platform",
    inbound: "beta",
    outbound: "beta",
    credential: "Partner/app config ยังต้อง verify",
    productionNote: "payload/signature ยังเป็น scaffold ห้ามนับ production-ready",
    color: "orange",
  },
  {
    key: "lazada",
    label: "Lazada",
    tokenSource: "Lazada Open Platform",
    inbound: "beta",
    outbound: "beta",
    credential: "App config ยังต้อง verify",
    productionNote: "payload/signature ยังเป็น scaffold ห้ามนับ production-ready",
    color: "volcano",
  },
];

const HEALTH_META: Record<string, { color: string; label: string; weight: number }> = {
  connected: { color: "green", label: "Connected", weight: 100 },
  token_expired: { color: "red", label: "Token expired", weight: 35 },
  webhook_failed: { color: "red", label: "Webhook failed", weight: 35 },
  rate_limited: { color: "gold", label: "Rate limited", weight: 55 },
  no_events: { color: "gold", label: "No events", weight: 65 },
  send_failed: { color: "red", label: "Send failed", weight: 50 },
};

const INBOUND_META = {
  ready: { color: "green", label: "รับจริง" },
  owned: { color: "geekblue", label: "BMS-owned" },
  "inbound-only": { color: "gold", label: "รับเข้าเท่านั้น" },
  beta: { color: "orange", label: "Beta" },
};

const OUTBOUND_META = {
  push: { color: "green", label: "ส่งกลับจริง" },
  response: { color: "geekblue", label: "ตอบผ่าน widget" },
  none: { color: "default", label: "ยังไม่ push" },
  beta: { color: "orange", label: "ยังไม่ verified" },
};

function fmtDate(v?: string | null) {
  if (!v) return "-";
  return new Date(v).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function channelPath(channel: string, tenantId?: string) {
  return tenantId ? `/api/bms/${channel}/webhook/${tenantId}` : "-";
}

function healthFor(channel: string, healthRows: any[]) {
  return healthRows.find((h) => h.channel === channel);
}

function configFor(channel: string, configRows: any[]) {
  return configRows.find((h) => h.channel === channel);
}

function readinessScore(channels: ChannelModel[], configs: any[], health: any[]) {
  if (!channels.length) return 0;
  const total = channels.reduce((sum, ch) => {
    const cfg = configFor(ch.key, configs);
    const h = healthFor(ch.key, health);
    if (ch.key === "web" && cfg?.active !== false) return sum + 100;
    if (ch.inbound === "beta") return sum + (cfg?.active && cfg?.has_token ? 45 : 20);
    if (!cfg?.has_token || cfg?.active === false) return sum + 25;
    return sum + (HEALTH_META[h?.status]?.weight ?? 80);
  }, 0);
  return Math.round(total / channels.length);
}

function EventAge({ occurredAt }: { occurredAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!occurredAt) return <Text type="secondary">ยังไม่มี event ใน session นี้</Text>;
  const ms = Math.max(0, now - new Date(occurredAt).getTime());
  const seconds = Math.round(ms / 1000);
  return <Text>{seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`}</Text>;
}

export default function Page() {
  const { data: meData, loading: loadingMe, error: meError } = useQuery(Q_ME, { fetchPolicy: "cache-and-network" });
  const me = meData?.bmsMe;
  const isAllowed = me?.role === "Administrator" || me?.is_platform_admin === true;

  const { data, loading, error, refetch } = useQuery(Q_DIAGNOSTICS, {
    skip: !isAllowed,
    fetchPolicy: "cache-and-network",
    pollInterval: isAllowed ? 30000 : 0,
  });

  const { data: eventData, error: eventError } = useSubscription(S_INBOX_CHANGED, {
    skip: !isAllowed,
  });

  const pendingProbeRef = useRef<Record<string, { channel: string; sentAt: number }>>({});
  const seenEventRef = useRef<Set<string>>(new Set());
  const [lastProbe, setLastProbe] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [emitDiagnosticEvent, { loading: emitting }] = useMutation(M_EMIT_DIAGNOSTIC_EVENT);
  const [createDiagnosticMessage, { loading: creatingMessage }] = useMutation(M_CREATE_DIAGNOSTIC_MESSAGE);
  const [lastCreatedMessage, setLastCreatedMessage] = useState<any>(null);
  const [localDiagnosticLatest, setLocalDiagnosticLatest] = useState<Record<string, any>>({});

  useEffect(() => {
    const event = eventData?.bmsInboxChanged;
    if (!event) return;
    const eventKey = `${event.conversationId}:${event.occurredAt}`;
    if (seenEventRef.current.has(eventKey)) return;
    seenEventRef.current.add(eventKey);

    const pending = pendingProbeRef.current[event.conversationId];
    const deliveredAt = Date.now();
    if (pending) {
      const latencyMs = deliveredAt - pending.sentAt;
      setLastProbe({ ...event, channel: pending.channel, latencyMs, deliveredAt });
      delete pendingProbeRef.current[event.conversationId];
    }
    setEvents((prev) => [{ ...event, channel: pending?.channel, latencyMs: pending ? deliveredAt - pending.sentAt : null }, ...prev].slice(0, 8));
  }, [eventData]);

  async function emitSafeEvent(channel: string) {
    const sentAt = Date.now();
    const probeId = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const conversationId = `diag:${channel}:${probeId}`;
    pendingProbeRef.current[conversationId] = { channel, sentAt };
    try {
      const res = await emitDiagnosticEvent({ variables: { channel, probeId } });
      const payload = res.data?.bmsEmitInboxDiagnosticEvent;
      if (!payload?.ok) {
        delete pendingProbeRef.current[conversationId];
        message.error(payload?.message || "ส่ง diagnostic event ไม่สำเร็จ");
        return;
      }
      setLastProbe((prev: any) => (
        prev?.conversationId === payload.conversationId && typeof prev.latencyMs === "number"
          ? prev
          : { ...payload, channel, sentAt, status: "published" }
      ));
      message.success(payload.message || "ส่ง diagnostic event แล้ว");
    } catch (err: any) {
      delete pendingProbeRef.current[conversationId];
      message.error(err?.message || "ส่ง diagnostic event ไม่สำเร็จ");
    }
  }

  async function createInboxTestMessage(channel: string) {
    try {
      const res = await createDiagnosticMessage({ variables: { channel } });
      const payload = res.data?.bmsCreateInboxDiagnosticMessage;
      if (!payload?.ok) {
        message.error(payload?.message || "สร้างข้อความทดสอบไม่สำเร็จ");
        return;
      }
      setLastCreatedMessage(payload);
      setLocalDiagnosticLatest((prev) => ({
        ...prev,
        [channel]: {
          channel,
          conversationId: payload.conversationId,
          customerRef: payload.customerRef,
          lastInboundAt: payload.occurredAt,
        },
      }));
      void refetch();
      message.success(payload.message || "สร้างข้อความทดสอบใน Inbox แล้ว");
    } catch (err: any) {
      message.error(err?.message || "สร้างข้อความทดสอบไม่สำเร็จ");
    }
  }

  const tenant = data?.bmsMyTenant ?? me?.tenant;
  const configs: any[] = data?.bmsChannels || [];
  const health: any[] = data?.bmsChannelHealth || [];
  const diagnosticLatest: Record<string, any> = Object.fromEntries(
    ((data?.bmsInboxDiagnosticLatest || []) as any[]).map((row) => [row.channel, row])
  );
  const score = useMemo(() => readinessScore(CHANNELS, configs, health), [configs, health]);
  const healthyCount = CHANNELS.filter((ch) => {
    const cfg = configFor(ch.key, configs);
    const h = healthFor(ch.key, health);
    if (ch.key === "web") return cfg?.active !== false;
    return cfg?.active && cfg?.has_token && (h?.status ?? "connected") === "connected";
  }).length;
  const betaCount = CHANNELS.filter((ch) => ch.inbound === "beta").length;

  if (meError) {
    return <Alert type="error" showIcon message="โหลดสิทธิ์ผู้ใช้ไม่ได้" description={meError.message} />;
  }

  if (!loadingMe && me && !isAllowed) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Realtime Diagnostics เปิดให้เฉพาะ Administrator"
        description="หน้านี้เห็นสถานะ token, webhook, channel health และ realtime event ของร้าน จึงจำกัดเฉพาะผู้ดูแลร้านหรือแอดมินแพลตฟอร์มเท่านั้น"
      />
    );
  }

  const columns: ColumnsType<ChannelModel> = [
    {
      title: "ช่องทาง",
      dataIndex: "label",
      render: (_value, row) => <Space direction="vertical" size={0}><Tag color={row.color}>{row.label}</Tag><Text type="secondary" style={{ fontSize: 12 }}>{row.tokenSource}</Text></Space>,
    },
    {
      title: "ความพร้อม",
      key: "ready",
      render: (_value, row) => {
        const cfg = configFor(row.key, configs);
        const h = healthFor(row.key, health);
        const meta = HEALTH_META[h?.status] ?? HEALTH_META.connected;
        const configured = row.key === "web" ? cfg?.active !== false : cfg?.has_token;
        return (
          <Space direction="vertical" size={2}>
            <Space wrap size={4}>
              <Tag color={configured ? "green" : "default"}>{configured ? "configured" : "not configured"}</Tag>
              <Tag color={cfg?.active === false ? "default" : "blue"}>{cfg?.active === false ? "inactive" : "active"}</Tag>
              {configured && <Tag color={meta.color}>{meta.label}</Tag>}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>{h?.status_detail || row.productionNote}</Text>
          </Space>
        );
      },
    },
    {
      title: "รับเข้า",
      dataIndex: "inbound",
      render: (value: keyof typeof INBOUND_META) => <Tag color={INBOUND_META[value].color}>{INBOUND_META[value].label}</Tag>,
    },
    {
      title: "ตอบกลับ",
      dataIndex: "outbound",
      render: (value: keyof typeof OUTBOUND_META) => <Tag color={OUTBOUND_META[value].color}>{OUTBOUND_META[value].label}</Tag>,
    },
    {
      title: "Webhook",
      key: "webhook",
      render: (_value, row) => <Text code copyable={!!tenant?.id}>{channelPath(row.key, tenant?.id)}</Text>,
    },
    {
      title: "ล่าสุด",
      key: "last",
      render: (_value, row) => {
        const h = healthFor(row.key, health);
        const diag = localDiagnosticLatest[row.key] || diagnosticLatest[row.key];
        return (
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>IN real: {fmtDate(h?.last_inbound_event_at)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>OUT real: {fmtDate(h?.last_outbound_success_at)}</Text>
            <Space size={4} wrap>
              <Text type={diag?.lastInboundAt ? undefined : "secondary"} style={{ fontSize: 12 }}>
                IN diag: {fmtDate(diag?.lastInboundAt)}
              </Text>
              {diag?.conversationId && (
                <Link href={`/admin/inbox?c=${diag.conversationId}`}>
                  <Tag color="blue" style={{ cursor: "pointer" }}>open</Tag>
                </Link>
              )}
            </Space>
          </Space>
        );
      },
    },
    {
      title: "Probe",
      key: "probe",
      fixed: "right",
      render: (_value, row) => (
        <Space direction="vertical" size={6}>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={emitting}
            onClick={() => emitSafeEvent(row.key)}
          >
            Emit
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<MessageOutlined />}
            loading={creatingMessage}
            onClick={() => createInboxTestMessage(row.key)}
          >
            Create Msg
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1500 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <Space direction="vertical" size={2}>
          <h2 style={{ margin: 0 }}>
            <ExperimentOutlined /> Realtime Diagnostics
          </h2>
          <Text type="secondary">ตรวจความพร้อม inbox realtime ครบทุกช่องทาง โดยไม่ยิงข้อความทดสอบออกไปหาลูกค้าจริง</Text>
        </Space>
        <Space wrap>
          <Link href="/admin/inbox"><Button icon={<MessageOutlined />}>เปิด Inbox</Button></Link>
          <Link href="/admin/settings"><Button icon={<ApiOutlined />}>Settings</Button></Link>
          <Button icon={<ReloadOutlined />} loading={loading || loadingMe} onClick={() => refetch()}>Refresh</Button>
        </Space>
      </Space>

      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="โหลดข้อมูล diagnostics ไม่ได้" description={error.message} />
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={tenant ? <>Tenant: <b>{tenant.name}</b> <Text code>{tenant.slug}</Text></> : "กำลังโหลด tenant"}
        description="IN/OUT real มาจากเหตุการณ์ platform จริงใน Channel Health ส่วน IN diag มาจากปุ่ม Create Msg สำหรับทดสอบว่า DB write แล้ว Inbox realtime ขยับทันทีไหม"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Readiness score" value={score} suffix="%" prefix={<CheckCircleOutlined />} />
            <Progress percent={score} showInfo={false} status={score >= 80 ? "success" : score >= 55 ? "normal" : "exception"} />
            <Text type="secondary">ประเมินจาก config, active switch และ channel health</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Ready channels" value={healthyCount} suffix={`/ ${CHANNELS.length}`} prefix={<ThunderboltOutlined />} />
            <Text type="secondary">LINE/Meta/Web ที่พร้อมใช้งานจริงควรอยู่ในกลุ่มนี้</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Beta / limited" value={betaCount + 1} prefix={<WarningOutlined />} />
            <Text type="secondary">TikTok inbound-only + Shopee/Lazada beta ต้องแยกจาก production-ready</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={15}>
          <Card title="Channel Capability Matrix" extra={<Badge status={eventError ? "error" : "processing"} text={eventError ? "Socket error" : "Listening"} />}>
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              columns={columns}
              dataSource={CHANNELS}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="Realtime Probe" extra={<EventAge occurredAt={events[0]?.occurredAt} />}>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message="Safe simulation"
              description="Emit = ทดสอบ realtime signal อย่างเดียว ไม่เขียน DB · Create Msg = สร้างข้อความ diagnostic ใน Inbox จริง แต่ไม่ส่งข้อความออก platform ใด ๆ"
            />
            {lastCreatedMessage && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Space wrap>
                    <span>สร้างข้อความทดสอบแล้ว</span>
                    <Tag color="blue">{lastCreatedMessage.channel}</Tag>
                    <Text code>{lastCreatedMessage.customerRef}</Text>
                  </Space>
                }
                description={
                  <Space wrap>
                    <Text>conversation: <Text code>{String(lastCreatedMessage.conversationId).slice(0, 8)}</Text></Text>
                    <Link href={`/admin/inbox?c=${lastCreatedMessage.conversationId}`}>
                      <Button size="small" type="primary" icon={<MessageOutlined />}>เปิดใน Inbox</Button>
                    </Link>
                  </Space>
                }
              />
            )}
            {lastProbe && (
              <Descriptions size="small" bordered column={1} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="ล่าสุด">
                  <Space wrap>
                    <Tag color="blue">{lastProbe.channel}</Tag>
                    <Text code>{String(lastProbe.conversationId).slice(0, 18)}</Text>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="สถานะ">
                  {typeof lastProbe.latencyMs === "number" ? (
                    <Tag color="green">delivered in {lastProbe.latencyMs}ms</Tag>
                  ) : (
                    <Tag color="gold">published, waiting for subscription</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
            )}
            {eventError && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message="Subscription ต่อไม่สำเร็จ"
                description={eventError.message}
              />
            )}
            {events.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="ยังไม่มี inbox event ใน session นี้"
              />
            ) : (
              <Timeline
                items={events.map((event) => ({
                  color: event.kind === "MESSAGES_CHANGED" ? "blue" : "gray",
                  children: (
                    <Space direction="vertical" size={0}>
                      <Space wrap size={6}>
                        <Tag color="blue">{event.kind}</Tag>
                        {event.channel && <Tag color="purple">{event.channel}</Tag>}
                        <Text code>{String(event.conversationId).slice(0, 8)}</Text>
                        {typeof event.latencyMs === "number" && <Tag color="green">{event.latencyMs}ms</Tag>}
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(event.occurredAt)}</Text>
                    </Space>
                  ),
                }))}
              />
            )}
          </Card>

          <Card title="Event Path" style={{ marginTop: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={-1}
              items={[
                { title: "Webhook receives message", icon: <ApiOutlined />, description: "ทุกช่องทางเข้า route ต่อ tenant" },
                { title: "logConversation commits", icon: <SafetyOutlined />, description: "DB เป็น source of truth ก่อน publish event" },
                { title: "bmsInboxChanged", icon: eventError ? <DisconnectOutlined /> : <ThunderboltOutlined />, description: "event มีแค่ conversationId/kind/time ไม่ส่งข้อความลูกค้า" },
                { title: "Inbox refetches", icon: <ClockCircleOutlined />, description: "list refresh ทันที, active chat coalesce, 20s poll เป็น fallback" },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Production Boundary">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="ใช้ส่งกลับจริง">LINE, Facebook Messenger, Instagram DM</Descriptions.Item>
          <Descriptions.Item label="ไม่ต้องใช้ token">Website Live Chat</Descriptions.Item>
          <Descriptions.Item label="รับเข้าแต่ยังไม่ push">TikTok</Descriptions.Item>
          <Descriptions.Item label="Beta scaffold">Shopee, Lazada</Descriptions.Item>
          <Descriptions.Item label="Admin-only" span={2}>
            หน้านี้ซ่อนในเมนูและกันหน้าโดย role: เฉพาะ Administrator หรือ platform admin ก่อนโหลดข้อมูล channel diagnostics
          </Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          รอบถัดไปถ้าจะทำให้ครบจริง ค่อยเพิ่ม safe simulation endpoint แบบ tenant-scoped สำหรับยิง invalidation event ปลอม โดยไม่ส่ง webhook ออก platform และไม่สร้างข้อความลูกค้าจริง
        </Paragraph>
      </Card>
    </div>
  );
}
