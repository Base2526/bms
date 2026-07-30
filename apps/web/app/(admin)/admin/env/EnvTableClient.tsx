// app/admin/env/EnvTableClient.tsx
"use client";

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
const PLATFORM_AI_PROVIDERS = [
  {
    key: "anthropic",
    title: "Anthropic Chat",
    envKey: "ANTHROPIC_API_KEY",
    note: "ทดสอบด้วย GET /v1/models ไม่เสียเงิน",
  },
  {
    key: "anthropic-ocr",
    title: "Anthropic OCR Fallback",
    envKey: "ANTHROPIC_API_KEY",
    note: "ทดสอบ image/OCR request ขนาดเล็ก เพื่อยืนยันว่า Claude fallback อ่านสลิปได้จริง (มี usage เล็กน้อย)",
  },
  {
    key: "deepseek",
    title: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    note: "ทดสอบด้วยข้อความสั้นผ่าน anthropic-compatible API (มี usage เล็กน้อย)",
  },
  {
    key: "qwen",
    title: "QWEN OCR",
    envKey: "QWEN_OCR_API_KEY",
    note: "ทดสอบด้วย OCR request ขนาดเล็กกับ model ที่ตั้งใน env (มี usage เล็กน้อย)",
  },
] as const;
type PlatformAiProviderKey = (typeof PLATFORM_AI_PROVIDERS)[number]["key"];

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

function healthStatusTag(status: AiProviderHealth["status"]) {
  if (status === "connected") return <Tag color="green">CONNECTED</Tag>;
  if (status === "unconfigured") return <Tag>UNCONFIGURED</Tag>;
  if (status === "token_expired") return <Tag color="red">TOKEN EXPIRED</Tag>;
  if (status === "rate_limited") return <Tag color="gold">RATE LIMITED</Tag>;
  if (status === "stale") return <Tag color="orange">STALE</Tag>;
  return <Tag color="red">SEND FAILED</Tag>;
}

function statusTag(status: ActiveProviderSummary["status"]) {
  if (status === "active") return <Tag color="green">ACTIVE</Tag>;
  if (status === "fallback") return <Tag color="gold">FALLBACK</Tag>;
  return <Tag color="red">MISSING</Tag>;
}

function providerTag(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized === "deepseek") return <Tag color="blue">DeepSeek</Tag>;
  if (normalized === "qwen") return <Tag color="purple">QWEN OCR</Tag>;
  if (normalized === "anthropic-ocr") return <Tag color="green">Anthropic OCR</Tag>;
  if (normalized === "anthropic") return <Tag color="green">Anthropic</Tag>;
  return <Tag>{provider}</Tag>;
}

