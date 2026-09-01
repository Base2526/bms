"use client";

import { useEffect, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Button, Card, Descriptions, Empty, Input, message, Select, Space, Table, Tag, Timeline, Typography,
} from "antd";
import { CustomerServiceOutlined, DownloadOutlined, SaveOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useI18n } from "@/lib/i18nContext";

const { Paragraph, Text, Title } = Typography;

const Q_SUPPORT_TICKETS = gql`
  query BmsSupportTickets($q: String, $status: String, $topic: String, $page: Int, $pageSize: Int) {
    bmsSupportTickets(q: $q, status: $status, topic: $topic, page: $page, pageSize: $pageSize) {
      total
      items {
        id
        ticketId
        name
        email
        phone
        topic
        subject
        message
        ref
        pageUrl
        userAgent
        ip
        status
        createdAt
        updatedAt
        closedAt
        diagnosticBundleId
        comments {
          id
          authorId
          authorEmail
          fromStatus
          toStatus
          body
          createdAt
        }
      }
    }
  }
`;

const M_UPDATE_SUPPORT_TICKET = gql`
  mutation BmsUpdateSupportTicket($input: BmsUpdateSupportTicketInput!) {
    bmsUpdateSupportTicket(input: $input) {
      id
      ticketId
      name
      email
      phone
      topic
      subject
      message
      ref
      pageUrl
      userAgent
      ip
      status
      createdAt
      updatedAt
      closedAt
      diagnosticBundleId
      comments {
        id
        authorId
        authorEmail
        fromStatus
        toStatus
        body
        createdAt
      }
    }
  }
`;

type SupportTicketComment = {
  id: string;
  authorId: string | null;
  authorEmail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  body: string;
  createdAt: string;
};

type SupportTicket = {
  id: string;
  ticketId: string;
  name: string | null;
  email: string;
  phone: string | null;
  topic: string;
  subject: string;
  message: string;
  ref: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  ip: string | null;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  closedAt: string | null;
  diagnosticBundleId: string | null;
  comments: SupportTicketComment[];
};

function topicLabels(t: (key: string) => string): Record<string, string> {
  return {
    channel_setup: t("admin_support_tickets.topic_channel_setup"),
    ai_inbox: t("admin_support_tickets.topic_ai_inbox"),
    orders_inventory: t("admin_support_tickets.topic_orders_inventory"),
    payments_checkout: t("admin_support_tickets.topic_payments_checkout"),
    reports_billing: "Reports / Billing",
    bug: "Bug",
    feature: "Feature",
    general: t("admin_support_tickets.topic_general"),
    account: t("admin_support_tickets.topic_account"),
    billing: "Billing",
  };
}

const TOPIC_FILTERS = [
  "channel_setup",
  "ai_inbox",
  "orders_inventory",
  "payments_checkout",
  "reports_billing",
  "bug",
  "feature",
];

function statusTag(status: string, t: (key: string) => string) {
  if (status === "open") return <Tag color="red">{t("admin_support_tickets.status_open")}</Tag>;
  if (status === "pending") return <Tag color="gold">{t("admin_support_tickets.status_pending")}</Tag>;
  if (status === "closed") return <Tag color="green">{t("admin_support_tickets.status_closed")}</Tag>;
  return <Tag>{status}</Tag>;
}

