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
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph } = Typography;

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

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
  color: string;
};

const CHANNELS: ChannelModel[] = [
  {
    key: "line",
    label: "LINE OA",
    tokenSource: "LINE Developers Console",
    inbound: "ready",
    outbound: "push",
    color: "green",
  },
  {
    key: "facebook",
    label: "Facebook Messenger",
    tokenSource: "Meta App / Page",
    inbound: "ready",
    outbound: "push",
    color: "blue",
  },
  {
    key: "instagram",
    label: "Instagram DM",
    tokenSource: "Meta App / IG-linked Page",
    inbound: "ready",
    outbound: "push",
    color: "purple",
  },
  {
    key: "web",
    label: "Website Live Chat",
    tokenSource: "BMS widget",
    inbound: "owned",
    outbound: "response",
    color: "geekblue",
  },
  {
    key: "tiktok",
    label: "TikTok",
    tokenSource: "TikTok for Business",
    inbound: "inbound-only",
    outbound: "none",
    color: "magenta",
  },
  {
    key: "shopee",
    label: "Shopee",
    tokenSource: "Shopee Open Platform",
    inbound: "beta",
    outbound: "beta",
    color: "orange",
  },
  {
    key: "lazada",
    label: "Lazada",
    tokenSource: "Lazada Open Platform",
    inbound: "beta",
    outbound: "beta",
    color: "volcano",
  },
];

const HEALTH_META: Record<string, { color: string; weight: number }> = {
  connected: { color: "green", weight: 100 },
  token_expired: { color: "red", weight: 35 },
  webhook_failed: { color: "red", weight: 35 },
  rate_limited: { color: "gold", weight: 55 },
  no_events: { color: "gold", weight: 65 },
  send_failed: { color: "red", weight: 50 },
};

const HEALTH_LABEL_KEY: Record<string, string> = {
  connected: "admin_inbox_diagnostics.health_connected",
  token_expired: "admin_inbox_diagnostics.health_token_expired",
  webhook_failed: "admin_inbox_diagnostics.health_webhook_failed",
  rate_limited: "admin_inbox_diagnostics.health_rate_limited",
  no_events: "admin_inbox_diagnostics.health_no_events",
  send_failed: "admin_inbox_diagnostics.health_send_failed",
};

function healthLabel(status: string | undefined, t: TFunc) {
  const key = (status && HEALTH_LABEL_KEY[status]) || HEALTH_LABEL_KEY.connected;
  return t(key);
}

const INBOUND_META: Record<ChannelModel["inbound"], { color: string }> = {
  ready: { color: "green" },
  owned: { color: "geekblue" },
  "inbound-only": { color: "gold" },
  beta: { color: "orange" },
};

const INBOUND_LABEL_KEY: Record<ChannelModel["inbound"], string> = {
  ready: "admin_inbox_diagnostics.inbound_ready",
  owned: "admin_inbox_diagnostics.inbound_owned",
  "inbound-only": "admin_inbox_diagnostics.inbound_inbound_only",
  beta: "admin_inbox_diagnostics.inbound_beta",
};

function inboundLabel(value: ChannelModel["inbound"], t: TFunc) {
  return t(INBOUND_LABEL_KEY[value]);
}

const OUTBOUND_META: Record<ChannelModel["outbound"], { color: string }> = {
  push: { color: "green" },
  response: { color: "geekblue" },
  none: { color: "default" },
  beta: { color: "orange" },
};

const OUTBOUND_LABEL_KEY: Record<ChannelModel["outbound"], string> = {
  push: "admin_inbox_diagnostics.outbound_push",
  response: "admin_inbox_diagnostics.outbound_response",
  none: "admin_inbox_diagnostics.outbound_none",
  beta: "admin_inbox_diagnostics.outbound_beta",
};

function outboundLabel(value: ChannelModel["outbound"], t: TFunc) {
  return t(OUTBOUND_LABEL_KEY[value]);
}