function healthUsageNote(row: AiProviderHealth) {
  if (row.provider === "deepseek" && row.purpose === "chat") {
    return "ใช้กับ chat/tool-calling ทั่วไปเมื่อ BMS_AI_PROVIDER=deepseek หรือ fallback จาก Anthropic chat";
  }
  if (row.provider === "anthropic" && row.purpose === "chat") {
    return "ใช้เป็น sensitive/baseline chat หรือ fallback เมื่อ DeepSeek chat ไม่ถูกตั้งค่า";
  }
  if (row.provider === "qwen" && row.purpose === "ocr") {
    return "ใช้เป็น Slip OCR หลักเมื่อ BMS_SLIP_READER_PROVIDER=qwen";
  }
  if (row.provider === "anthropic" && row.purpose === "ocr") {
    return "ใช้เป็น Slip OCR fallback เมื่อ QWEN ไม่ถูกตั้งค่า หรือ request จริงล้มเหลว";
  }
  return "เช็กการเชื่อมต่อ provider/purpose นี้ ไม่ได้แปลว่าถูกเลือกเป็นตัวหลัก";
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMoney(value: number) {
  return `$${value.toFixed(4)}`;
}

export default function EnvTableClient({
  env,
  meta,
  activeProviders,
  recentUsage,
  providerHealth,
  configDiagnostics,
}: Props) {
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
        message.success("ตรวจสอบครบทุก provider/purpose แล้ว — ดูผลในตารางด้านล่าง");
      },
      onError: (error) => {
        message.error(error?.message || "ตรวจสอบไม่สำเร็จ");
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
      message.success("Copied");
    } catch {
      // fallback
      try {
        const el = document.createElement("textarea");
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        message.success("Copied");
      } catch {
        message.error("Copy failed");
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
            data?.bmsTestPlatformAiKey ?? { ok: false, message: "ทดสอบไม่สำเร็จ" },
        }));
        setActiveProvider((current) => (current === provider ? null : current));
      },
      onError: (error) => {
        setTestResults((prev) => ({
          ...prev,
          [provider]: { ok: false, message: error?.message || "ทดสอบไม่สำเร็จ" },
        }));
        setActiveProvider((current) => (current === provider ? null : current));
      },
    });
  };

  const columns: ColumnsType<EnvRow> = [
    {
      title: "Key",
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
      title: "Value",
      dataIndex: "value",
      key: "value",
      render: (v: string) => (
        <Text code style={{ wordBreak: "break-all" }}>
          {v || "(empty)"}
        </Text>
      ),
    },
    {
      title: "Masked",
      dataIndex: "masked",
      key: "masked",
      width: 110,
      align: "center",
      render: (m: boolean) => (m ? <Tag color="gold">MASKED</Tag> : <Tag>OK</Tag>),
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
      title: "Actions",
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => copy(record.key)}>
            Copy Key
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => copy(record.value)}>
            Copy Value
          </Button>
        </Space>
      ),
    },
  ];
  const usageColumns: ColumnsType<RecentAiUsageEvent> = [
    {
      title: "When",
      key: "createdAt",
      width: 190,
      render: (_, record) => formatDateTime(record.createdAt),
    },
    {
      title: "Tenant",
      key: "tenant",
      width: 180,
      render: (_, record) => record.tenantName || record.tenantId.slice(0, 8),
    },
    {
      title: "Feature",
      dataIndex: "feature",
      key: "feature",
      width: 180,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: "Provider",
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
      title: "Source",
      dataIndex: "source",
      key: "source",
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "Routing",
      key: "routing",
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text code>{record.routingReason || "-"}</Text>
          {record.fallbackFrom ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              fallback from {record.fallbackFrom}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Status",
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
      title: "Cost",
      key: "cost",
      width: 120,
      render: (_, record) => formatMoney(record.estimatedCost),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title="System ENV" bordered>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="NODE_ENV">{meta.nodeEnv}</Descriptions.Item>
            <Descriptions.Item label="Runtime">{meta.runtime}</Descriptions.Item>
            <Descriptions.Item label="Hostname">{meta.hostname}</Descriptions.Item>
            <Descriptions.Item label="PID">{meta.pid}</Descriptions.Item>
            <Descriptions.Item label="Uptime (sec)">{meta.uptimeSec}</Descriptions.Item>
            <Descriptions.Item label="Now">{meta.now}</Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 12, opacity: 0.75 }}>
            * ค่า secret จะถูก mask อัตโนมัติ (Copy Value จะได้ค่า mask ไม่ใช่ค่าจริง)
          </div>
        </Card>

        <Card title="Config Doctor" bordered>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              ตรวจค่าที่ process นี้ใช้งานจริง หลังแก้ <Text code>.env</Text> ต้อง restart server
              แล้วโหลดหน้านี้ใหม่
            </Typography.Paragraph>
            {configDiagnostics.map((item) => (
              <Alert
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

        <Card title="Active Runtime" bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {activeProviders.map((summary) => (
              <Card key={summary.scope} size="small" title={summary.label}>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="Status">
                    {statusTag(summary.status)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Configured">
                    {providerTag(summary.configuredProvider)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Effective">
                    {summary.effectiveProvider ? providerTag(summary.effectiveProvider) : <Tag color="red">None</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Model">
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

        <Card title="Recent Actual Usage" bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              ใช้ดูว่าระบบเรียก provider อะไรจริงล่าสุดจาก <Text code>bms_ai_usage_events</Text>
            </Typography.Paragraph>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Latest Chat">
                {latestChatUsage ? (
                  <Space wrap>
                    {providerTag(latestChatUsage.provider)}
                    <Text code>{latestChatUsage.feature}</Text>
                    <Text type="secondary">{latestChatUsage.model || "-"}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">ยังไม่มี event</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Latest OCR">
                {latestOcrUsage ? (
                  <Space wrap>
                    {providerTag(latestOcrUsage.provider)}
                    <Text code>{latestOcrUsage.feature}</Text>
                    <Text type="secondary">{latestOcrUsage.model || "-"}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">ยังไม่มี event</Text>
                )}
              </Descriptions.Item>
            </Descriptions>
            <Table<RecentAiUsageEvent>
              rowKey="id"
              columns={usageColumns}
              dataSource={recentUsage}
              pagination={false}
              locale={{ emptyText: "ยังไม่มี usage event" }}
              scroll={{ x: 1200 }}
              size="small"
            />
          </Space>
        </Card>

        <Card
          title="AI Provider Health"
          bordered
          extra={
            <Button
              icon={<PlayCircleOutlined />}
              loading={checkingAllHealth}
              onClick={runCheckAllHealth}
            >
              ตรวจสอบทั้งหมดตอนนี้
            </Button>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              สถานะเชื่อมต่อล่าสุดจาก <Text code>bms_ai_provider_health</Text> — ตารางนี้ตอบแค่ว่า
              provider/purpose นั้นต่อได้ไหม ส่วนระบบจะเลือกใช้ตอนไหนให้ดูที่ <Text code>Active Runtime</Text>
              และคอลัมน์ <Text code>Used When</Text>. การตรวจสอบจะยิง request จริงไปหา provider
              จึงมี usage เล็กน้อยจริง ไม่ใช่ read-only refresh
            </Typography.Paragraph>
            <Table<AiProviderHealth>
              rowKey={(r) => `${r.provider}:${r.purpose}`}
              pagination={false}
              size="small"
              dataSource={health}
              locale={{ emptyText: "ยังไม่มีข้อมูล" }}
              columns={[
                {
                  title: "Provider",
                  key: "provider",
                  width: 150,
                  render: (_, r) => providerTag(r.provider),
                },
                {
                  title: "Purpose",
                  dataIndex: "purpose",
                  key: "purpose",
                  width: 100,
                  render: (v: string) => <Tag>{v}</Tag>,
                },
                {
                  title: "Status",
                  key: "status",
                  width: 150,
                  render: (_, r) => healthStatusTag(r.status),
                },
                {
                  title: "Used When",
                  key: "used_when",
                  width: 360,
                  render: (_, r) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {healthUsageNote(r)}
                    </Text>
                  ),
                },
                {
                  title: "Detail",
                  dataIndex: "status_detail",
                  key: "status_detail",
                  render: (v: string | null) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {v || "-"}
                    </Text>
                  ),
                },
                {
                  title: "Last Success",
                  key: "last_success_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_success_at),
                },
                {
                  title: "Last Error",
                  key: "last_error_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_error_at),
                },
                {
                  title: "Last Checked",
                  key: "last_checked_at",
                  width: 190,
                  render: (_, r) => formatDateTime(r.last_checked_at),
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
              Shared AI Providers
            </Space>
          }
          bordered
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              ทดสอบการเชื่อมต่อ provider กลางที่ระบบใช้กับ AI และ OCR โดยอ่านค่าจาก{" "}
              <Text code>.env</Text> จริงของเซิร์ฟเวอร์
            </Typography.Paragraph>
            {PLATFORM_AI_PROVIDERS.map((provider) => {
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
                      {provider.note}
                    </Typography.Paragraph>
                    <Button
                      icon={<PlayCircleOutlined />}
                      loading={loading}
                      onClick={() => runProviderTest(provider.key)}
                    >
                      ทดสอบ {provider.title}
                    </Button>
                    {result && (
                      <Alert
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
              ENV List
            </Space>
          }
          extra={<Tag>{filtered.length} items</Tag>}
          bordered
        >
          <Input
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key เช่น DATABASE / REDIS / NEXT_ ..."
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
