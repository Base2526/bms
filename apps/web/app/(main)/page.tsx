"use client";

import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Space,
  Button,
  Tag,
  Popconfirm,
  message,
  Tooltip,
  Typography,
  Badge,
  Grid,
  List,
  Card,
  Modal,
  Divider,
} from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CommentOutlined,
  EditOutlined,
  DeleteOutlined,
  MessageOutlined,
  PhoneOutlined,
  BankOutlined,
  FacebookFilled,
  ShareAltOutlined,
  CopyOutlined,
  LinkOutlined,
} from "@ant-design/icons";

import ThumbGrid from "@/components/ThumbGrid";
import BookmarkButton from "@/components/BookmarkButton";
import { useSessionCtx } from "@/lib/session-context";

const { Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

const DELETE_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

const Q_POSTS_PAGED = gql`
  query ($q: String, $limit: Int!, $offset: Int!) {
    postsPaged(search: $q, limit: $limit, offset: $offset) {
      total
      items {
        id
        title
        detail
        status
        is_bookmarked
        created_at
        images {
          id
          url
        }
        author {
          id
          name
          avatar
        }
        tel_numbers {
          id
          tel
        }
        seller_accounts {
          id
          bank_name
          seller_account
        }
        comments_count

        fb_permalink_url
        fb_published_at
        fb_status
        fb_social_post_id
      }
    }
  }
`;

// map status -> tag color
const statusColor = (status?: string | null) => {
  switch ((status || "").toUpperCase()) {
    case "PENDING":
      return "gold";
    case "BLOCKED":
    case "BANNED":
      return "red";
    case "VERIFIED":
    case "OK":
      return "green";
    default:
      return "default";
  }
};

const fbStatusColor = (status?: string | null) => {
  switch ((status || "").toUpperCase()) {
    case "PUBLISHED":
      return "green";
    case "PENDING":
      return "gold";
    case "FAILED":
    case "DELETED_FAILED":
      return "red";
    case "SKIPPED":
      return "default";
    default:
      return "default";
  }
};

function isFacebookPublished(r: any) {
  return String(r?.fb_status ?? "").toUpperCase() === "PUBLISHED" && !!r?.fb_permalink_url;
}

// Tel list helper (ใช้ได้ทั้ง desktop + mobile)
const TelList = ({
  items,
}: {
  items: Array<{ id: string; tel: string }> | undefined;
}) => {
  const list = (items || []).filter(Boolean);
  if (!list.length) return <Text type="secondary">-</Text>;

  const visible = list.slice(0, 3);
  const hidden = list.slice(3);

  return (
    <>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {visible.map((t) => (
          <li key={t.id || t.tel} style={{ lineHeight: 1.3 }}>
            <Text copyable style={{ fontSize: 13 }}>
              <PhoneOutlined style={{ marginRight: 4 }} />
              {t.tel}
            </Text>
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <Tooltip
          placement="bottom"
          title={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {hidden.map((t) => (
                <li key={t.id || t.tel} style={{ lineHeight: 1.3 }}>
                  <Text copyable>{t.tel}</Text>
                </li>
              ))}
            </ul>
          }
        >
          <span style={{ fontSize: 12, color: "#999" }}>+{hidden.length} more</span>
        </Tooltip>
      )}
    </>
  );
};

function FacebookIconAction({ r }: { r: any }) {
  const published = isFacebookPublished(r);
  const href = r?.fb_permalink_url;

  const tooltip = published
    ? "Open Facebook post"
    : r?.fb_status
      ? `Facebook: ${r.fb_status}`
      : "Facebook: not published";

  if (published && href) {
    return (
      <Tooltip title={tooltip}>
        <Button
          type="text"
          size="small"
          icon={<FacebookFilled />}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip}>
      <Button type="text" size="small" icon={<FacebookFilled />} disabled />
    </Tooltip>
  );
}

/** =========================
 *  Share helpers + component
 *  ========================= */
type SharePayload = {
  url: string;
  title: string;
  text: string;
};

function buildSharePayload(r: any, baseUrl: string): SharePayload {
  const url = `${baseUrl}/post/${r.id}`;
  const title = r?.title ? String(r.title) : "จ่าเฉย (Jachoei)";
  const detail = r?.detail ? String(r.detail).replace(/\s+/g, " ").trim() : "";
  const text = detail ? `${title}\n\n${detail.slice(0, 180)}${detail.length > 180 ? "..." : ""}` : title;

  return { url, title, text };
}

async function copyToClipboard(text: string) {
  if (!text) return;
  // clipboard API needs https/localhost
  await navigator.clipboard.writeText(text);
}

function ShareActionButton({ r, baseUrl }: { r: any; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const payload = useMemo(() => buildSharePayload(r, baseUrl), [r, baseUrl]);

  const openFacebookShare = (shareUrl: string) => {
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(fb, "_blank", "noopener,noreferrer");
  };

  const handleShare = async (e: any) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      // ✅ Native share (mobile)
      const nav: any = navigator as any;
      if (nav?.share) {
        await nav.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        return;
      }

      // ✅ fallback modal
      setOpen(true);
    } catch (err: any) {
      // ผู้ใช้กด cancel จะ throw บาง browser → ไม่ต้อง error
      if (String(err?.name || "").toLowerCase().includes("abort")) return;
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip title="Share">
        <Button
          type="text"
          size="small"
          icon={<ShareAltOutlined />}
          onClick={handleShare}
        />
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="Share post"
        footer={null}
        destroyOnClose
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <Text strong>{payload.title}</Text>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {payload.url}
              </Text>
            </div>
          </div>

          <Divider style={{ margin: "8px 0" }} />

          <Space wrap>
            <Button
              icon={<LinkOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(payload.url);
                  message.success("Copied link");
                } catch {
                  message.error("Copy failed (clipboard permission)");
                }
              }}
            >
              Copy link
            </Button>

            <Button
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(`${payload.title}\n${payload.url}`);
                  message.success("Copied text");
                } catch {
                  message.error("Copy failed (clipboard permission)");
                }
              }}
            >
              Copy text
            </Button>

            <Button
              icon={<FacebookFilled />}
              onClick={() => openFacebookShare(payload.url)}
            >
              Share to Facebook
            </Button>

            <Button
              onClick={() => {
                window.open(payload.url, "_blank", "noopener,noreferrer");
              }}
            >
              Open link
            </Button>
          </Space>

          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Tip: บนมือถือจะเปิด native share ให้เอง ถ้าเครื่องรองรับ
            </Text>
          </div>
        </div>
      </Modal>
    </>
  );
}

