'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, Switch, message, Alert, Typography, Divider, Form, Steps, Table, Select } from "antd";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ReloadOutlined, LinkOutlined, CopyOutlined, KeyOutlined, SaveOutlined, PoweroffOutlined, WarningOutlined, ClockCircleOutlined, PlayCircleOutlined, RobotOutlined, DeleteOutlined } from "@ant-design/icons";
import StoreProfileCard from "./StoreProfileCard";
import ReportSubscriptionCard from "./ReportSubscriptionCard";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsChannels { channel active has_token has_secret access_token_masked channel_secret_masked }
    bmsChannelHealth {
      channel active status status_detail
      last_error_at last_inbound_event_at last_outbound_success_at last_checked_at
    }
    bmsAiConfig { has_key api_key_masked model provider }
    bmsAiUsage { count limit remaining unlimited planCode planName }
  }
`;
const M = gql`
  mutation ($channel: String!, $accessToken: String, $channelSecret: String, $active: Boolean) {
    bmsUpsertChannel(channel: $channel, accessToken: $accessToken, channelSecret: $channelSecret, active: $active)
  }
`;
const M_TEST = gql`
  mutation ($channel: String!) {
    bmsTestChannel(channel: $channel) { ok message }
  }
`;
const M_SET_AI_KEY = gql`
  mutation ($apiKey: String, $model: String, $provider: String) {
    bmsSetAiKey(apiKey: $apiKey, model: $model, provider: $provider)
  }
