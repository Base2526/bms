"use client";
import React, { useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Card, Table, Tag, Input, Select, Space, Typography, Empty, Segmented } from "antd";
import { MailOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph } = Typography;

const Q_STATS = gql`
  query {
    bmsMailLogStats { total success error topErrorProvider }
  }
`;

const Q_MAIL_LOG = gql`
  query BmsMailLog($q: String, $status: String, $provider: String, $category: String, $page: Int, $pageSize: Int) {
    bmsMailLog(q: $q, status: $status, provider: $provider, category: $category, page: $page, pageSize: $pageSize) {
      total
      items {
        id
        tenantId
        tenantName
        category
        provider
        toEmail
        fromEmail
        subject
        status
        messageId
        statusCode
        error
        html
        textBody
        triggeredBy
        createdAt
      }
    }
  }
`;

function categoryLabels(t: (key: string) => string): Record<string, string> {
  return {
    digest: t("admin_mail_log.category_digest"),
    order: t("admin_mail_log.category_order"),
    auth: t("admin_mail_log.category_auth"),
    support: t("admin_mail_log.category_support"),
    test: t("admin_mail_log.category_test"),
    other: t("admin_mail_log.category_other"),
  };
}

type MailLogEntry = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  category: string;
  provider: string;
  toEmail: string;
  fromEmail: string | null;
  subject: string | null;
  status: "success" | "error";
  messageId: string | null;
  statusCode: number | null;
  error: string | null;
  html: string | null;
  textBody: string | null;
  triggeredBy: string | null;
  createdAt: string;
};

