"use client";
import React, { useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Card, Table, Tag, Input, Select, Space, Typography, Empty, Segmented } from "antd";
import { MailOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

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

const CATEGORY_LABEL: Record<string, string> = {
  digest: "สรุปยอดขาย",
  order: "สถานะออร์เดอร์",
  auth: "สมัคร/ยืนยันตัวตน",
  support: "แจ้งปัญหา",
  test: "ทดสอบระบบ",
  other: "อื่นๆ",
};

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
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [provider, setProvider] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<MailLogEntry | null>(null);
  const [previewTab, setPreviewTab] = useState<"rendered" | "source">("rendered");

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
      title: "เวลา",
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
          {dayjs(v).format("DD MMM HH:mm")}
        </span>
      ),
    },
    {
      title: "สถานะ",
      dataIndex: "status",
      width: 96,
      render: (v: string) =>
        v === "success" ? <Tag color="success">สำเร็จ</Tag> : <Tag color="error">ผิดพลาด</Tag>,
    },
    {
      title: "หัวเรื่อง",
      dataIndex: "subject",
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">(ไม่มีหัวเรื่อง)</Text>,
    },
    { title: "ผู้รับ", dataIndex: "toEmail", ellipsis: true, width: 220 },
    {
      title: "ร้าน",
      dataIndex: "tenantName",
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">— (ระบบ)</Text>,
    },
    {
      title: "ประเภท",
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
            <Text type="secondary" style={{ fontSize: 12 }}>ส่งทั้งหมด (24 ชม.)</Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{stats?.total ?? "—"}</div>
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>สำเร็จ</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#16794f" }}>{stats?.success ?? "—"}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{okRate !== null ? `${okRate}% อัตราสำเร็จ` : "—"}</Text>
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>ผิดพลาด</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#b3261e" }}>{stats?.error ?? "—"}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {stats?.topErrorProvider ? `ส่วนใหญ่จาก ${stats.topErrorProvider}` : "ไม่มี"}
            </Text>
          </Card>
        </div>

        <Card
          title={<span><MailOutlined /> Mail log</span>}
          extra={
            <Space wrap>
              <Input.Search
                placeholder="ค้นหา: ผู้รับ, หัวเรื่อง"
                allowClear
                style={{ width: 220 }}
                onSearch={(v) => { setPage(1); setQ(v); }}
              />
              <Segmented
                options={[
                  { label: "ทั้งหมด", value: "" },
                  { label: "สำเร็จ", value: "success" },
                  { label: "ผิดพลาด", value: "error" },
                ]}
                value={status ?? ""}
                onChange={(v) => { setPage(1); setStatus((v as string) || undefined); }}
              />
              <Select
                allowClear
                placeholder="Provider"
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
                placeholder="ประเภท"
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
            title={selected.subject || "(ไม่มีหัวเรื่อง)"}
            extra={
              selected.status === "success"
                ? <Tag color="success">สำเร็จ</Tag>
                : <Tag color="error">ผิดพลาด</Tag>
            }
          >
            <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
              <div><Text type="secondary">ผู้รับ: </Text><Text code>{selected.toEmail}</Text></div>
              <div><Text type="secondary">จาก: </Text><Text code>{selected.fromEmail || "—"}</Text></div>
              <div><Text type="secondary">ร้าน: </Text>{selected.tenantName || "— (ระบบ)"}</div>
              <div><Text type="secondary">Provider: </Text><Text code>{selected.provider}</Text></div>
              <div><Text type="secondary">สั่งงานจาก: </Text><Text code>{selected.triggeredBy || "—"}</Text></div>
              <div><Text type="secondary">เวลา: </Text>{dayjs(selected.createdAt).format("DD MMM YYYY HH:mm:ss")}</div>
              {selected.status === "success" && (
                <div><Text type="secondary">Message ID: </Text><Text code>{selected.messageId || "—"}</Text></div>
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
                { label: "เนื้อหาที่ส่ง", value: "rendered" },
                { label: "HTML source", value: "source" },
              ]}
              value={previewTab}
              onChange={(v) => setPreviewTab(v as "rendered" | "source")}
              style={{ marginBottom: 8 }}
            />

            {selected.html ? (
              previewTab === "rendered" ? (
                <div style={{ border: "1px solid var(--app-border)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                  <iframe
                    title="ตัวอย่างอีเมล"
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
              <Empty description="ไม่มีเนื้อหา HTML" />
            )}
          </Card>
        )}
      </Space>
    </div>
  );
}
