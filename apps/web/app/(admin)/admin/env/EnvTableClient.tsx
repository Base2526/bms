// app/admin/env/EnvTableClient.tsx
"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";

import React, { useMemo, useState } from "react";
import { gql, useMutation } from "@apollo/client";
import { Alert, Button, Card, Descriptions, Input, Space, Table, Tag, Typography, message } from "antd";
import { CopyOutlined, KeyOutlined, PlayCircleOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type {
  ActiveProviderSummary,
  ConfigDiagnostic,
  EnvRow,
} from "./page";
import type { RecentAiUsageEvent } from "@/lib/bms/aiUsage";
import type { AiProviderHealth } from "@/lib/bms/aiProviderHealth";
import { useI18n } from "@/lib/i18nContext";

const M_TEST_PLATFORM_AI_KEY = gql`
  mutation TestPlatformAiKey($provider: String) {
    bmsTestPlatformAiKey(provider: $provider) {
      ok
      message
    }
  }
`;

const M_CHECK_ALL_AI_PROVIDER_HEALTH = gql`
  mutation CheckAllAiProviderHealth {
    bmsCheckAllAiProviderHealth {
      provider
      purpose
      status
      status_detail
      last_error_at
      last_success_at
      last_checked_at
    }
  }
`;

const { Text } = Typography;
const PLATFORM_AI_PROVIDERS = (uiText: UiTranslator = thaiUiText) => ([
  {
    key: "anthropic",
    title: "Anthropic Chat",
    envKey: "ANTHROPIC_API_KEY",
    noteKey: "provider_note_anthropic",
  },
  {
    key: "anthropic-ocr",
    title: uiText("admin_ui.en_anthropic_ocr_fallback_9bf1a"),
    envKey: "ANTHROPIC_API_KEY",
    noteKey: "provider_note_anthropic_ocr",
  },
  {
    key: "deepseek",
    title: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    noteKey: "provider_note_deepseek",
  },
  {
    key: "qwen",
    title: "QWEN OCR",
    envKey: "QWEN_OCR_API_KEY",
    noteKey: "provider_note_qwen",
  },
] as const);
type PlatformAiProviderKey = ReturnType<typeof PLATFORM_AI_PROVIDERS>[number]["key"];

type Meta = {
  nodeEnv: string;
  runtime: string;
  hostname: string;
  pid: string;
  uptimeSec: string;
  now: string;
};

type Props = {
  env: EnvRow[];
  meta: Meta;
  activeProviders: ActiveProviderSummary[];
  recentUsage: RecentAiUsageEvent[];
  providerHealth: AiProviderHealth[];
  configDiagnostics: ConfigDiagnostic[];
};

function healthStatusTag(status: AiProviderHealth["status"], uiText: UiTranslator = thaiUiText) {
  if (status === "connected") return <Tag color="green">{uiText("admin_ui.en_connected_073af")}</Tag>;
  if (status === "unconfigured") return <Tag>{uiText("admin_ui.en_unconfigured_89d31")}</Tag>;
  if (status === "token_expired") return <Tag color="red">{uiText("admin_ui.en_token_expired_f9123")}</Tag>;
  if (status === "rate_limited") return <Tag color="gold">{uiText("admin_ui.en_rate_limited_2a15c")}</Tag>;
  if (status === "stale") return <Tag color="orange">{uiText("admin_ui.en_stale_600a5")}</Tag>;
  return <Tag color="red">{uiText("admin_ui.en_send_failed_67518")}</Tag>;
}

function statusTag(status: ActiveProviderSummary["status"], uiText: UiTranslator = thaiUiText) {
  if (status === "active") return <Tag color="green">{uiText("admin_ui.en_active_c7263")}</Tag>;
  if (status === "fallback") return <Tag color="gold">{uiText("admin_ui.en_fallback_50a0a")}</Tag>;
  return <Tag color="red">{uiText("admin_ui.en_missing_04077")}</Tag>;
}

function providerTag(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized === "deepseek") return <Tag color="blue">DeepSeek</Tag>;
  if (normalized === "qwen") return <Tag color="purple">QWEN OCR</Tag>;
  if (normalized === "anthropic-ocr") return <Tag color="green">Anthropic OCR</Tag>;
  if (normalized === "anthropic") return <Tag color="green">Anthropic</Tag>;
  return <Tag>{provider}</Tag>;
}