`;
const M_REMOVE_AI_KEY = gql`mutation { bmsRemoveAiKey }`;
const M_TEST_AI_KEY = gql`mutation { bmsTestAiKey { ok message } }`;

// เฉพาะช่องทางที่มี API ตรวจสอบ token โดยไม่ต้องส่งข้อความหาลูกค้าจริง (ดู channelHealth.ts)
const TESTABLE_CHANNELS = new Set(["line", "facebook", "instagram"]);

function useChannels(t: (key: string, vars?: Record<string, string | number>) => string) {
  return useMemo(() => [
    { key: "line", label: "LINE Official Account", color: "green",
      hint: t("admin_settings.channel_line_hint"), needs: t("admin_settings.channel_line_needs"), status: "ready" },
    { key: "tiktok", label: "TikTok", color: "magenta",
      hint: t("admin_settings.channel_tiktok_hint"), needs: t("admin_settings.channel_tiktok_needs"), status: "ready" },
    { key: "facebook", label: "Facebook Messenger", color: "blue",
      hint: t("admin_settings.channel_facebook_hint"), needs: t("admin_settings.channel_facebook_needs"), status: "ready" },
    { key: "instagram", label: "Instagram DM", color: "purple",
      hint: t("admin_settings.channel_instagram_hint"), needs: t("admin_settings.channel_instagram_needs"), status: "ready" },
    { key: "web", label: "Website Live Chat", color: "geekblue",
      hint: t("admin_settings.channel_web_hint"), needs: t("admin_settings.channel_web_needs"), status: "no-token" },
    { key: "shopee", label: "Shopee (beta)", color: "orange",
      hint: t("admin_settings.channel_shopee_hint"), needs: t("admin_settings.channel_shopee_needs"), status: "beta" },
    { key: "lazada", label: "Lazada (beta)", color: "purple",
      hint: t("admin_settings.channel_lazada_hint"), needs: t("admin_settings.channel_lazada_needs"), status: "beta" },
  ], [t]);
}

function useStatusMeta(t: (key: string) => string): Record<string, { color: string; text: string }> {
  return useMemo(() => ({
    ready: { color: "green", text: t("admin_settings.status_ready") },
    "no-token": { color: "default", text: t("admin_settings.status_no_token") },
    beta: { color: "orange", text: t("admin_settings.status_beta") },
  }), [t]);
}

// สถานะ "สุขภาพ" การเชื่อมต่อจริง (bmsChannelHealth.status) — คนละมิติกับ active (สวิตช์เปิด/ปิด)
function useHealthMeta(t: (key: string) => string): Record<string, { color: string; text: string; action: string }> {
  return useMemo(() => ({
    connected: { color: "green", text: t("admin_settings.health_connected"), action: "" },
    token_expired: { color: "red", text: t("admin_settings.health_token_expired"), action: t("admin_settings.health_token_expired_action") },
    webhook_failed: { color: "red", text: t("admin_settings.health_webhook_failed"), action: t("admin_settings.health_webhook_failed_action") },
    rate_limited: { color: "gold", text: t("admin_settings.health_rate_limited"), action: t("admin_settings.health_rate_limited_action") },
    no_events: { color: "gold", text: t("admin_settings.health_no_events"), action: t("admin_settings.health_no_events_action") },
    send_failed: { color: "red", text: t("admin_settings.health_send_failed"), action: t("admin_settings.health_send_failed_action") },
  }), [t]);
}

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function Page() {
  const { t } = useI18n();
  const CHANNELS = useChannels(t);
  const STATUS_META = useStatusMeta(t);
  const searchParams = useSearchParams();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const focus = searchParams.get("focus");
  const focusChannel = searchParams.get("channel");
  const highlightedChannel = useMemo(() => {
    if (focus !== "channel" || !focusChannel) return null;
    return CHANNELS.some((ch) => ch.key === focusChannel) ? focusChannel : null;
  }, [focus, focusChannel, CHANNELS]);

  if (error) return <Alert type="error" message={t("admin_settings.load_error")} description={error.message} showIcon />;

  const tenant = data?.bmsMyTenant;
  const channels: any[] = data?.bmsChannels || [];
  const health: any[] = data?.bmsChannelHealth || [];
  const cfgOf = (k: string) => channels.find((c) => c.channel === k);
  const healthOf = (k: string) => health.find((h) => h.channel === k);

  return (
    <div style={{ maxWidth: 1600 }}>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>{t("admin_settings.page_title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_settings.refresh")}</Button>
        </Space>
      </div>

      {tenant && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={<>{t("admin_settings.tenant_info_prefix")} <b>{tenant.name}</b> <Text code>{tenant.slug}</Text> · {t("admin_settings.tenant_id_prefix")} <Text code>{tenant.id}</Text></>}
          description={t("admin_settings.tenant_info_desc")}
        />
      )}

      <StoreProfileCard />
      <ReportSubscriptionCard />


      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 16, marginBottom: 16, alignItems: "stretch" }}>
        <Card size="small" title={t("admin_settings.steps_card_title")}>
          <Steps
            size="small"
            direction="vertical"
            items={[
              { title: t("admin_settings.step1_title"), icon: <KeyOutlined />, description: t("admin_settings.step1_desc") },
              { title: t("admin_settings.step2_title"), icon: <SaveOutlined />, description: t("admin_settings.step2_desc") },
              { title: t("admin_settings.step3_title"), icon: <LinkOutlined />, description: t("admin_settings.step3_desc") },
              { title: t("admin_settings.step4_title"), icon: <PoweroffOutlined />, description: t("admin_settings.step4_desc") },
            ]}
          />
        </Card>

        <Card size="small" title={t("admin_settings.compare_card_title")}>
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={CHANNELS}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("admin_settings.col_channel"), dataIndex: "label", render: (_: string, r: any) => <Tag color={r.color}>{r.label}</Tag> },
              { title: t("admin_settings.col_needs"), dataIndex: "needs" },
              { title: t("admin_settings.col_status"), dataIndex: "status",
                render: (s: string) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].text}</Tag> },
            ]}
          />
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.key}
            ch={ch}
            cfg={cfgOf(ch.key)}
            health={healthOf(ch.key)}
            tenantId={tenant?.id}
            origin={origin}
            focused={highlightedChannel === ch.key}
            onSaved={refetch}
          />
        ))}
        <AiCard aiConfig={data?.bmsAiConfig} aiUsage={data?.bmsAiUsage} onSaved={refetch} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12 }}>
        <Alert type="info" showIcon message={t("admin_settings.security_title")}
          description={t("admin_settings.security_desc")} />
        <Alert type="warning" showIcon message={t("admin_settings.caution_title")}
          description={t("admin_settings.caution_desc")} />
        <Alert type="success" showIcon message={t("admin_settings.edit_later_title")}
          description={t("admin_settings.edit_later_desc")} />
      </div>
    </div>
  );
}

function ChannelCard({ ch, cfg, health, tenantId, origin, focused, onSaved }: any) {
  const { t } = useI18n();
  const HEALTH_META = useHealthMeta(t);
  const [form] = Form.useForm();
  const accessTokenInputRef = useRef<any>(null);
  const [saveChannel, { loading: saving }] = useMutation(M, {
    onCompleted: () => { message.success(t("admin_settings.save_success", { label: ch.label })); form.setFieldsValue({ accessToken: "", channelSecret: "" }); onSaved(); },
    onError: (e) => message.error(e?.message || t("admin_settings.save_failed")),
  });
  const [testChannel, { loading: testing }] = useMutation(M_TEST, {
    onCompleted: (d) => {
      const r = d?.bmsTestChannel;
      if (r?.ok) message.success(r.message); else message.error(r?.message || t("admin_settings.test_failed"));
      onSaved();
    },
    onError: (e) => message.error(e?.message || t("admin_settings.test_failed")),
  });

  const webhookUrl = tenantId ? `${origin}/api/bms/${ch.key}/webhook/${tenantId}` : "";
  const copy = () => { navigator.clipboard?.writeText(webhookUrl); message.success(t("admin_settings.copy_webhook_success")); };

  const submit = async () => {
    const v = await form.validateFields();
    await saveChannel({ variables: {
      channel: ch.key,
      accessToken: v.accessToken || null,
      channelSecret: v.channelSecret || null,
      active: v.active,
    }});
  };

  // ลำดับความสำคัญ: ยังไม่ตั้งค่า > ปิดใช้งานเอง > สุขภาพจริง (bmsChannelHealth.status)
  // ตอนยังไม่กรอก token เลย status บน DB ยังเป็นค่า default ('connected') อยู่ ไม่มีความหมาย
  // จึงต้องเช็ค has_token/active ก่อนเสมอ ไม่ใช้ health.status ตรง ๆ
  const healthBadge = !cfg?.has_token
    ? { color: "default", text: t("admin_settings.channel_unset"), action: "" }
    : cfg?.active === false
    ? { color: "default", text: t("admin_settings.channel_disabled"), action: "" }
    : HEALTH_META[health?.status as string] || HEALTH_META.connected;

  const canTest = TESTABLE_CHANNELS.has(ch.key) && cfg?.has_token && cfg?.active && healthBadge.text === t("admin_settings.health_connected");

  useEffect(() => {
    if (!focused) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`channel-setting-${ch.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      accessTokenInputRef.current?.focus?.({ cursor: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [ch.key, focused]);

  return (
    <Card
      id={`channel-setting-${ch.key}`}
      title={<Space wrap><Tag color={ch.color}>{ch.label}</Tag><Tag color={healthBadge.color}>{healthBadge.text}</Tag></Space>}
      extra={canTest && (
        <Button size="small" icon={<PlayCircleOutlined />} loading={testing} onClick={() => testChannel({ variables: { channel: ch.key } })}>
          {t("admin_settings.test_btn")}
        </Button>
      )}
      style={focused ? {
        borderColor: "#1677ff",
        boxShadow: "0 0 0 3px rgba(22, 119, 255, 0.16), 0 10px 28px rgba(22, 119, 255, 0.12)",
      } : undefined}
    >
      {focused && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("admin_settings.focused_alert_title", { label: ch.label })}
          description={t("admin_settings.focused_alert_desc")}
        />
      )}

      <Paragraph type="secondary" style={{ marginTop: -4 }}>{ch.hint}</Paragraph>

      {healthBadge.action && (
        <Alert
          type={healthBadge.color === "red" ? "error" : "warning"}
          showIcon
          icon={healthBadge.color === "gold" ? <ClockCircleOutlined /> : <WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={health?.status_detail || healthBadge.text}
          description={
            <>
              {healthBadge.action}
              {health?.last_error_at && <div>{t("admin_settings.last_seen_prefix", { time: fmtDT(health.last_error_at) })}</div>}
            </>
          }
        />
      )}

      <Text strong><LinkOutlined /> {t("admin_settings.webhook_url_label")}</Text>
      <div style={{ display: "flex", gap: 8, margin: "6px 0 16px" }}>
        <Input readOnly value={webhookUrl} />
        <Button icon={<CopyOutlined />} onClick={copy}>{t("admin_settings.copy_btn")}</Button>
      </div>

      <Form form={form} layout="vertical" initialValues={{ active: cfg?.active ?? true }}>
        <Form.Item label={`${t("admin_settings.access_token_label")} ${cfg?.has_token ? t("admin_settings.access_token_current", { masked: cfg.access_token_masked }) : ""}`} name="accessToken">
          <Input.Password ref={accessTokenInputRef} placeholder={cfg?.has_token ? t("admin_settings.access_token_placeholder_set") : t("admin_settings.access_token_placeholder_empty")} autoComplete="off" />
        </Form.Item>
        <Form.Item label={`${t("admin_settings.channel_secret_label")} ${cfg?.has_secret ? t("admin_settings.access_token_current", { masked: cfg.channel_secret_masked }) : ""} ${t("admin_settings.channel_secret_suffix")}`} name="channelSecret">
          <Input.Password placeholder={cfg?.has_secret ? t("admin_settings.access_token_placeholder_set") : t("admin_settings.channel_secret_placeholder_empty")} autoComplete="off" />
        </Form.Item>
        <Form.Item label={t("admin_settings.active_label")} name="active" valuePropName="checked">
          <Switch checkedChildren={t("admin_settings.switch_on")} unCheckedChildren={t("admin_settings.switch_off")} />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={submit}>{t("admin_settings.save_channel_btn", { label: ch.label })}</Button>
      </Form>

      <Divider style={{ margin: "16px 0 0" }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("admin_settings.encrypted_note")}
      </Text>
      {cfg?.has_token && (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            {t("admin_settings.last_inbound_event", { time: fmtDT(health?.last_inbound_event_at) })}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            {t("admin_settings.last_outbound_success", { time: fmtDT(health?.last_outbound_success_at) })}
          </Text>
        </div>
      )}
    </Card>
  );
}