export default function MailLogPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [provider, setProvider] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<MailLogEntry | null>(null);
  const [previewTab, setPreviewTab] = useState<"rendered" | "source">("rendered");

  const CATEGORY_LABEL = categoryLabels(t);

  const { data: statsData } = useQuery(Q_STATS, { fetchPolicy: "cache-and-network", pollInterval: 60000 });
  const stats = statsData?.bmsMailLogStats;

  const { data, loading, refetch } = useQuery(Q_MAIL_LOG, {
    variables: { q: q || undefined, status, provider, category, page, pageSize },
    fetchPolicy: "cache-and-network",
  });

  const items: MailLogEntry[] = data?.bmsMailLog?.items ?? [];
  const total: number = data?.bmsMailLog?.total ?? 0;

  const columns = [
    {
      title: t("admin_mail_log.col_time"),
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
          {dayjs(v).format("DD MMM HH:mm")}
        </span>
      ),
    },
    {
      title: t("admin_mail_log.col_status"),
      dataIndex: "status",
      width: 96,
      render: (v: string) =>
        v === "success" ? <Tag color="success">{t("admin_mail_log.status_success")}</Tag> : <Tag color="error">{t("admin_mail_log.status_error")}</Tag>,
    },
    {
      title: t("admin_mail_log.col_subject"),
      dataIndex: "subject",
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">{t("admin_mail_log.no_subject")}</Text>,
    },
    { title: t("admin_mail_log.col_to"), dataIndex: "toEmail", ellipsis: true, width: 220 },
    {
      title: t("admin_mail_log.col_shop"),
      dataIndex: "tenantName",
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">{t("admin_mail_log.system_shop")}</Text>,
    },
    {
      title: t("admin_mail_log.col_category"),
      dataIndex: "category",
      width: 130,
      render: (v: string) => CATEGORY_LABEL[v] || v,
    },
    { title: "Provider", dataIndex: "provider", width: 90 },
  ];

  const okRate = stats?.total ? Math.round((stats.success / stats.total) * 100) : null;

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Card size="small" style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_mail_log.stat_total_24h")}</Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{stats?.total ?? "—"}</div>
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_mail_log.stat_success")}</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#16794f" }}>{stats?.success ?? "—"}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{okRate !== null ? t("admin_mail_log.stat_success_rate", { rate: okRate }) : "—"}</Text>
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_mail_log.stat_error")}</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#b3261e" }}>{stats?.error ?? "—"}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {stats?.topErrorProvider ? t("admin_mail_log.stat_top_error_provider", { provider: stats.topErrorProvider }) : t("admin_mail_log.stat_error_none")}
            </Text>
          </Card>
        </div>

        <Card
          title={<span><MailOutlined /> {t("admin_mail_log.title")}</span>}
          extra={
            <Space wrap>
              <Input.Search
                placeholder={t("admin_mail_log.search_placeholder")}
                allowClear
                style={{ width: 220 }}
                onSearch={(v) => { setPage(1); setQ(v); }}
              />
              <Segmented
                options={[
                  { label: t("admin_mail_log.filter_all"), value: "" },
                  { label: t("admin_mail_log.filter_success"), value: "success" },
                  { label: t("admin_mail_log.filter_error"), value: "error" },
                ]}
                value={status ?? ""}
                onChange={(v) => { setPage(1); setStatus((v as string) || undefined); }}
              />
              <Select
                allowClear
                placeholder={t("admin_mail_log.provider_placeholder")}
                style={{ width: 130 }}
                value={provider}
                onChange={(v) => { setPage(1); setProvider(v); }}
                options={[
                  { value: "sendgrid", label: "SendGrid" },
                  { value: "gmail", label: "Gmail SMTP" },
                ]}
              />
              <Select
                allowClear
                placeholder={t("admin_mail_log.category_placeholder")}
                style={{ width: 160 }}
                value={category}
                onChange={(v) => { setPage(1); setCategory(v); }}
                options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={items}
            columns={columns}
            onRow={(record) => ({
              onClick: () => { setSelected(record); setPreviewTab("rendered"); },
              style: { cursor: "pointer" },
            })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (p, ps) => { setPage(p); setPageSize(ps || 20); },
            }}
          />
        </Card>

        {selected && (
          <Card
            title={selected.subject || t("admin_mail_log.no_subject")}
            extra={
              selected.status === "success"
                ? <Tag color="success">{t("admin_mail_log.status_success")}</Tag>
                : <Tag color="error">{t("admin_mail_log.status_error")}</Tag>
            }
          >
            <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
              <div><Text type="secondary">{t("admin_mail_log.detail_to")} </Text><Text code>{selected.toEmail}</Text></div>
              <div><Text type="secondary">{t("admin_mail_log.detail_from")} </Text><Text code>{selected.fromEmail || "—"}</Text></div>
              <div><Text type="secondary">{t("admin_mail_log.detail_shop")} </Text>{selected.tenantName || t("admin_mail_log.system_shop")}</div>
              <div><Text type="secondary">{t("admin_mail_log.detail_provider")} </Text><Text code>{selected.provider}</Text></div>
              <div><Text type="secondary">{t("admin_mail_log.detail_triggered_by")} </Text><Text code>{selected.triggeredBy || "—"}</Text></div>
              <div><Text type="secondary">{t("admin_mail_log.detail_time")} </Text>{dayjs(selected.createdAt).format("DD MMM YYYY HH:mm:ss")}</div>
              {selected.status === "success" && (
                <div><Text type="secondary">{t("admin_mail_log.detail_message_id")} </Text><Text code>{selected.messageId || "—"}</Text></div>
              )}
            </Space>

            {selected.status === "error" && selected.error && (
              <Paragraph
                style={{
                  background: "var(--app-surface-2, #fdecea)",
                  border: "1px solid rgba(179,38,30,0.28)",
                  color: "#b3261e",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontFamily: "monospace",
                  fontSize: 12.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {selected.error}
              </Paragraph>
            )}

            <Segmented
              options={[
                { label: t("admin_mail_log.tab_rendered"), value: "rendered" },
                { label: t("admin_mail_log.tab_source"), value: "source" },
              ]}
              value={previewTab}
              onChange={(v) => setPreviewTab(v as "rendered" | "source")}
              style={{ marginBottom: 8 }}
            />

            {selected.html ? (
              previewTab === "rendered" ? (
                <div style={{ border: "1px solid var(--app-border)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                  <iframe
                    title={t("admin_mail_log.preview_title")}
                    srcDoc={selected.html}
                    style={{ width: "100%", height: 360, border: 0, display: "block", background: "#fff" }}
                  />
                </div>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 360,
                    overflow: "auto",
                    background: "var(--app-surface-2)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: "monospace",
                    fontSize: 11.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selected.html}
                </pre>
              )
            ) : (
              <Empty description={t("admin_mail_log.no_html")} />
            )}
          </Card>
        )}
      </Space>
    </div>
  );
}