function healthUsageNote(
  row: AiProviderHealth,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  if (row.provider === "deepseek" && row.purpose === "chat") {
    return t("admin_env_table.used_when_deepseek_chat");
  }
  if (row.provider === "anthropic" && row.purpose === "chat") {
    return t("admin_env_table.used_when_anthropic_chat");
  }
  if (row.provider === "qwen" && row.purpose === "ocr") {
    return t("admin_env_table.used_when_qwen_ocr");
  }
  if (row.provider === "anthropic" && row.purpose === "ocr") {
    return t("admin_env_table.used_when_anthropic_ocr");
  }
  return t("admin_env_table.used_when_default");
}

function formatDateTime(value: string | null, uiText: UiTranslator = thaiUiText) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(uiText.locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * ⚠️ `?? 0` ห้ามกลับมา — แถวที่ finalize ไม่สำเร็จมี token เป็น NULL และการแสดงเป็น `0 in · 0 out`
 * อ่านเหมือน "เรียกแล้วไม่ใช้โทเคนเลย" ซึ่งเป็นไปไม่ได้ · การโกหกแบบที่อ่านไม่ออกว่าโกหกนี้
 * คือเหตุที่บั๊ก finalize (สำเร็จ 0%) อยู่มาได้เป็นเดือนบน BMS-LIVE โดยไม่มีใครสังเกต
 * ใช้คำเดียวกับ formatMoney(null) เพื่อให้ "ไม่รู้" หน้าตาเหมือนกันทั้งแถว
 */
function formatTokens(input: number | null, output: number | null) {
  if (input === null && output === null) return "Unavailable";
  const one = (value: number | null) => (value === null ? "—" : value.toLocaleString());
  return `${one(input)} in · ${one(output)} out`;
}

function formatMoney(value: number | null) {
  if (value === null) return "Unavailable";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  })}`;
}

export default function EnvTableClient({
  env,
  meta,
  activeProviders,
  recentUsage,
  providerHealth,
  configDiagnostics,
}: Props) {
  const uiText = useUiText();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [testResults, setTestResults] = useState<
    Partial<Record<PlatformAiProviderKey, { ok: boolean; message: string }>>
  >({});
  const [activeProvider, setActiveProvider] = useState<PlatformAiProviderKey | null>(null);
  const [testPlatformAiKey, { loading: testingAiKey }] = useMutation(M_TEST_PLATFORM_AI_KEY);
  // seed จาก server prop ตอนโหลดหน้า แล้วอัปเดตในตัวหลังกด "ตรวจสอบทั้งหมดตอนนี้" —
  // ไม่ต้องแปลงทั้งหน้าเป็น client-side query/polling แค่ปุ่มนี้จุดเดียว
  const [health, setHealth] = useState<AiProviderHealth[]>(providerHealth);
  const [checkAllAiProviderHealth, { loading: checkingAllHealth }] = useMutation(
    M_CHECK_ALL_AI_PROVIDER_HEALTH
  );

  const runCheckAllHealth = () => {
    checkAllAiProviderHealth({
      onCompleted: (data) => {
        if (data?.bmsCheckAllAiProviderHealth) {
          setHealth(data.bmsCheckAllAiProviderHealth);
        }
        message.success(t("admin_env_table.check_all_success"));
      },
      onError: (error) => {
        message.error(error?.message || t("admin_env_table.check_all_failed"));
      },
    });
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return env;
    return env.filter((r) => r.key.toLowerCase().includes(s));
  }, [q, env]);
  const latestChatUsage = useMemo(
    () => recentUsage.find((item) => item.feature !== "payment_slip_ocr") ?? null,
    [recentUsage]
  );
  const latestOcrUsage = useMemo(
    () => recentUsage.find((item) => item.feature === "payment_slip_ocr") ?? null,
    [recentUsage]
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(uiText("admin_ui.en_copied_8e3df"));
    } catch {
      // fallback
      try {
        const el = document.createElement("textarea");
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        message.success(uiText("admin_ui.en_copied_8e3df"));
      } catch {
        message.error(uiText("admin_ui.en_copy_failed_bd5ac"));
      }
    }
  };

  const runProviderTest = (provider: PlatformAiProviderKey) => {
    setActiveProvider(provider);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    testPlatformAiKey({
      variables: { provider },
      onCompleted: (data) => {
        setTestResults((prev) => ({
          ...prev,
          [provider]:
            data?.bmsTestPlatformAiKey ?? { ok: false, message: t("admin_env_table.test_failed") },
        }));
        setActiveProvider((current) => (current === provider ? null : current));
      },
      onError: (error) => {
        setTestResults((prev) => ({
          ...prev,
          [provider]: { ok: false, message: error?.message || t("admin_env_table.test_failed") },
        }));
        setActiveProvider((current) => (current === provider ? null : current));
      },
    });
  };

  const columns: ColumnsType<EnvRow> = [
    {
      title: uiText("admin_ui.en_key_c67dd"),
      dataIndex: "key",
      key: "key",
      width: 360,
      render: (k: string) => (
        <Space>
          <KeyOutlined />
          <Text code>{k}</Text>
        </Space>
      ),
      sorter: (a, b) => a.key.localeCompare(b.key),
      defaultSortOrder: "ascend",
    },
    {
      title: uiText("admin_ui.en_value_8dce1"),
      dataIndex: "value",
      key: "value",
      render: (v: string) => (
        <Text code style={{ wordBreak: "break-all" }}>
          {v || uiText("admin_ui.en_empty_48b2f")}
        </Text>
      ),
    },
    {
      title: uiText("admin_ui.en_masked_3c7ed"),
      dataIndex: "masked",
      key: "masked",
      width: 110,
      align: "center",
      render: (m: boolean) => (m ? <Tag color="gold">{uiText("admin_ui.en_masked_63dc7")}</Tag> : <Tag>OK</Tag>),
      filters: [
        { text: "Masked", value: "masked" },
        { text: "Not masked", value: "ok" },
      ],
      onFilter: (value, record) => {
        if (value === "masked") return record.masked;
        return !record.masked;
      },
    },
    {
      title: uiText("admin_ui.en_actions_c3cd6"),
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => copy(record.key)}>
            {uiText("admin_ui.en_copy_key_89dcf")}</Button>
          <Button icon={<CopyOutlined />} onClick={() => copy(record.value)}>
            {uiText("admin_ui.en_copy_value_8ef1d")}</Button>
        </Space>
      ),
    },
  ];
  const usageColumns: ColumnsType<RecentAiUsageEvent> = [
    {
      title: uiText("admin_ui.en_when_769bb"),
      key: "createdAt",
      width: 190,
      render: (_, record) => formatDateTime(record.createdAt, uiText),
    },
    {
      title: uiText("admin_ui.en_tenant_3ca93"),
      key: "tenant",
      width: 180,
      render: (_, record) => record.tenantName || record.tenantId.slice(0, 8),
    },
    {
      title: uiText("admin_ui.en_feature_ad565"),
      dataIndex: "feature",
      key: "feature",
      width: 180,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: uiText("admin_ui.en_provider_7ceee"),
      key: "provider",
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{providerTag(record.provider)}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.model || "-"}
          </Text>
        </Space>
      ),
    },
    {
      title: uiText("admin_ui.en_source_6da13"),
      dataIndex: "source",
      key: "source",
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: uiText("admin_ui.en_routing_7d15d"),
      key: "routing",
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text code>{record.routingReason || "-"}</Text>
          {record.fallbackFrom ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {uiText("admin_ui.en_fallback_from_42701")} {record.fallbackFrom}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: uiText("admin_ui.en_status_bae7d"),
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value: string) => (
        <Tag color={value === "completed" ? "green" : value === "failed" ? "red" : "gold"}>
          {value}
        </Tag>
      ),
    },
    {
      title: uiText("admin_ui.en_cost_64ae4"),
      key: "cost",
      width: 120,
      render: (_, record) => formatMoney(record.actualCostUsd),
    },
    {
      title: uiText("admin_ui.en_usage_0bb18"),
      key: "usage",
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.billableCredits}  {uiText("admin_ui.en_point_8a520")} {record.providerCalls}  {uiText("admin_ui.en_call_bc8d8")}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatTokens(record.inputTokens ?? null, record.outputTokens ?? null)}
          </Text>
          {record.unpricedProviderCalls > 0 && (
            <Text type="warning" style={{ fontSize: 12 }}>
              {record.unpricedProviderCalls}  {uiText("admin_ui.en_unpriced_call_d54e3")}</Text>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title={uiText("admin_ui.en_system_env_7a4e1")} bordered>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="NODE_ENV">{meta.nodeEnv}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_runtime_c4740")}>{meta.runtime}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_hostname_c983a")}>{meta.hostname}</Descriptions.Item>
            <Descriptions.Item label="PID">{meta.pid}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_uptime_sec_f72a2")}>{meta.uptimeSec}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_now_e3b82")}>{meta.now}</Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 12, opacity: 0.75 }}>
            * {t("admin_env_table.secret_masked_note")}
          </div>
        </Card>

        <Card title={uiText("admin_ui.en_config_doctor_b678f")} bordered>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t("admin_env_table.env_restart_note_1")} <Text code>.env</Text>{" "}
              {t("admin_env_table.env_restart_note_2")}
            </Typography.Paragraph>
            {configDiagnostics.map((item) => (
              <Alert closable
                key={item.code}
                showIcon
                type={
                  item.level === "ok"
                    ? "success"
                    : item.level === "warning"
                      ? "warning"
                      : "error"
                }
                message={item.title}
                description={item.detail}
              />
            ))}
          </Space>
        </Card>

        <Card title={uiText("admin_ui.en_active_runtime_b2031")} bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {activeProviders.map((summary) => (
              <Card key={summary.scope} size="small" title={summary.label}>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label={uiText("admin_ui.en_status_bae7d")}>
                    {statusTag(summary.status, uiText)}
                  </Descriptions.Item>
                  <Descriptions.Item label={uiText("admin_ui.en_configured_668c5")}>
                    {providerTag(summary.configuredProvider)}
                  </Descriptions.Item>
                  <Descriptions.Item label={uiText("admin_ui.en_effective_b0346")}>
                    {summary.effectiveProvider ? providerTag(summary.effectiveProvider) : <Tag color="red">{uiText("admin_ui.en_none_6eef6")}</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label={uiText("admin_ui.en_model_68c2c")}>
                    <Text code>{summary.model || "-"}</Text>
                  </Descriptions.Item>
                </Descriptions>
                <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                  {summary.note}
                </Typography.Paragraph>
              </Card>
            ))}
          </Space>
        </Card>

        <Card title={uiText("admin_ui.en_recent_actual_usage_81f66")} bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t("admin_env_table.usage_desc_1")} <Text code>bms_ai_usage_events</Text>
            </Typography.Paragraph>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label={uiText("admin_ui.en_latest_chat_8bd5e")}>
                {latestChatUsage ? (
                  <Space wrap>
                    {providerTag(latestChatUsage.provider)}
                    <Text code>{latestChatUsage.feature}</Text>
                    <Text type="secondary">{latestChatUsage.model || "-"}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">{t("admin_env_table.no_event")}</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.en_latest_ocr_11ef9")}>
                {latestOcrUsage ? (
                  <Space wrap>
                    {providerTag(latestOcrUsage.provider)}
                    <Text code>{latestOcrUsage.feature}</Text>
                    <Text type="secondary">{latestOcrUsage.model || "-"}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">{t("admin_env_table.no_event")}</Text>
                )}
              </Descriptions.Item>
            </Descriptions>
            <Table<RecentAiUsageEvent>
              rowKey="id"
              columns={usageColumns}
              dataSource={recentUsage}
              pagination={false}
              locale={{ emptyText: t("admin_env_table.no_usage_event") }}
              scroll={{ x: 1200 }}
              size="small"
            />
          </Space>
        </Card>

        <Card
          title={uiText("admin_ui.en_ai_provider_health_e40f3")}
          bordered
          extra={
            <Button
              icon={<PlayCircleOutlined />}
              loading={checkingAllHealth}
              onClick={runCheckAllHealth}
            >
              {t("admin_env_table.btn_check_all")}
            </Button>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t("admin_env_table.health_desc_1")} <Text code>bms_ai_provider_health</Text>{" "}
              {t("admin_env_table.health_desc_2")} <Text code>{uiText("admin_ui.en_active_runtime_b2031")}</Text>{" "}
              {t("admin_env_table.health_desc_3")} <Text code>{uiText("admin_ui.en_used_when_7b17c")}</Text>
              {t("admin_env_table.health_desc_4")}
            </Typography.Paragraph>
            <Table<AiProviderHealth>
              rowKey={(r) => `${r.provider}:${r.purpose}`}
              pagination={false}
              size="small"
              dataSource={health}
              locale={{ emptyText: t("admin_env_table.no_data") }}
              columns={[
                {
                  title: uiText("admin_ui.en_provider_7ceee"),
                  key: "provider",
                  width: 150,
                  render: (_, r) => providerTag(r.provider),
                },
                {
                  title: uiText("admin_ui.en_purpose_a0fb8"),
                  dataIndex: "purpose",
                  key: "purpose",
                  width: 100,
                  render: (v: string) => <Tag>{v}</Tag>,
                },
                {
                  title: uiText("admin_ui.en_status_bae7d"),
                  key: "status",
                  width: 150,
                  render: (_, r) => healthStatusTag(r.status, uiText),
                },
                {
                  title: uiText("admin_ui.en_used_when_7b17c"),
                  key: "used_when",
                  width: 360,
                  render: (_, r) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {healthUsageNote(r, t)}
                    </Text>
                  ),
                },
                {
                  title: uiText("admin_ui.en_detail_7c9a7"),
                  dataIndex: "status_detail",
                  key: "status_detail",
                  render: (v: string | null) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {v || "-"}
                    </Text>
                  ),
                },
                {
                  title: uiText("admin_ui.en_last_success_7094f"),
                  key: "last_success_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_success_at, uiText),
                },
                {
                  title: uiText("admin_ui.en_last_error_44cc8"),
                  key: "last_error_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_error_at, uiText),
                },
                {
                  title: uiText("admin_ui.en_last_checked_40b64"),
                  key: "last_checked_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_checked_at, uiText),
                },
              ]}
              scroll={{ x: 1460 }}
            />
          </Space>
        </Card>

        <Card
          title={
            <Space>
              <KeyOutlined />
              {uiText("admin_ui.en_shared_ai_providers_d5657")}</Space>
          }
          bordered
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t("admin_env_table.test_desc_1")}{" "}
              <Text code>.env</Text> {t("admin_env_table.test_desc_2")}
            </Typography.Paragraph>
            {PLATFORM_AI_PROVIDERS(uiText).map((provider) => {
              const result = testResults[provider.key];
              const loading = testingAiKey && activeProvider === provider.key;
              return (
                <Card
                  key={provider.key}
                  size="small"
                  title={`${provider.title} (${provider.envKey})`}
                >
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                      {t(`admin_env_table.${provider.noteKey}`)}
                    </Typography.Paragraph>
                    <Button
                      icon={<PlayCircleOutlined />}
                      loading={loading}
                      onClick={() => runProviderTest(provider.key)}
                    >
                      {t("admin_env_table.btn_test_provider", { provider: provider.title })}
                    </Button>
                    {result && (
                      <Alert closable
                        type={result.ok ? "success" : "error"}
                        showIcon
                        message={result.message}
                      />
                    )}
                  </Space>
                </Card>
              );
            })}
          </Space>
        </Card>

        <Card
          title={
            <Space>
              <SearchOutlined />
              {uiText("admin_ui.en_env_list_962ab")}</Space>
          }
          extra={<Tag>{filtered.length}  {uiText("admin_ui.en_items_7316c")}</Tag>}
          bordered
        >
          <Input
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin_env_table.search_placeholder")}
            style={{ marginBottom: 12 }}
          />

          <Table<EnvRow>
            rowKey="key"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 50, showSizeChanger: true }}
            scroll={{ x: 980 }}
          />
        </Card>
      </Space>
    </div>
  );
}
