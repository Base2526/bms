'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, Switch, message, Alert, Typography, Divider, Form, Steps, Table, Select, Tabs, Collapse } from "antd";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ReloadOutlined, LinkOutlined, CopyOutlined, KeyOutlined, SaveOutlined, PoweroffOutlined, WarningOutlined, ClockCircleOutlined, PlayCircleOutlined, RobotOutlined, DeleteOutlined, ShopOutlined, MessageOutlined, FileTextOutlined } from "@ant-design/icons";
import StoreProfileCard from "./StoreProfileCard";
import ReportSubscriptionCard from "./ReportSubscriptionCard";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph, Title } = Typography;

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

// dot/label สีตาม antd Tag color name ที่ badge ใช้อยู่แล้ว (green/red/gold/default) —
// map เป็น hex ไว้ที่เดียวให้ dot กับตัวหนังสือสถานะในหัวแถว Collapse ใช้สีตรงกัน
const BADGE_HEX: Record<string, string> = {
  green: "#2f9e6b",
  red: "#c1443a",
  gold: "#a8760a",
  default: "var(--app-muted)",
};

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

// ลำดับความสำคัญ: ยังไม่ตั้งค่า > ปิดใช้งานเอง > สุขภาพจริง (bmsChannelHealth.status) — ตอนยังไม่กรอก
// token เลย status บน DB ยังเป็นค่า default ('connected') อยู่ ไม่มีความหมาย จึงต้องเช็ค has_token/active
// ก่อนเสมอ ไม่ใช้ health.status ตรง ๆ — ใช้ร่วมกันทั้งหัวแถว Collapse (parent) และตัวฟอร์ม (ChannelPanelBody)
function computeHealthBadge(
  cfg: any,
  health: any,
  HEALTH_META: Record<string, { color: string; text: string; action: string }>,
  unsetText: string,
  disabledText: string
) {
  if (!cfg?.has_token) return { color: "default", text: unsetText, action: "" };
  if (cfg?.active === false) return { color: "default", text: disabledText, action: "" };
  return HEALTH_META[health?.status as string] || HEALTH_META.connected;
}

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function Page() {
  const { t } = useI18n();
  const CHANNELS = useChannels(t);
  const STATUS_META = useStatusMeta(t);
  const HEALTH_META = useHealthMeta(t);
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

  // แท็บเดียวที่มองเห็นพร้อมกัน แทนการเรียงฟอร์มร้าน/ช่องทาง/AI/รายงานต่อกันแนวตั้งยาวทั้งหมด
  const [activeTab, setActiveTab] = useState("channels");
  useEffect(() => {
    if (highlightedChannel) setActiveTab("channels");
  }, [highlightedChannel]);

  // แถวช่องทางเป็น Collapse ทีละแถว (เดิมเป็นการ์ดใหญ่ 7 ใบเปิดพร้อมกันหมด) — เปิดเฉพาะช่องทางที่
  // มาจาก deep-link (?focus=channel) เป็น default, ผู้ใช้กางเพิ่ม/ยุบเองได้อิสระทีละแถว
  const [openChannels, setOpenChannels] = useState<string[]>([]);
  useEffect(() => {
    if (!highlightedChannel) return;
    setOpenChannels((prev) => (prev.includes(highlightedChannel) ? prev : [...prev, highlightedChannel]));
    const timer = window.setTimeout(() => {
      document.getElementById(`channel-setting-${highlightedChannel}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [highlightedChannel]);

  if (error) return <Alert closable type="error" message={t("admin_settings.load_error")} description={error.message} showIcon />;

  const tenant = data?.bmsMyTenant;
  const channels: any[] = data?.bmsChannels || [];
  const health: any[] = data?.bmsChannelHealth || [];
  const cfgOf = (k: string) => channels.find((c) => c.channel === k);
  const healthOf = (k: string) => health.find((h) => h.channel === k);

  const badgeOf = (ch: any) =>
    computeHealthBadge(cfgOf(ch.key), healthOf(ch.key), HEALTH_META, t("admin_settings.channel_unset"), t("admin_settings.channel_disabled"));
  const brokenChannelCount = CHANNELS.filter((ch) => badgeOf(ch).color === "red").length;

  return (
    <div style={{ maxWidth: 1200 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 20 }} wrap align="start">
        <div>
          <Title level={2} style={{ margin: 0 }}>{t("admin_settings.page_title")}</Title>
          <Text type="secondary">{t("admin_settings.page_subtitle")}</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_settings.refresh")}</Button>
      </Space>

      {tenant && (
        <Alert closable type="info" showIcon style={{ marginBottom: 16 }}
          message={<>{t("admin_settings.tenant_info_prefix")} <b>{tenant.name}</b> <Text code>{tenant.slug}</Text> · {t("admin_settings.tenant_id_prefix")} <Text code>{tenant.id}</Text></>}
          description={t("admin_settings.tenant_info_desc")}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "store",
            label: <span><ShopOutlined /> {t("admin_settings.tab_store")}</span>,
            children: <StoreProfileCard />,
          },
          {
            key: "channels",
            label: (
              <span>
                <MessageOutlined /> {t("admin_settings.tab_channels")}
                {brokenChannelCount > 0 && (
                  <Tag color="red" style={{ marginLeft: 6 }}>{brokenChannelCount}</Tag>
                )}
              </span>
            ),
            children: (
              <div>
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

                <Collapse
                  activeKey={openChannels}
                  onChange={(keys) => setOpenChannels(keys as string[])}
                  style={{ marginBottom: 16 }}
                  items={CHANNELS.map((ch) => {
                    const cfg = cfgOf(ch.key);
                    const chHealth = healthOf(ch.key);
                    const badge = badgeOf(ch);
                    const focused = highlightedChannel === ch.key;
                    return {
                      key: ch.key,
                      forceRender: true,
                      style: focused ? { borderColor: "#1677ff", boxShadow: "0 0 0 3px rgba(22, 119, 255, 0.16)" } : undefined,
                      label: (
                        <Space id={`channel-setting-${ch.key}`} wrap align="center" size={10}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: BADGE_HEX[badge.color] || BADGE_HEX.default, display: "inline-block" }} />
                          <Tag color={ch.color}>{ch.label}</Tag>
                          <Text style={{ color: BADGE_HEX[badge.color] || undefined, fontWeight: 600, fontSize: 12.5 }}>{badge.text}</Text>
                          {cfg?.has_token && cfg?.active !== false && chHealth?.last_inbound_event_at ? (
                            <Text type="secondary" style={{ fontSize: 11.5 }}>
                              · {t("admin_settings.last_inbound_event", { time: fmtDT(chHealth.last_inbound_event_at) })}
                            </Text>
                          ) : null}
                        </Space>
                      ),
                      children: (
                        <ChannelPanelBody
                          ch={ch}
                          cfg={cfg}
                          health={chHealth}
                          badge={badge}
                          tenantId={tenant?.id}
                          origin={origin}
                          focused={focused}
                          onSaved={refetch}
                        />
                      ),
                    };
                  })}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12 }}>
                  <Alert closable type="info" showIcon message={t("admin_settings.security_title")}
                    description={t("admin_settings.security_desc")} />
                  <Alert closable type="warning" showIcon message={t("admin_settings.caution_title")}
                    description={t("admin_settings.caution_desc")} />
                  <Alert closable type="success" showIcon message={t("admin_settings.edit_later_title")}
                    description={t("admin_settings.edit_later_desc")} />
                </div>
              </div>
            ),
          },
          {
            key: "ai",
            label: <span><RobotOutlined /> {t("admin_settings.tab_ai")}</span>,
            children: <AiCard aiConfig={data?.bmsAiConfig} aiUsage={data?.bmsAiUsage} onSaved={refetch} />,
          },
          {
            key: "reports",
            label: <span><FileTextOutlined /> {t("admin_settings.tab_reports")}</span>,
            children: <ReportSubscriptionCard />,
          },
        ]}
      />
    </div>
  );
}

// เนื้อหาฟอร์มของช่องทางเดียว — เดิมเป็นทั้ง <Card> (มี title/extra ของตัวเอง) ตอนนี้เหลือแค่ body
// เพราะหัวแถว (dot/ชื่อ/สถานะ) ย้ายไปเรนเดอร์ที่ parent เป็น label ของ Collapse.Panel แทนแล้ว
function ChannelPanelBody({ ch, cfg, health, badge, tenantId, origin, focused, onSaved }: any) {
  const { t } = useI18n();
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
    const hasNewAccessToken = typeof v.accessToken === "string" && v.accessToken.trim() !== "";
    await saveChannel({ variables: {
      channel: ch.key,
      accessToken: v.accessToken || null,
      channelSecret: v.channelSecret || null,
      active: v.active,
    }});

    // Saving only proves that the encrypted value reached our database. Verify a newly
    // supplied token against the provider immediately so a stale token_expired status is
    // cleared (or replaced with the current error) without waiting for a real message.
    if (hasNewAccessToken && v.active && TESTABLE_CHANNELS.has(ch.key)) {
      await testChannel({ variables: { channel: ch.key } });
    }
  };

  // Keep recovery available while unhealthy: the test itself is what can prove that a
  // replacement token works and move the channel back to connected.
  const canTest = TESTABLE_CHANNELS.has(ch.key) && cfg?.has_token && cfg?.active;

  useEffect(() => {
    if (!focused) return;
    const timer = window.setTimeout(() => {
      accessTokenInputRef.current?.focus?.({ cursor: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ch.key, focused]);

  return (
    <div>
      {focused && (
        <Alert closable
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("admin_settings.focused_alert_title", { label: ch.label })}
          description={t("admin_settings.focused_alert_desc")}
        />
      )}

      <Paragraph type="secondary" style={{ marginTop: -4 }}>{ch.hint}</Paragraph>

      {badge.action && (
        <Alert closable
          type={badge.color === "red" ? "error" : "warning"}
          showIcon
          icon={badge.color === "gold" ? <ClockCircleOutlined /> : <WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={health?.status_detail || badge.text}
          description={
            <>
              {badge.action}
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
        <Space wrap>
          <Button type="primary" loading={saving} onClick={submit}>{t("admin_settings.save_channel_btn", { label: ch.label })}</Button>
          {canTest && (
            <Button icon={<PlayCircleOutlined />} loading={testing} onClick={() => testChannel({ variables: { channel: ch.key } })}>
              {t("admin_settings.test_btn")}
            </Button>
          )}
        </Space>
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
    </div>
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
        <Alert closable
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