function productionNoteFor(key: ChannelKey, t: TFunc) {
  return t(`admin_inbox_diagnostics.production_note_${key}`);
}

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
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!occurredAt) return <Text type="secondary">{t("admin_inbox_diagnostics.no_event_yet")}</Text>;
  const ms = Math.max(0, now - new Date(occurredAt).getTime());
  const seconds = Math.round(ms / 1000);
  return (
    <Text>
      {seconds < 60
        ? t("admin_inbox_diagnostics.seconds_ago", { seconds })
        : t("admin_inbox_diagnostics.minutes_ago", { minutes: Math.round(seconds / 60) })}
    </Text>
  );
}

export default function Page() {
  const { t } = useI18n();
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
        message.error(payload?.message || t("admin_inbox_diagnostics.emit_error_default"));
        return;
      }
      setLastProbe((prev: any) => (
        prev?.conversationId === payload.conversationId && typeof prev.latencyMs === "number"
          ? prev
          : { ...payload, channel, sentAt, status: "published" }
      ));
      message.success(payload.message || t("admin_inbox_diagnostics.emit_success_default"));
    } catch (err: any) {
      delete pendingProbeRef.current[conversationId];
      message.error(err?.message || t("admin_inbox_diagnostics.emit_error_default"));
    }
  }

  async function createInboxTestMessage(channel: string) {
    try {
      const res = await createDiagnosticMessage({ variables: { channel } });
      const payload = res.data?.bmsCreateInboxDiagnosticMessage;
      if (!payload?.ok) {
        message.error(payload?.message || t("admin_inbox_diagnostics.create_msg_error_default"));
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
      message.success(payload.message || t("admin_inbox_diagnostics.create_msg_success_default"));
    } catch (err: any) {
      message.error(err?.message || t("admin_inbox_diagnostics.create_msg_error_default"));
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
    return <Alert closable type="error" showIcon message={t("admin_inbox_diagnostics.load_permission_error")} description={meError.message} />;
  }

  if (!loadingMe && me && !isAllowed) {
    return (
      <Alert closable
        type="warning"
        showIcon
        message={t("admin_inbox_diagnostics.admin_only_title")}
        description={t("admin_inbox_diagnostics.admin_only_description")}
      />
    );
  }

  const columns: ColumnsType<ChannelModel> = [
    {
      title: t("admin_inbox_diagnostics.column_channel"),
      dataIndex: "label",
      render: (_value, row) => <Space direction="vertical" size={0}><Tag color={row.color}>{row.label}</Tag><Text type="secondary" style={{ fontSize: 12 }}>{row.tokenSource}</Text></Space>,
    },
    {
      title: t("admin_inbox_diagnostics.column_readiness"),
      key: "ready",
      render: (_value, row) => {
        const cfg = configFor(row.key, configs);
        const h = healthFor(row.key, health);
        const metaColor = HEALTH_META[h?.status]?.color ?? HEALTH_META.connected.color;
        const configured = row.key === "web" ? cfg?.active !== false : cfg?.has_token;
        return (
          <Space direction="vertical" size={2}>
            <Space wrap size={4}>
              <Tag color={configured ? "green" : "default"}>
                {configured ? t("admin_inbox_diagnostics.configured_tag") : t("admin_inbox_diagnostics.not_configured_tag")}
              </Tag>
              <Tag color={cfg?.active === false ? "default" : "blue"}>
                {cfg?.active === false ? t("admin_inbox_diagnostics.inactive_tag") : t("admin_inbox_diagnostics.active_tag")}
              </Tag>
              {configured && <Tag color={metaColor}>{healthLabel(h?.status, t)}</Tag>}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>{h?.status_detail || productionNoteFor(row.key, t)}</Text>
          </Space>
        );
      },
    },
    {
      title: t("admin_inbox_diagnostics.column_inbound"),
      dataIndex: "inbound",
      render: (value: keyof typeof INBOUND_META) => <Tag color={INBOUND_META[value].color}>{inboundLabel(value, t)}</Tag>,
    },
    {
      title: t("admin_inbox_diagnostics.column_outbound"),
      dataIndex: "outbound",
      render: (value: keyof typeof OUTBOUND_META) => <Tag color={OUTBOUND_META[value].color}>{outboundLabel(value, t)}</Tag>,
    },
    {
      title: t("admin_inbox_diagnostics.column_webhook"),
      key: "webhook",
      render: (_value, row) => <Text code copyable={!!tenant?.id}>{channelPath(row.key, tenant?.id)}</Text>,
    },
    {
      title: t("admin_inbox_diagnostics.column_last"),
      key: "last",
      render: (_value, row) => {
        const h = healthFor(row.key, health);
        const diag = localDiagnosticLatest[row.key] || diagnosticLatest[row.key];
        return (
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>{t("admin_inbox_diagnostics.in_real_label")} {fmtDate(h?.last_inbound_event_at)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_diagnostics.out_real_label")} {fmtDate(h?.last_outbound_success_at)}</Text>
            <Space size={4} wrap>
              <Text type={diag?.lastInboundAt ? undefined : "secondary"} style={{ fontSize: 12 }}>
                {t("admin_inbox_diagnostics.in_diag_label")} {fmtDate(diag?.lastInboundAt)}
              </Text>
              {diag?.conversationId && (
                <Link href={`/admin/inbox?c=${diag.conversationId}`}>
                  <Tag color="blue" style={{ cursor: "pointer" }}>{t("admin_inbox_diagnostics.open_tag")}</Tag>
                </Link>
              )}
            </Space>
          </Space>
        );
      },
    },
    {
      title: t("admin_inbox_diagnostics.column_probe"),
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
            {t("admin_inbox_diagnostics.emit_button")}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<MessageOutlined />}
            loading={creatingMessage}
            onClick={() => createInboxTestMessage(row.key)}
          >
            {t("admin_inbox_diagnostics.create_msg_button")}
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
            <ExperimentOutlined /> {t("admin_inbox_diagnostics.page_title")}
          </h2>
          <Text type="secondary">{t("admin_inbox_diagnostics.page_subtitle")}</Text>
        </Space>
        <Space wrap>
          <Link href="/admin/inbox"><Button icon={<MessageOutlined />}>{t("admin_inbox_diagnostics.open_inbox_button")}</Button></Link>
          <Link href="/admin/settings"><Button icon={<ApiOutlined />}>{t("admin_inbox_diagnostics.settings_button")}</Button></Link>
          <Button icon={<ReloadOutlined />} loading={loading || loadingMe} onClick={() => refetch()}>{t("admin_inbox_diagnostics.refresh_button")}</Button>
        </Space>
      </Space>

      {error && (
        <Alert closable type="error" showIcon style={{ marginBottom: 16 }} message={t("admin_inbox_diagnostics.load_diagnostics_error")} description={error.message} />
      )}

      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={tenant ? <>{t("admin_inbox_diagnostics.tenant_prefix")} <b>{tenant.name}</b> <Text code>{tenant.slug}</Text></> : t("admin_inbox_diagnostics.tenant_loading")}
        description={t("admin_inbox_diagnostics.tenant_info_description")}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t("admin_inbox_diagnostics.stat_readiness_title")} value={score} suffix="%" prefix={<CheckCircleOutlined />} />
            <Progress percent={score} showInfo={false} status={score >= 80 ? "success" : score >= 55 ? "normal" : "exception"} />
            <Text type="secondary">{t("admin_inbox_diagnostics.stat_readiness_desc")}</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t("admin_inbox_diagnostics.stat_ready_channels_title")} value={healthyCount} suffix={`/ ${CHANNELS.length}`} prefix={<ThunderboltOutlined />} />
            <Text type="secondary">{t("admin_inbox_diagnostics.stat_ready_channels_desc")}</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t("admin_inbox_diagnostics.stat_beta_title")} value={betaCount + 1} prefix={<WarningOutlined />} />
            <Text type="secondary">{t("admin_inbox_diagnostics.stat_beta_desc")}</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={15}>
          <Card
            title={t("admin_inbox_diagnostics.matrix_card_title")}
            extra={<Badge status={eventError ? "error" : "processing"} text={eventError ? t("admin_inbox_diagnostics.socket_error_label") : t("admin_inbox_diagnostics.listening_label")} />}
          >
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
          <Card title={t("admin_inbox_diagnostics.realtime_probe_card_title")} extra={<EventAge occurredAt={events[0]?.occurredAt} />}>
            <Alert closable
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("admin_inbox_diagnostics.safe_simulation_title")}
              description={t("admin_inbox_diagnostics.safe_simulation_desc")}
            />
            {lastCreatedMessage && (
              <Alert closable
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Space wrap>
                    <span>{t("admin_inbox_diagnostics.test_message_created_title")}</span>
                    <Tag color="blue">{lastCreatedMessage.channel}</Tag>
                    <Text code>{lastCreatedMessage.customerRef}</Text>
                  </Space>
                }
                description={
                  <Space wrap>
                    <Text>{t("admin_inbox_diagnostics.conversation_label")} <Text code>{String(lastCreatedMessage.conversationId).slice(0, 8)}</Text></Text>
                    <Link href={`/admin/inbox?c=${lastCreatedMessage.conversationId}`}>
                      <Button size="small" type="primary" icon={<MessageOutlined />}>{t("admin_inbox_diagnostics.open_in_inbox_button")}</Button>
                    </Link>
                  </Space>
                }
              />
            )}
            {lastProbe && (
              <Descriptions size="small" bordered column={1} style={{ marginBottom: 12 }}>
                <Descriptions.Item label={t("admin_inbox_diagnostics.last_probe_label")}>
                  <Space wrap>
                    <Tag color="blue">{lastProbe.channel}</Tag>
                    <Text code>{String(lastProbe.conversationId).slice(0, 18)}</Text>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={t("admin_inbox_diagnostics.status_label")}>
                  {typeof lastProbe.latencyMs === "number" ? (
                    <Tag color="green">{t("admin_inbox_diagnostics.delivered_in_ms", { ms: lastProbe.latencyMs })}</Tag>
                  ) : (
                    <Tag color="gold">{t("admin_inbox_diagnostics.published_waiting")}</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
            )}
            {eventError && (
              <Alert closable
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message={t("admin_inbox_diagnostics.subscription_error_title")}
                description={eventError.message}
              />
            )}
            {events.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("admin_inbox_diagnostics.no_inbox_event_desc")}
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

          <Card title={t("admin_inbox_diagnostics.event_path_card_title")} style={{ marginTop: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={-1}
              items={[
                { title: t("admin_inbox_diagnostics.step_webhook_title"), icon: <ApiOutlined />, description: t("admin_inbox_diagnostics.step_webhook_desc") },
                { title: t("admin_inbox_diagnostics.step_logconv_title"), icon: <SafetyOutlined />, description: t("admin_inbox_diagnostics.step_logconv_desc") },
                { title: t("admin_inbox_diagnostics.step_inboxchanged_title"), icon: eventError ? <DisconnectOutlined /> : <ThunderboltOutlined />, description: t("admin_inbox_diagnostics.step_inboxchanged_desc") },
                { title: t("admin_inbox_diagnostics.step_refetch_title"), icon: <ClockCircleOutlined />, description: t("admin_inbox_diagnostics.step_refetch_desc") },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title={t("admin_inbox_diagnostics.production_boundary_card_title")}>
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t("admin_inbox_diagnostics.boundary_real_send_label")}>{t("admin_inbox_diagnostics.boundary_real_send_value")}</Descriptions.Item>
          <Descriptions.Item label={t("admin_inbox_diagnostics.boundary_no_token_label")}>{t("admin_inbox_diagnostics.boundary_no_token_value")}</Descriptions.Item>
          <Descriptions.Item label={t("admin_inbox_diagnostics.boundary_inbound_only_label")}>{t("admin_inbox_diagnostics.boundary_inbound_only_value")}</Descriptions.Item>
          <Descriptions.Item label={t("admin_inbox_diagnostics.boundary_beta_label")}>{t("admin_inbox_diagnostics.boundary_beta_value")}</Descriptions.Item>
          <Descriptions.Item label={t("admin_inbox_diagnostics.boundary_admin_only_label")} span={2}>
            {t("admin_inbox_diagnostics.boundary_admin_only_desc")}
          </Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t("admin_inbox_diagnostics.next_steps_note")}
        </Paragraph>
      </Card>
    </div>
  );
}
