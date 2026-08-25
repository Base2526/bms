"use client";

import React, { useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";
import {
  Typography,
  Spin,
  Alert,
  Space,
  Card,
  List,
  Avatar,
  Tag,
  Button,
  Empty
} from "antd";
import {
  UserOutlined,
  PhoneOutlined,
  BankOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const { Title, Text } = Typography;

// ===== GraphQL =====
const Q_GLOBAL_SEARCH = gql`
  query GlobalSearch($q: String!) {
    globalSearch(q: $q) {
      posts {
        id
        entity_id
        title
        snippet
        created_at
      }
      users {
        id
        entity_id
        name
        email
        phone
        avatar
      }
      phones {
        id
        entity_id
        phone
        report_count
        last_report_at
        ids
      }
      bank_accounts {
        id
        entity_id
        bank_name
        account_no_masked
        report_count
        last_report_at
        ids
      }
    }
  }
`;

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useI18n();

  const q = searchParams.get("q") || "";

  const { data, loading, error } = useQuery(Q_GLOBAL_SEARCH, {
    variables: { q },
    skip: !q,
    fetchPolicy: "cache-and-network",
  });

  const result = data?.globalSearch;
  const posts = result?.posts ?? [];
  const users = result?.users ?? [];
  const phones = result?.phones ?? [];
  const bankAccounts = result?.bank_accounts ?? [];

  const totalCount = useMemo(
    () => posts.length + users.length + phones.length + bankAccounts.length,
    [posts.length, users.length, phones.length, bankAccounts.length]
  );

  // ====== click handlers ======
  const goToUser = (u: any) => {
    const id = u.entity_id || u.id;
    router.push(`/user/${encodeURIComponent(id)}`);
  };

  const goToPhone = (p: any) => {
    const num = p.entity_id || p.phone;
    router.push(`/phone/${encodeURIComponent(num)}`);
  };

  const goToBank = (b: any) => {
    const id = b.entity_id || b.id;
    router.push(`/bank/${encodeURIComponent(id)}`);
  };

  const goToPost = (id: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    router.push(`/post/${encodeURIComponent(String(id))}`);
  };

  // ====== title helper (ถ้า 0 ให้ต่อข้อความ "ไม่พบ...") ======
  const usersTitle = (
    <span>
      <UserOutlined style={{ marginRight: 8 }} />
      {t("searchPage.users_title", { count: users.length })}
      {users.length === 0 && ` ${t("searchPage.users_none")}`}
    </span>
  );

  const phonesTitle = (
    <span>
      <PhoneOutlined style={{ marginRight: 8 }} />
      {t("searchPage.phones_title", { count: phones.length })}
      {phones.length === 0 && ` ${t("searchPage.phones_none")}`}
    </span>
  );

  const banksTitle = (
    <span>
      <BankOutlined style={{ marginRight: 8 }} />
      {t("searchPage.banks_title", { count: bankAccounts.length })}
      {bankAccounts.length === 0 && ` ${t("searchPage.banks_none")}`}
    </span>
  );

  const postsTitle = (
    <span>
      <FileTextOutlined style={{ marginRight: 8 }} />
      {t("searchPage.posts_title", { count: posts.length })}
      {posts.length === 0 && ` ${t("searchPage.posts_none")}`}
    </span>
  );

  return (
    <div style={{ margin: "0 auto", padding: 24 }}>
      {/* Header / summary */}
      <Space
        direction="vertical"
        style={{ width: "100%", marginBottom: 24 }}
        size={8}
      >
        <Title level={3} style={{ margin: 0 }}>
          {t("searchPage.title")}
        </Title>

        {!q && <Text type="secondary">{t("searchPage.noQuery")}</Text>}

        {q && (
          <Text type="secondary">
            {t("searchPage.resultsFor")} <Text code>{q}</Text>{" "}
            {totalCount > 0 && (
              <span style={{ marginLeft: 8 }}>
                ({totalCount} result{totalCount > 1 ? "s" : ""})
              </span>
            )}
          </Text>
        )}
      </Space>

      {/* Loading */}
      {q && loading && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Spin />
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">{t("searchPage.loading")}</Text>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert closable
          type="error"
          message={t("searchPage.errorTitle")}
          description={error.message}
          style={{ marginTop: 16 }}
        />
      )}

      {/* No results at all */}
      {q && !loading && !error && totalCount === 0 && (
        <div style={{ marginTop: 24 }}>
          {/* อันนี้ยังใช้ Empty กลางหน้าไว้ให้ feedback รวม ๆ */}
          <Empty description={t("searchPage.noResults")} />
        </div>
      )}

      {/* Results by section */}
      {q && !loading && !error && totalCount > 0 && (
        <Space
          direction="vertical"
          style={{ width: "100%", marginTop: 16 }}
          size={24}
        >
          {/* === Users === */}
          <Card
            title={usersTitle}
            bodyStyle={{ padding: users.length ? 16 : 0 }}
          >
            {users.length > 0 && (
              <List
                dataSource={users}
                renderItem={(user: any) => (
                  <List.Item
                    key={user.id}
                    onClick={() => goToUser(user)}
                    style={{ cursor: "pointer" }}
                  >
                    <List.Item.Meta
                      avatar={
                        <Avatar
                          src={user.avatar}
                          icon={<UserOutlined />}
                          style={{ background: "#1890ff" }}
                        />
                      }
                      title={
                        <Space>
                          <Text strong>{user.name}</Text>
                          {user.email && <Tag>{user.email}</Tag>}
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={2}>
                          {user.phone && (
                            <Text type="secondary">
                              <PhoneOutlined style={{ marginRight: 4 }} />
                              {user.phone}
                            </Text>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>

          {/* === Phone reports (มี ids → ปุ่มไปโพสต์) === */}
          <Card
            title={phonesTitle}
            bodyStyle={{ padding: phones.length ? 16 : 0 }}
          >
            {phones.length > 0 && (
              <List
                dataSource={phones}
                renderItem={(item: any) => {
                  const ids: string[] = item.ids ?? [];
                  const postCount = ids.length;

                  return (
                    <List.Item
                      key={item.id}
                      onClick={() => goToPhone(item)}
                      style={{ cursor: "pointer" }}
                    >
                      <Space
                        direction="vertical"
                        size={4}
                        style={{ width: "100%" }}
                      >
                        <Space
                          align="center"
                          style={{
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <Text strong>{item.phone}</Text>
                          <Space size={6}>
                            {postCount > 0 && (
                              <Tag color="blue">
                                {postCount} post
                                {postCount > 1 ? "s" : ""}
                              </Tag>
                            )}
                            <Tag color="red">
                              {item.report_count} record
                              {item.report_count > 1 ? "s" : ""}
                            </Tag>
                          </Space>
                        </Space>

                        {postCount > 0 && (
                          <Space size={8} wrap style={{ marginTop: 4 }}>
                            {ids.map((pid) => (
                              <Button
                                key={pid}
                                size="small"
                                onClick={(e) => goToPost(pid, e)}
                              >
                                {t("searchPage.go_to_post", { id: pid })}
                              </Button>
                            ))}
                          </Space>
                        )}

                        {item.last_report_at && (
                          <Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {t("searchPage.last_report")}{" "}
                            {new Date(
                              item.last_report_at
                            ).toLocaleString()}
                          </Text>
                        )}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          {/* === Bank accounts (มี ids → ปุ่มไปโพสต์) === */}
          <Card
            title={banksTitle}
            bodyStyle={{ padding: bankAccounts.length ? 16 : 0 }}
          >
            {bankAccounts.length > 0 && (
              <List
                dataSource={bankAccounts}
                renderItem={(item: any) => {
                  const ids: string[] = item.ids ?? [];
                  const postCount = ids.length;

                  return (
                    <List.Item
                      key={item.id}
                      onClick={() => goToBank(item)}
                      style={{ cursor: "pointer" }}
                    >
                      <Space
                        direction="vertical"
                        size={4}
                        style={{ width: "100%" }}
                      >
                        <Space
                          align="center"
                          style={{
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <Space direction="vertical" size={0}>
                            <Text strong>{item.bank_name}</Text>
                            <Text type="secondary">
                              {item.account_no_masked}
                            </Text>
                          </Space>
                          <Space size={6}>
                            {postCount > 0 && (
                              <Tag color="blue">
                                {postCount} post
                                {postCount > 1 ? "s" : ""}
                              </Tag>
                            )}
                            <Tag color="volcano">
                              {item.report_count} report
                              {item.report_count > 1 ? "s" : ""}
                            </Tag>
                          </Space>
                        </Space>

                        {postCount > 0 && (
                          <Space size={8} wrap style={{ marginTop: 4 }}>
                            {ids.map((pid) => (
                              <Button
                                key={pid}
                                size="small"
                                onClick={(e) => goToPost(pid, e)}
                              >
                                {t("searchPage.go_to_post", { id: pid })}
                              </Button>
                            ))}
                          </Space>
                        )}

                        {item.last_report_at && (
                          <Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {t("searchPage.last_report")}{" "}
                            {new Date(
                              item.last_report_at
                            ).toLocaleString()}
                          </Text>
                        )}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          {/* === Posts / Reports === */}
          <Card
            title={postsTitle}
            bodyStyle={{ padding: posts.length ? 16 : 0 }}
          >
            {posts.length > 0 && (
              <List
                dataSource={posts}
                itemLayout="vertical"
                renderItem={(post: any) => (
                  <List.Item
                    key={post.id}
                    onClick={() => goToPost(post.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <Space
                      direction="vertical"
                      style={{ width: "100%" }}
                      size={4}
                    >
                      <Text strong>{post.title}</Text>
                      {post.snippet && (
                        <Text type="secondary">
                          {post.snippet}
                        </Text>
                      )}
                      {post.created_at && (
                        <Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          {new Date(
                            post.created_at
                          ).toLocaleString()}
                        </Text>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Space>
      )}
    </div>
  );
}
