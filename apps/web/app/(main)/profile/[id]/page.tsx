'use client';;
import { use } from "react";
import { gql, useQuery } from "@apollo/client";
import { Card, Descriptions, Avatar, List, Tag, Space, Tooltip, Button,  } from "antd";
import Link from 'next/link';
import { MessageOutlined, DeleteOutlined, EditOutlined, CopyOutlined } from '@ant-design/icons';

import { useSessionCtx } from '@/lib/session-context';

import { maskEmailKeepLength } from "@/lib/maskEmail";

const Q = gql`
  query($id: ID!) {
    user(id: $id) {
      id
      name
      avatar
      phone
      email
      role
      created_at
    }
    postsByUserId(user_id: $id) {
      id
      title
      status
      created_at
      tel_numbers {
        id
        tel
      }
    }
  }
`;

function Profile({ id }: { id: string }) {
  const { data, loading, error } = useQuery(Q, { variables: { id } });

  const { user } = useSessionCtx();

  if (loading) return <div>Loading...</div>;
  if (error)   return <div>Error: {String(error.message)}</div>;

  const u = data?.user;
  const posts = data?.postsByUserId || [];

  if (!u) return <div>User not found</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="User Profile"
        extra={
        <Space>
         {
            user?.id !== u?.id && <Link href={`/chat?to=${u?.id}`} prefetch={false}>
                                                        <Button
                                                          type="text"
                                                          size="small"
                                                          icon={<MessageOutlined />}
                                                          title={`Chat with `}
                                                        />
                                                      </Link>
         } 
        </Space>
      }>
        <Descriptions bordered column={1}>
          <Descriptions.Item label="Avatar">
            <Avatar src={u.avatar} size={64}>
              {u.name?.[0] || "U"}
            </Avatar>
          </Descriptions.Item>
          <Descriptions.Item label="Name">{u.name}</Descriptions.Item>
          <Descriptions.Item label="Email">{maskEmailKeepLength(u.email) || "-"}</Descriptions.Item>
          <Descriptions.Item label="Phone">{u.phone || "-"}</Descriptions.Item>
          <Descriptions.Item label="Role">{u.role}</Descriptions.Item>
          <Descriptions.Item label="Joined">
            {new Date(Number(u.created_at)).toLocaleString()}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Posts by this user">
        <List
          itemLayout="horizontal"
          dataSource={posts}
          locale={{ emptyText: "No posts" }}
          renderItem={(p: any) => {
            const firstTel =
              p.tel_numbers?.length ? p.tel_numbers[0].tel : "-";

            console.log("[Profile] = ", p);
            return (
              <List.Item
                actions={[
                  // ปรับ path ให้ตรงกับหน้า view ที่คุณใช้
                  // <a key="view" href={`/post/${p.id}`}>
                  //   View
                  // </a>,
                  // <a key="chat" href={`/chat?to=${u.id}`}>
                  //   Chat
                  // </a>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <a href={`/post/${p.id}`}>{p.title}</a>
                      <Tag
                        color={p.status === "public" ? "green" : "red"}
                        style={{ marginLeft: 8 }}
                      >
                        {p.status}
                      </Tag>
                    </div>
                  }
                  description={
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span>Phone: {firstTel}</span>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        Created at:{" "}
                        {p.created_at
                          ? new Date( Number(p.created_at) ).toLocaleString()
                          : "-"}
                      </span>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>
    </div>
  );
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <Profile id={params.id} />;
}