function AiCard({ aiConfig, aiUsage, onSaved }: any) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue({
      provider: aiConfig?.provider || "anthropic",
      model: aiConfig?.model || "",
    });
  }, [aiConfig?.provider, aiConfig?.model, form]);
  const [setAiKey, { loading: saving }] = useMutation(M_SET_AI_KEY, {
    onCompleted: () => { message.success(t("admin_settings.ai_key_saved")); form.setFieldsValue({ apiKey: "" }); onSaved(); },
    onError: (e) => message.error(e?.message || t("admin_settings.save_failed")),
  });
  const [removeAiKey, { loading: removing }] = useMutation(M_REMOVE_AI_KEY, {
    onCompleted: () => { message.success(t("admin_settings.ai_key_removed")); onSaved(); },
    onError: (e) => message.error(e?.message || t("admin_settings.ai_remove_failed")),
  });
  const [testAiKey, { loading: testing }] = useMutation(M_TEST_AI_KEY, {
    onCompleted: (d) => {
      const r = d?.bmsTestAiKey;
      if (r?.ok) message.success(r.message); else message.error(r?.message || t("admin_settings.test_failed"));
    },
    onError: (e) => message.error(e?.message || t("admin_settings.test_failed")),
  });

  const submit = async () => {
    const v = await form.validateFields();
    await setAiKey({
      variables: {
        apiKey: v.apiKey || null,
        model: v.model || null,
        provider: v.provider || "anthropic",
      },
    });
  };

  const hasKey = !!aiConfig?.has_key;
  const usage = aiUsage;
  const nearLimit = !hasKey && usage && !usage.unlimited && usage.limit > 0 && usage.remaining <= usage.limit * 0.2;
  const overLimit = !hasKey && usage && !usage.unlimited && usage.remaining === 0;

  return (
    <Card
      title={
        <Space wrap>
          <Tag color="cyan"><RobotOutlined /> {t("admin_settings.ai_byok")}</Tag>
          {hasKey ? <Tag color="green">{t("admin_settings.ai_using_own_key")}</Tag> : <Tag color="default">{t("admin_settings.ai_using_shared_key")}</Tag>}
        </Space>
      }
      extra={hasKey && (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} loading={testing} onClick={() => testAiKey()}>{t("admin_settings.test_btn")}</Button>
          <Button size="small" danger icon={<DeleteOutlined />} loading={removing} onClick={() => removeAiKey()}>{t("admin_settings.delete_btn")}</Button>
        </Space>
      )}
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        {t("admin_settings.ai_card_desc")}
      </Paragraph>

      {!hasKey && usage && (
        <Alert
          type={overLimit ? "error" : nearLimit ? "warning" : "info"}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <>
              <Tag>{t("admin_settings.ai_plan_tag", { plan: usage.planName })}</Tag>
              {usage.unlimited ? t("admin_settings.ai_unlimited") : t("admin_settings.ai_usage_count", { count: usage.count, limit: usage.limit })}
            </>
          }
          description={
            overLimit
              ? t("admin_settings.ai_over_limit_desc")
              : undefined
          }
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={{ provider: aiConfig?.provider || "anthropic", model: aiConfig?.model || "" }}
      >
        <Form.Item label={t("admin_settings.ai_provider_label")} name="provider" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "anthropic", label: "Anthropic (Claude)" },
              { value: "deepseek", label: "DeepSeek" },
            ]}
            onChange={(provider) => {
              form.setFieldValue(
                "model",
                provider === "deepseek" ? "deepseek-v4-flash" : "claude-haiku-4-5-20251001"
              );
            }}
          />
        </Form.Item>
        <Form.Item label={`${t("admin_settings.ai_key_label")} ${hasKey ? t("admin_settings.ai_key_current", { masked: aiConfig.api_key_masked }) : ""}`} name="apiKey">
          <Input.Password placeholder={hasKey ? t("admin_settings.access_token_placeholder_set") : t("admin_settings.ai_key_placeholder_empty")} autoComplete="off" />
        </Form.Item>
        <Form.Item label={t("admin_settings.ai_model_label")} name="model">
          <Input placeholder={t("admin_settings.ai_model_placeholder")} />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={submit}>{t("admin_settings.save_ai_key_btn")}</Button>
      </Form>

      <Divider style={{ margin: "16px 0 0" }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("admin_settings.ai_encrypted_note")}
      </Text>
    </Card>
  );
}
