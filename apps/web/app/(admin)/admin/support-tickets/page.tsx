"use client";

import { useEffect, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Button, Card, Descriptions, Empty, Input, message, Select, Space, Table, Tag, Timeline, Typography,
} from "antd";
import { CustomerServiceOutlined, SaveOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

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
  comments: SupportTicketComment[];
};

const TOPIC_LABEL: Record<string, string> = {
  channel_setup: "ตั้งค่าช่องทาง / Webhook",
  ai_inbox: "ผู้ช่วย AI / Inbox",
  orders_inventory: "ออเดอร์ / สต๊อก / Restock",
  payments_checkout: "ชำระเงิน / Checkout",
  reports_billing: "Reports / Billing",
  bug: "Bug",
  feature: "Feature",
  general: "ทั่วไป",
  account: "บัญชีผู้ใช้",
  billing: "Billing",
};

const TOPIC_FILTERS = [
  "channel_setup",
  "ai_inbox",
  "orders_inventory",
  "payments_checkout",
  "reports_billing",
  "bug",
  "feature",
];

function statusTag(status: string) {
  if (status === "open") return <Tag color="red">เปิดอยู่</Tag>;
  if (status === "pending") return <Tag color="gold">รอติดตาม</Tag>;
  if (status === "closed") return <Tag color="green">ปิดแล้ว</Tag>;
  return <Tag>{status}</Tag>;
}

export default function SupportTicketsPage() {
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
      message.success("อัปเดต support ticket แล้ว");
      refetch();
    },
    onError: (error) => message.error(error?.message || "อัปเดตไม่สำเร็จ"),
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
      title: "เวลา",
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
      title: "สถานะ",
      dataIndex: "status",
      width: 100,
      render: statusTag,
    },
    {
      title: "หัวข้อ",
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
      title: "ผู้ติดต่อ",
      dataIndex: "email",
      width: 240,
      ellipsis: true,
      render: (v: string, row: SupportTicket) => (
        <Space direction="vertical" size={0}>
          <Text>{row.name || "ไม่ระบุชื่อ"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: "อ้างอิง",
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
          <Text type="secondary">รายการจากฟอร์ม /support สำหรับ super admin ตรวจสอบและติดตาม</Text>
        </div>

        <Card
          extra={
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="ค้นหา ticket, email, ชื่อ, หัวข้อ"
                style={{ width: 260 }}
                onSearch={(value) => { setPage(1); setQ(value); }}
              />
              <Select
                allowClear
                placeholder="สถานะ"
                style={{ width: 140 }}
                value={status}
                onChange={(value) => { setPage(1); setStatus(value); }}
                options={[
                  { value: "open", label: "เปิดอยู่" },
                  { value: "pending", label: "รอติดตาม" },
                  { value: "closed", label: "ปิดแล้ว" },
                ]}
              />
              <Select
                allowClear
                placeholder="ประเภท"
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
                    { value: "open", label: "เปิดอยู่" },
                    { value: "pending", label: "รอติดตาม" },
                    { value: "closed", label: "ปิดแล้ว" },
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
                  บันทึก
                </Button>
              </Space>
            }
          >
            <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label="สถานะ">{statusTag(selected.status)}</Descriptions.Item>
              <Descriptions.Item label="สร้างเมื่อ">{dayjs(selected.createdAt).format("DD MMM YYYY HH:mm")}</Descriptions.Item>
              <Descriptions.Item label="อัปเดตล่าสุด">{selected.updatedAt ? dayjs(selected.updatedAt).format("DD MMM YYYY HH:mm") : "-"}</Descriptions.Item>
              <Descriptions.Item label="ปิดเมื่อ">{selected.closedAt ? dayjs(selected.closedAt).format("DD MMM YYYY HH:mm") : "-"}</Descriptions.Item>
              <Descriptions.Item label="ชื่อ">{selected.name || "-"}</Descriptions.Item>
              <Descriptions.Item label="อีเมล">{selected.email}</Descriptions.Item>
              <Descriptions.Item label="โทร">{selected.phone || "-"}</Descriptions.Item>
              <Descriptions.Item label="ประเภท">{TOPIC_LABEL[selected.topic] || selected.topic}</Descriptions.Item>
              <Descriptions.Item label="Ref">{selected.ref || "-"}</Descriptions.Item>
              <Descriptions.Item label="IP">{selected.ip || "-"}</Descriptions.Item>
              <Descriptions.Item label="Page URL" span={2}>{selected.pageUrl || "-"}</Descriptions.Item>
              <Descriptions.Item label="User Agent" span={2}>{selected.userAgent || "-"}</Descriptions.Item>
            </Descriptions>
            <Paragraph style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{selected.message}</Paragraph>

            <Card size="small" title="Internal comment" style={{ marginTop: 16 }}>
              <Input.TextArea
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="ใส่ note ภายใน เช่น ติดต่อกลับแล้ว, รอ log เพิ่ม, ปิดเคสหลังแก้ webhook"
              />
              <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                Comment นี้เห็นเฉพาะ super admin ในหน้า Support Tickets
              </Text>
            </Card>

            <Card size="small" title="Comments" style={{ marginTop: 16 }}>
              {selected.comments.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มี comment" />
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
            <Empty description="เลือก ticket เพื่อดูรายละเอียด" />
          </Card>
        )}
      </Space>
    </div>
  );
}