function PostsList() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { user } = useSessionCtx();

  // ✅ base url สำหรับแชร์ (client-only)
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://jachoei.com");

  const { data, loading, refetch } = useQuery(Q_POSTS_PAGED, {
    variables: { q: null, limit: pageSize, offset: (page - 1) * pageSize },
    fetchPolicy: "cache-and-network",
  });

  const [deletePost, { loading: deleting }] = useMutation(DELETE_POST);

  // useEffect(() => {
  //   console.log("[data] =", data);
  // }, [data]);

  const handleDelete = async (id: string) => {
    try {
      const { data: res } = await deletePost({ variables: { id } });
      if (res?.deletePost) {
        message.success("Deleted successfully");
        refetch();
      } else {
        message.warning("Delete failed");
      }
    } catch (err: any) {
      message.error(err?.message || "Delete error");
    }
  };

  const items = data?.postsPaged?.items || [];
  const total = data?.postsPaged?.total || 0;

  // ===== Desktop columns (Table) =====
  const columns = [
    {
      title: "Images",
      dataIndex: "images",
      width: 190,
      render: (imgs: any) => <ThumbGrid images={imgs} width={170} height={120} />,
    },
    {
      title: "Title",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (_: any, r: any) => {
        const ts = String(r.created_at).trim();

        return (
          <div style={{ paddingRight: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/post/${r.id}`} prefetch={false}>
                  <Text strong style={{ fontSize: 14 }}>
                    {r.title || "-"}
                  </Text>
                </Link>

                <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {r.status && (
                    <Tag color={statusColor(r.status)} style={{ marginRight: 0 }}>
                      {r.status}
                    </Tag>
                  )}

                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {ts ? new Date(Number(ts)).toLocaleString() : ""}
                  </Text>
                </div>

                {r.author && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      by{" "}
                      <Link href={`/profile/${r.author.id}`} prefetch={false}>
                        {r.author.name}
                      </Link>
                    </Text>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: "Detail",
      dataIndex: "detail",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (detail: string) => (
        <Paragraph style={{ marginBottom: 0, maxWidth: 420 }} ellipsis={{ rows: 4, expandable: false }}>
          {detail}
        </Paragraph>
      ),
    },
    {
      title: "Tel",
      width: 220,
      dataIndex: "tel_numbers",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (tels: any) => <TelList items={tels} />,
    },
    {
      title: "Seller Accounts",
      dataIndex: "seller_accounts",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (
        list: Array<{
          id: string;
          bank_name?: string;
          seller_account?: string;
        }> = []
      ) => {
        if (!Array.isArray(list) || list.length === 0) return <Text type="secondary">-</Text>;

        const visible = list.slice(0, 3);
        const hidden = list.slice(3);

        const renderList = (data: typeof list) => (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.map((acc) => (
              <li key={acc.id} style={{ lineHeight: 1.3 }}>
                <Text style={{ fontSize: 13 }}>
                  <BankOutlined style={{ marginRight: 4 }} />
                  {acc.bank_name || "-"} : <Text copyable>{acc.seller_account || "-"}</Text>
                </Text>
              </li>
            ))}
          </ul>
        );

        return (
          <>
            {renderList(visible)}
            {hidden.length > 0 && (
              <Tooltip placement="bottom" title={renderList(hidden)}>
                <span style={{ fontSize: 12, color: "#999" }}>+{hidden.length} more</span>
              </Tooltip>
            )}
          </>
        );
      },
    },
    {
      title: "Action",
      fixed: "right" as const,
      width: 230,
      render: (_: any, r: any) => (
        <Space size={4}>
         
          {/* ✅ FB icon (clickable only if PUBLISHED) */}
          <FacebookIconAction r={r} />

          {user?.id !== r.author?.id && (
            <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />
          )}

          {user?.id === r.author?.id && (
            <>
              <Tooltip title="Edit">
                <Link href={`/post/${r.id}/edit`} prefetch={false}>
                  <Button type="text" size="small" icon={<EditOutlined />} />
                </Link>
              </Tooltip>

              <Popconfirm title="Confirm delete?" okText="Yes" cancelText="No" onConfirm={() => handleDelete(r.id)}>
                <Tooltip title="Delete">
                  <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            </>
          )}

          {user?.id !== r.author?.id && (
            <Tooltip title="Chat with author">
              <Link href={`/chat?to=${r.author.id}`} prefetch={false}>
                <Button type="text" size="small" icon={<MessageOutlined />} />
              </Link>
            </Tooltip>
          )}

          <Tooltip title={`Comments (${r.comments_count || 0})`}>
            <Link href={`/post/${r.id}`} prefetch={false}>
              <Badge count={r.comments_count || 0} size="small" showZero={false} offset={[0, 4]}>
                <Button type="text" size="small" icon={<CommentOutlined />} />
              </Badge>
            </Link>
          </Tooltip>

           {/* ✅ Share */}
          <ShareActionButton r={r} baseUrl={BASE_URL} />
        </Space>
      ),
    },
  ];

  // ===== Mobile view: List + Card =====
  if (isMobile) {
    return (
      <div style={{ padding: 8 }}>
        <List
          loading={loading}
          dataSource={items}
          rowKey="id"
          pagination={
            items?.length
              ? {
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  onChange: (p, ps) => {
                    setPage(p);
                    setPageSize(ps);
                    refetch({ q: null, limit: ps, offset: (p - 1) * ps });
                  },
                }
              : false
          }
          renderItem={(r: any) => (
            <List.Item style={{ padding: 8 }}>
              <Card style={{ width: "100%" }} bodyStyle={{ padding: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flexShrink: 0 }}>
                    <ThumbGrid images={r.images} width={120} height={90} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/post/${r.id}`} prefetch={false}>
                          <Text strong style={{ fontSize: 14 }} ellipsis>
                            {r.title || "-"}
                          </Text>
                        </Link>

                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {r.created_at ? new Date(Number(r.created_at)).toLocaleString() : ""}
                          </Text>
                        </div>
                      </div>
                    </div>

                    {r.author && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          by{" "}
                          <Link href={`/profile/${r.author.id}`} prefetch={false}>
                            {r.author.name}
                          </Link>
                        </Text>
                      </div>
                    )}

                    {r.detail && (
                      <Paragraph style={{ marginTop: 4, marginBottom: 4, fontSize: 12 }} ellipsis={{ rows: 2 }}>
                        {r.detail}
                      </Paragraph>
                    )}

                    <div style={{ marginTop: 4 }}>
                      <Text strong style={{ fontSize: 12 }}>
                        Tel:
                      </Text>{" "}
                      <span style={{ fontSize: 12 }}>
                        {r.tel_numbers?.[0]?.tel || "-"}
                        {r.tel_numbers && r.tel_numbers.length > 1 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {" "}
                            (+{r.tel_numbers.length - 1} more)
                          </Text>
                        )}
                      </span>
                    </div>

                    <div style={{ marginTop: 2 }}>
                      <Text strong style={{ fontSize: 12 }}>
                        Bank:
                      </Text>{" "}
                      <span style={{ fontSize: 12 }}>
                        {r.seller_accounts?.[0]
                          ? `${r.seller_accounts[0].bank_name || "-"}: ${r.seller_accounts[0].seller_account || "-"}`
                          : "-"}
                        {r.seller_accounts && r.seller_accounts.length > 1 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {" "}
                            (+{r.seller_accounts.length - 1} more)
                          </Text>
                        )}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      <Space size={4}>
                      
                        {user?.id !== r.author?.id && (
                          <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />
                        )}

                        {user?.id === r.author?.id && (
                          <>
                            <Tooltip title="Edit">
                              <Link href={`/post/${r.id}/edit`} prefetch={false}>
                                <Button type="text" size="small" icon={<EditOutlined />} />
                              </Link>
                            </Tooltip>

                            <Popconfirm title="Confirm delete?" okText="Yes" cancelText="No" onConfirm={() => handleDelete(r.id)}>
                              <Tooltip title="Delete">
                                <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
                              </Tooltip>
                            </Popconfirm>
                          </>
                        )}

                        {user?.id !== r.author?.id && (
                          <Tooltip title="Chat with author">
                            <Link href={`/chat?to=${r.author.id}`} prefetch={false}>
                              <Button type="text" size="small" icon={<MessageOutlined />} />
                            </Link>
                          </Tooltip>
                        )}

                        {/* ✅ Facebook icon (clickable only if PUBLISHED) */}
                        <FacebookIconAction r={r} />
                      </Space>

                      <Tooltip title={`Comments (${r.comments_count || 0})`}>
                        <Link href={`/post/${r.id}`} prefetch={false}>
                          <Badge count={r.comments_count || 0} size="small" showZero={false} offset={[0, 4]}>
                            <Button type="text" size="small" icon={<CommentOutlined />} />
                          </Badge>
                        </Link>
                        {/* ✅ Share */}
                        <ShareActionButton r={r} baseUrl={BASE_URL} />
                      </Tooltip>

                      
                    </div>
                  </div>
                </div>
              </Card>
            </List.Item>
          )}
        />
      </div>
    );
  }

  // ===== Desktop view: Table =====
  return (
    <div style={{ padding: 5 }}>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns as any}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: 1100 }}
        rowClassName={(_, index) => (index % 2 === 0 ? "row-even" : "row-odd")}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (tot, range) => `${range[0]}-${range[1]} of ${tot} items`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            refetch({ q: null, limit: ps, offset: (p - 1) * ps });
          },
        }}
      />
    </div>
  );
}

export default function Page() {
  const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "จ่าเฉย (Jachoei)",
            alternateName: "จ่าเฉย (Jachoei)",
            url: SITE_URL,
            description: "ฐานข้อมูลการโกงออนไลน์",
            potentialAction: {
              "@type": "SearchAction",
              target: `${SITE_URL}/search?q={query}`,
              "query-input": "required name=query",
            },
          }),
        }}
      />
      <PostsList />
    </>
  );
}