export default function SupportTicketsPage() {
  const { t } = useI18n();
  const TOPIC_LABEL = topicLabels(t);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [topic, setTopic] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>("open");
  const [comment, setComment] = useState("");

  const { data, loading, refetch } = useQuery(Q_SUPPORT_TICKETS, {
    variables: { q: q || undefined, status, topic, page, pageSize },
    fetchPolicy: "cache-and-network",
  });
  const [updateTicket, { loading: updating }] = useMutation(M_UPDATE_SUPPORT_TICKET, {
    onCompleted: (result) => {
      const updated = result?.bmsUpdateSupportTicket;
      if (updated) {
        setSelected(updated);
        setDraftStatus(updated.status);
        setComment("");
      }
      message.success(t("admin_support_tickets.update_success"));
      refetch();
    },
    onError: (error) => message.error(error?.message || t("admin_support_tickets.update_failed")),
  });

  useEffect(() => {
    if (!selected) return;
    setDraftStatus(selected.status);
    setComment("");
  }, [selected?.id, selected?.status]);

  const items: SupportTicket[] = data?.bmsSupportTickets?.items ?? [];
  const total: number = data?.bmsSupportTickets?.total ?? 0;

  const columns = [
    {
      title: t("admin_support_tickets.col_time"),
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>{dayjs(v).format("DD MMM HH:mm")}</span>
      ),
    },
    {
      title: "Ticket",
      dataIndex: "ticketId",
      width: 170,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: t("admin_support_tickets.col_status"),
      dataIndex: "status",
      width: 100,
      render: (s: string) => statusTag(s, t),
    },
    {
      title: t("admin_support_tickets.col_subject"),
      dataIndex: "subject",
      ellipsis: true,
      render: (v: string, row: SupportTicket) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{TOPIC_LABEL[row.topic] || row.topic}</Text>
        </Space>
      ),
    },
    {
      title: t("admin_support_tickets.col_contact"),
      dataIndex: "email",
      width: 240,
      ellipsis: true,
      render: (v: string, row: SupportTicket) => (
        <Space direction="vertical" size={0}>
          <Text>{row.name || t("admin_support_tickets.no_name")}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: t("admin_support_tickets.col_ref"),
      dataIndex: "ref",
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">-</Text>,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>
            <CustomerServiceOutlined /> Support Tickets
          </Title>
          <Text type="secondary">{t("admin_support_tickets.page_subtitle")}</Text>
        </div>

        <Card
          extra={
            <Space wrap>
              <Input.Search
                allowClear
                placeholder={t("admin_support_tickets.search_placeholder")}
                style={{ width: 260 }}
                onSearch={(value) => { setPage(1); setQ(value); }}
              />
              <Select
                allowClear
                placeholder={t("admin_support_tickets.status_placeholder")}
                style={{ width: 140 }}
                value={status}
                onChange={(value) => { setPage(1); setStatus(value); }}
                options={[
                  { value: "open", label: t("admin_support_tickets.status_open") },
                  { value: "pending", label: t("admin_support_tickets.status_pending") },
                  { value: "closed", label: t("admin_support_tickets.status_closed") },
                ]}
              />
              <Select
                allowClear
                placeholder={t("admin_support_tickets.topic_placeholder")}
                style={{ width: 170 }}
                value={topic}
                onChange={(value) => { setPage(1); setTopic(value); }}
                options={TOPIC_FILTERS.map((value) => ({ value, label: TOPIC_LABEL[value] }))}
              />
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            onRow={(record) => ({
              onClick: () => setSelected(record),
              style: { cursor: "pointer" },
            })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize || 20);
              },
            }}
          />
        </Card>

        {selected ? (
          <Card
            title={`${selected.ticketId} · ${selected.subject}`}
            extra={
              <Space wrap>
                <Select
                  value={draftStatus}
                  style={{ width: 150 }}
                  onChange={setDraftStatus}
                  options={[
                    { value: "open", label: t("admin_support_tickets.status_open") },
                    { value: "pending", label: t("admin_support_tickets.status_pending") },
                    { value: "closed", label: t("admin_support_tickets.status_closed") },
                  ]}
                />
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={updating}
                  disabled={draftStatus === selected.status && !comment.trim()}
                  onClick={() => updateTicket({
                    variables: {
                      input: {
                        id: selected.id,
                        status: draftStatus,
                        comment: comment.trim() || null,
                      },
                    },
                  })}
                >
                  {t("admin_support_tickets.save")}
                </Button>
              </Space>
            }
          >
            <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label={t("admin_support_tickets.detail_status")}>{statusTag(selected.status, t)}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_created")}>{dayjs(selected.createdAt).format("DD MMM YYYY HH:mm")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_updated")}>{selected.updatedAt ? dayjs(selected.updatedAt).format("DD MMM YYYY HH:mm") : "-"}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_closed")}>{selected.closedAt ? dayjs(selected.closedAt).format("DD MMM YYYY HH:mm") : "-"}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_name")}>{selected.name || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_email")}>{selected.email}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_phone")}>{selected.phone || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("admin_support_tickets.detail_topic")}>{TOPIC_LABEL[selected.topic] || selected.topic}</Descriptions.Item>
              <Descriptions.Item label="Ref">{selected.ref || "-"}</Descriptions.Item>
              <Descriptions.Item label="IP">{selected.ip || "-"}</Descriptions.Item>
              <Descriptions.Item label="Page URL" span={2}>{selected.pageUrl || "-"}</Descriptions.Item>
              <Descriptions.Item label="User Agent" span={2}>{selected.userAgent || "-"}</Descriptions.Item>
              {selected.diagnosticBundleId ? (
                <Descriptions.Item label={t("admin_support_tickets.diagnostic_bundle")} span={2}>
                  <Button
                    icon={<DownloadOutlined />}
                    href={`/api/bms/support-diagnostics/bundles/${encodeURIComponent(selected.diagnosticBundleId)}/download`}
                  >
                    {t("admin_support_tickets.download_diagnostics")}
                  </Button>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
            <Paragraph style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{selected.message}</Paragraph>

            <Card size="small" title="Internal comment" style={{ marginTop: 16 }}>
              <Input.TextArea
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t("admin_support_tickets.comment_placeholder")}
              />
              <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                {t("admin_support_tickets.comment_visibility_hint")}
              </Text>
            </Card>

            <Card size="small" title="Comments" style={{ marginTop: 16 }}>
              {selected.comments.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_support_tickets.no_comments")} />
              ) : (
                <Timeline
                  items={selected.comments.map((item) => ({
                    children: (
                      <Space direction="vertical" size={2}>
                        <Space wrap>
                          <Text strong>{item.authorEmail || "platform admin"}</Text>
                          <Text type="secondary">{dayjs(item.createdAt).format("DD MMM YYYY HH:mm")}</Text>
                          {item.fromStatus !== item.toStatus ? (
                            <Text type="secondary">
                              {item.fromStatus || "-"} -&gt; {item.toStatus || "-"}
                            </Text>
                          ) : null}
                        </Space>
                        <Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>{item.body}</Paragraph>
                      </Space>
                    ),
                  }))}
                />
              )}
            </Card>
          </Card>
        ) : (
          <Card>
            <Empty description={t("admin_support_tickets.select_ticket_hint")} />
          </Card>
        )}
      </Space>
    </div>
  );
}
