'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Badge, Button, Empty, List, Segmented, Space, Typography, message } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const Q_MENTIONS = gql`
  query ($unreadOnly: Boolean) {
    bmsMyMentions(unreadOnly: $unreadOnly, limit: 100) {
      id conversationId channel customerName author body createdAt readAt
    }
  }
`;
const M_MARK_READ = gql`mutation ($id: ID!) { bmsMarkMentionRead(id: $id) }`;
const M_MARK_ALL_READ = gql`mutation { bmsMarkAllMentionsRead }`;

type Mention = {
  id: string; conversationId: string; channel: string; customerName: string | null;
  author: string | null; body: string; createdAt: string; readAt: string | null;
};

export default function MyMentionsPage() {
  const router = useRouter();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [filter, setFilter] = useState<"unread" | "all">("unread");

  const { data, loading, refetch } = useQuery(Q_MENTIONS, {
    variables: { unreadOnly: filter === "unread" },
    skip: permsLoading || !can("inbox.view"),
    fetchPolicy: "cache-and-network",
  });
  const [markRead] = useMutation(M_MARK_READ);
  const [markAllRead, { loading: markingAll }] = useMutation(M_MARK_ALL_READ, {
    onCompleted: () => { message.success("อ่านทั้งหมดแล้ว"); refetch(); },
  });

  const mentions: Mention[] = data?.bmsMyMentions || [];

  const openMention = async (m: Mention) => {
    if (!m.readAt) await markRead({ variables: { id: m.id } }).catch(() => {});
    router.push(`/admin/inbox?c=${m.conversationId}&tab=notes`);
  };

  if (!permsLoading && !can("inbox.view")) {
    return <Alert type="warning" message="ไม่มีสิทธิ์ดูหน้านี้" showIcon />;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>เมนชันของฉัน</Typography.Title>
        <Space>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as "unread" | "all")}
            options={[{ label: "ยังไม่อ่าน", value: "unread" }, { label: "ทั้งหมด", value: "all" }]}
          />
          <Button icon={<CheckOutlined />} loading={markingAll} onClick={() => markAllRead()}>
            อ่านทั้งหมดแล้ว
          </Button>
        </Space>
      </Space>

      <List
        loading={loading}
        dataSource={mentions}
        locale={{ emptyText: <Empty description={filter === "unread" ? "ไม่มีเมนชันที่ยังไม่อ่าน" : "ยังไม่มีใคร mention คุณ"} /> }}
        renderItem={(m) => (
          <List.Item style={{ cursor: "pointer" }} onClick={() => openMention(m)}>
            <List.Item.Meta
              avatar={<Badge dot={!m.readAt} offset={[-2, 2]}><span style={{ fontSize: 20 }}>💬</span></Badge>}
              title={
                <Space>
                  <Typography.Text strong>{m.customerName || m.channel}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: "normal" }}>
                    {m.author} · {new Date(m.createdAt).toLocaleString()}
                  </Typography.Text>
                </Space>
              }
              description={m.body}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
