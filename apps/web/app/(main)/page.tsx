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
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
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
  LockOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";

import ThumbGrid from "@/components/ThumbGrid";
import BookmarkButton from "@/components/BookmarkButton";
import { useSessionCtx } from "@/lib/session-context";

import { TelBlockDialog } from "@/components/jachoei/TelBlockDialog";
import { BankReportDialog } from "@/components/jachoei/BankReportDialog";

import type { BankReportDialogValue } from "@/components/jachoei/BankReportDialog";
import type { TelBlockDialogValue } from "@/components/jachoei/TelBlockDialog";

import { useJachoeiLocalState } from "../hooks/useJachoeiLocalState";
import { useJachoeiMutations } from "../hooks/useJachoeiMutations";
import {
  getDontAskAgainForTel,
  normalizeBank,
  normalizeTel,
  setDontAskAgainForTel,
} from "../lib/jachoeiLocalState";

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

type PostImage = { id: string; url: string };
type PostAuthor = { id: string; name?: string | null; avatar?: string | null };
type PostTelNumber = { id: string; tel: string };
type PostSellerAccount = {
  id: string;
  bank_name?: string | null;
  seller_account?: string | null;
};

type PostsPagedItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  is_bookmarked?: boolean | null;
  created_at?: string | null;
  images?: PostImage[] | null;
  author?: PostAuthor | null;
  tel_numbers?: PostTelNumber[] | null;
  seller_accounts?: PostSellerAccount[] | null;
  comments_count?: number | null;
  fb_permalink_url?: string | null;
  fb_published_at?: string | null;
  fb_status?: string | null;
  fb_social_post_id?: string | null;
};

type PostsPagedResponse = {
  postsPaged: {
    total: number;
    items: PostsPagedItem[];
  };
};

type PostsPagedVars = {
  q?: string | null;
  limit: number;
  offset: number;
};

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

function isFacebookPublished(r: PostsPagedItem) {
  return String(r?.fb_status ?? "").toUpperCase() === "PUBLISHED" && !!r?.fb_permalink_url;
}

function maskAccountForDisplay(accountRaw: string): string {
  const s = String(accountRaw ?? "").trim();
  if (!s) return "";

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length <= 6) return s;

  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `${head} •••• ${tail}`;
}

// Tel list helper (ใช้ได้ทั้ง desktop + mobile)
const TelList = ({
  items,
  isBlocked,
  onOpenBlock,
}: {
  items: PostTelNumber[] | undefined;
  isBlocked: (telRaw: string) => boolean;
  onOpenBlock: (telRaw: string) => void;
}) => {
  const { token } = theme.useToken();
  const list = (items || []).filter(Boolean);
  if (!list.length) return <Text type="secondary">-</Text>;

  const visible = list.slice(0, 3);
  const hidden = list.slice(3);

  const renderChip = (telRaw: string) => {
    const blocked = isBlocked(telRaw);

    return (
      <div
        style={{
          height: 42,
          width: "100%",
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          padding: "6px 10px",
          display: "table-cell",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Space size={8} style={{ minWidth: 0, flex: 1 }}>
          <PhoneOutlined style={{ color: token.colorTextSecondary }} />
          <Text ellipsis={{ tooltip: telRaw }} style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
            {telRaw}
          </Text>

          <Tooltip title="Copy">
            <Button
              aria-label={`Copy tel ${telRaw}`}
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(String(telRaw ?? "").trim());
                  message.success("Copied");
                } catch {
                  message.error("Copy failed");
                }
              }}
            />
          </Tooltip>
        </Space>

        <Space size={8} align="center">
          {blocked ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 10px",
                borderRadius: 999,
                border: `1px solid ${token.colorErrorBorder}`,
                background: token.colorBgContainer,
                color: token.colorErrorText,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <LockOutlined />
              <span>บล็อกแล้ว</span>
            </div>
          ) : null}

          <Button
            aria-label={blocked ? `Manage tel ${telRaw}` : `Block tel ${telRaw}`}
            type="text"
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenBlock(telRaw);
            }}
            style={{
              paddingInline: 8,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            {blocked ? "จัดการ" : "บล็อก"}
          </Button>
        </Space>
      </div>
    );
  };

  return (
    <>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {visible.map((t) => (
          <div key={t.id || t.tel}>{renderChip(t.tel)}</div>
        ))}
      </Space>

      {hidden.length > 0 && (
        <Tooltip
          placement="bottom"
          title={
            <Space direction="vertical" size={6} style={{ width: 320, maxWidth: "100%" }}>
              {hidden.map((t) => (
                <div key={t.id || t.tel}>{renderChip(t.tel)}</div>
              ))}
            </Space>
          }
        >
          <span style={{ fontSize: 12, color: "#999" }}>+{hidden.length} more</span>
        </Tooltip>
      )}
    </>
  );
};

const BankList = ({
  items,
  isReported,
  onOpenReport,
}: {
  items: PostSellerAccount[] | undefined;
  isReported: (accountRaw: string) => boolean;
  onOpenReport: (bankName: string | null | undefined, accountRaw: string) => void;
}) => {
  const { token } = theme.useToken();
  const list = (items || []).filter(Boolean);
  if (!list.length) return <Text type="secondary">-</Text>;

  const visible = list.slice(0, 3);
  const hidden = list.slice(3);

  const renderChip = (bankName: string | null | undefined, accountRaw: string) => {
    const reported = isReported(accountRaw);
    const bankLabel = String(bankName ?? "").trim();
    const accountLabel = maskAccountForDisplay(accountRaw) || String(accountRaw ?? "").trim();
    const displayText = bankLabel ? `${bankLabel} • ${accountLabel}` : accountLabel;

    return (
      <div
        style={{
          height: 42,
          width: "100%",
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          padding: "6px 10px",
          display: "table-cell",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Space size={8} style={{ minWidth: 0, flex: 1 }}>
          <BankOutlined style={{ color: token.colorTextSecondary }} />
          <Text ellipsis={{ tooltip: displayText }} style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
            {displayText || "-"}
          </Text>

          <Tooltip title="Copy">
            <Button
              aria-label={`Copy bank account ${accountRaw}`}
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(String(accountRaw ?? "").trim());
                  message.success("Copied");
                } catch {
                  message.error("Copy failed");
                }
              }}
            />
          </Tooltip>
        </Space>

        <Space size={8} align="center">
          {reported ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 10px",
                borderRadius: 999,
                border: `1px solid ${token.colorSuccessBorder}`,
                background: token.colorBgContainer,
                color: token.colorSuccessText,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <CheckCircleOutlined />
              <span>รายงานแล้ว</span>
            </div>
          ) : null}

          <Button
            aria-label={
              reported
                ? `Undo report bank account ${accountRaw}`
                : `Report bank account ${accountRaw}`
            }
            type="text"
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenReport(bankName ?? null, accountRaw);
            }}
            style={{
              paddingInline: 8,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            {reported ? "ยกเลิกรายงาน" : "รายงาน"}
          </Button>
        </Space>
      </div>
    );
  };

  const renderList = (data: PostSellerAccount[]) => (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {data.map((acc) => (
        <div key={acc.id || `${acc.bank_name || ""}-${acc.seller_account || ""}`}
          style={{ width: "100%" }}
        >
          {renderChip(acc.bank_name ?? null, acc.seller_account ?? "")}
        </div>
      ))}
    </Space>
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
};

function FacebookIconAction({ r }: { r: PostsPagedItem }) {
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

function buildSharePayload(r: PostsPagedItem, baseUrl: string): SharePayload {
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

function ShareActionButton({ r, baseUrl }: { r: PostsPagedItem; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const payload = useMemo(() => buildSharePayload(r, baseUrl), [r, baseUrl]);

  const openFacebookShare = (shareUrl: string) => {
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(fb, "_blank", "noopener,noreferrer");
  };

  const handleShare = async (e: MouseEvent<HTMLElement>) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      // ✅ Native share (mobile)
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
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
    } catch (err: unknown) {
      // ผู้ใช้กด cancel จะ throw บาง browser → ไม่ต้อง error
      const name = err instanceof Error ? (err as Error & { name?: string }).name : undefined;
      if (String(name || "").toLowerCase().includes("abort")) return;
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

type TelDialogState = { open: boolean; tel: string; dontAskStored: boolean };
type BankDialogState = { open: boolean; bankName: string | null; account: string };

function PostsList() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { user } = useSessionCtx();

  const router = useRouter();

  const requireAuthOrRedirect = useCallback((): boolean => {
    if (user) return true;

    const nextPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search || ""}`
        : "/";

    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
    return false;
  }, [router, user]);

  const jachoei = useJachoeiLocalState();
  const jachoeiMut = useJachoeiMutations();
  const [telDialog, setTelDialog] = useState<TelDialogState>({ open: false, tel: "", dontAskStored: false });
  const [bankDialog, setBankDialog] = useState<BankDialogState>({ open: false, bankName: null, account: "" });

  // ✅ base url สำหรับแชร์ (client-only)
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://jachoei.com");

  const { data, loading, refetch } = useQuery<PostsPagedResponse, PostsPagedVars>(Q_POSTS_PAGED, {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete error";
      message.error(msg);
    }
  };

  const items: PostsPagedItem[] = data?.postsPaged?.items || [];
  const total = data?.postsPaged?.total || 0;

  const performTelConfirm = useCallback(
    async (telRaw: string, value: TelBlockDialogValue): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      const wantReport = !!value.wantReport;
      const nextCategory = wantReport ? value.category : undefined;
      const nextNote = wantReport ? value.note : "";

      const optimisticEntry = {
        wantReport,
        category: nextCategory,
        note: nextNote,
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setBlockedTelEntry(tel, optimisticEntry);

      try {
        const status = await jachoeiMut.blockPhone({ phone: tel });

        let reportPayload: Awaited<ReturnType<typeof jachoeiMut.reportPhone>> | null = null;
        if (wantReport) {
          try {
            reportPayload = await jachoeiMut.reportPhone({
              phone: tel,
              category: nextCategory,
              note: nextNote,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Report failed";
            message.warning(`Blocked, but report failed: ${msg}`);
          }
        }

        jachoei.setBlockedTelEntry(tel, {
          ...optimisticEntry,
          blockedAt: status.my_blocked_at ?? optimisticEntry.blockedAt,
          ctx: reportPayload?.ctx ?? optimisticEntry.ctx,
          tags: reportPayload?.tags ?? optimisticEntry.tags,
        });

        message.success(wasBlocked ? "Updated" : "Blocked");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else jachoei.removeBlockedTelEntry(tel);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performTelUndo = useCallback(
    async (telRaw: string): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      jachoei.removeBlockedTelEntry(tel);

      try {
        await jachoeiMut.unblockPhone({ phone: tel });
        message.success("Unblocked");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else if (wasBlocked) jachoei.setBlockedTelEntry(tel, {});

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openTelBlockFlow = useCallback(
    (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      if (!requireAuthOrRedirect()) return;

      const skipConfirm = getDontAskAgainForTel(tel);
      const blockedNow = jachoei.isBlockedTel(tel);

      // parity-ish with RN fast mode, but keep web UX for managing blocked numbers
      if (skipConfirm && !blockedNow) {
        setDontAskAgainForTel(tel, true);
        void performTelConfirm(tel, { wantReport: true, category: "SCAM", note: "", dontAskAgain: true });
        return;
      }

      setTelDialog({ open: true, tel, dontAskStored: skipConfirm });
    },
    [jachoei, performTelConfirm, requireAuthOrRedirect]
  );

  const performBankConfirm = useCallback(
    async (bankName: string | null | undefined, accountRaw: string, value: BankReportDialogValue): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      const optimisticEntry = {
        bank_name: bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setReportedBankEntry(account, optimisticEntry);

      try {
        const payload = await jachoeiMut.reportBank({
          account,
          bankName,
          category: value.category,
          note: value.note,
        });

        jachoei.setReportedBankEntry(account, {
          ...optimisticEntry,
          bank_name: payload.bank_name ?? optimisticEntry.bank_name,
          reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasReported ? "Updated report" : "Reported");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else jachoei.removeReportedBankEntry(account);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankUndo = useCallback(
    async (bankName: string | null | undefined, accountRaw: string): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      jachoei.removeReportedBankEntry(account);

      try {
        await jachoeiMut.unreportBank({
          account,
          bankName,
          category: prevEntry?.category,
          reason: prevEntry?.note ?? null,
        });
        message.success("Unreported");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else if (wasReported) jachoei.setReportedBankEntry(account, { bank_name: bankName ?? null });

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openBankReportFlow = useCallback((bankName: string | null | undefined, accountRaw: string) => {
    const account = normalizeBank(accountRaw);
    if (!account) return;

    if (!requireAuthOrRedirect()) return;
    setBankDialog({ open: true, bankName: bankName ?? null, account });
  }, [requireAuthOrRedirect]);

  // ===== Desktop columns (Table) =====
  const columns: ColumnsType<PostsPagedItem> = [
    {
      title: "Images",
      dataIndex: "images",
      width: 190,
      render: (imgs: PostsPagedItem["images"]) => <ThumbGrid images={imgs ?? []} width={170} height={120} />,
    },
    {
      title: "Title",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (_: unknown, r) => {
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
      render: (tels) => (
        <TelList
          items={tels ?? undefined}
          isBlocked={jachoei.isBlockedTel}
          onOpenBlock={openTelBlockFlow}
        />
      ),
    },
    {
      title: "Seller Accounts",
      dataIndex: "seller_accounts",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (list) => (
        <BankList items={list ?? undefined} isReported={jachoei.isReportedBank} onOpenReport={openBankReportFlow} />
      ),
    },
    {
      title: "Action",
      fixed: "right" as const,
      width: 230,
      render: (_: unknown, r) => {
        const authorId = r.author?.id;
        const userId = user?.id != null ? String(user.id) : undefined;

        return (
          <Space size={4}>
            {/* ✅ FB icon (clickable only if PUBLISHED) */}
            <FacebookIconAction r={r} />

            {userId !== authorId && <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />}

            {userId === authorId && (
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

            {authorId && userId !== authorId && (
              <Tooltip title="Chat with author">
                <Link href={`/chat?to=${authorId}`} prefetch={false}>
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
        );
      },
    },
  ];

  // ===== Mobile view: List + Card =====
  if (isMobile) {
    return (
      <>
        <TelBlockDialog
          open={telDialog.open}
          tel={telDialog.tel}
          blocked={jachoei.isBlockedTel(telDialog.tel)}
          defaultDontAskAgain={telDialog.dontAskStored}
            initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
            initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
            initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
            confirmLoading={jachoeiMut.loading.blockPhone || jachoeiMut.loading.reportPhone}
            undoLoading={jachoeiMut.loading.unblockPhone}
          onCancel={() => setTelDialog({ open: false, tel: "", dontAskStored: false })}
          onConfirm={(value) => {
            if (!requireAuthOrRedirect()) return;
            setDontAskAgainForTel(telDialog.tel, value.dontAskAgain);
              void performTelConfirm(telDialog.tel, value).then((ok) => {
              if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
            });
          }}
            onUndo={() => {
              if (!requireAuthOrRedirect()) return;
              void performTelUndo(telDialog.tel).then((ok) => {
                if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
              });
            }}
        />

        <BankReportDialog
          open={bankDialog.open}
          bankName={bankDialog.bankName}
          account={bankDialog.account}
          reported={jachoei.isReportedBank(bankDialog.account)}
          initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
          initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
          confirmLoading={jachoeiMut.loading.reportBank}
          undoLoading={jachoeiMut.loading.unreportBank}
          onCancel={() => setBankDialog({ open: false, bankName: null, account: "" })}
          onConfirm={(value: BankReportDialogValue) => {
            if (!requireAuthOrRedirect()) return;
            void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
              if (ok) setBankDialog({ open: false, bankName: null, account: "" });
            });
          }}
          onUndo={() => {
            if (!requireAuthOrRedirect()) return;
            void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
              if (ok) setBankDialog({ open: false, bankName: null, account: "" });
            });
          }}
        />

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
            renderItem={(r) => {
              const authorId = r.author?.id;
              const userId = user?.id != null ? String(user.id) : undefined;

              return (
                <List.Item style={{ padding: 8 }}>
                  <Card style={{ width: "100%" }} bodyStyle={{ padding: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flexShrink: 0 }}>
                        <ThumbGrid images={r.images ?? []} width={120} height={90} />
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

                        {r.tel_numbers?.[0]?.tel ? (
                          <Space size={6} wrap style={{ marginLeft: 8 }}>
                            {jachoei.isBlockedTel(r.tel_numbers[0].tel) ? <Tag color="red">Blocked</Tag> : null}
                            <Button size="small" type="default" onClick={() => openTelBlockFlow(r.tel_numbers![0]!.tel)}>
                              {jachoei.isBlockedTel(r.tel_numbers[0].tel) ? "Manage" : "Block"}
                            </Button>
                          </Space>
                        ) : null}
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

                        {r.seller_accounts?.[0]?.seller_account ? (
                          <Space size={6} wrap style={{ marginLeft: 8 }}>
                            {jachoei.isReportedBank(r.seller_accounts[0].seller_account) ? (
                              <Tag color="green">Reported</Tag>
                            ) : null}
                            <Button
                              size="small"
                              type="default"
                              onClick={() =>
                                openBankReportFlow(
                                  r.seller_accounts![0]!.bank_name ?? null,
                                  r.seller_accounts![0]!.seller_account ?? ""
                                )
                              }
                            >
                              {jachoei.isReportedBank(r.seller_accounts[0].seller_account) ? "Manage" : "Report"}
                            </Button>
                          </Space>
                        ) : null}
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
                          {userId !== authorId && (
                            <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />
                          )}

                          {userId === authorId && (
                            <>
                              <Tooltip title="Edit">
                                <Link href={`/post/${r.id}/edit`} prefetch={false}>
                                  <Button type="text" size="small" icon={<EditOutlined />} />
                                </Link>
                              </Tooltip>

                              <Popconfirm
                                title="Confirm delete?"
                                okText="Yes"
                                cancelText="No"
                                onConfirm={() => handleDelete(r.id)}
                              >
                                <Tooltip title="Delete">
                                  <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
                                </Tooltip>
                              </Popconfirm>
                            </>
                          )}

                          {authorId && userId !== authorId && (
                            <Tooltip title="Chat with author">
                              <Link href={`/chat?to=${authorId}`} prefetch={false}>
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
              );
            }}
          />
        </div>
      </>
    );
  }

  // ===== Desktop view: Table =====
  return (
    <div style={{ padding: 5 }}>
      <TelBlockDialog
        open={telDialog.open}
        tel={telDialog.tel}
        blocked={jachoei.isBlockedTel(telDialog.tel)}
        defaultDontAskAgain={telDialog.dontAskStored}
        initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
        initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
        initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
        confirmLoading={jachoeiMut.loading.blockPhone || jachoeiMut.loading.reportPhone}
        undoLoading={jachoeiMut.loading.unblockPhone}
        onCancel={() => setTelDialog({ open: false, tel: "", dontAskStored: false })}
        onConfirm={(value) => {
          if (!requireAuthOrRedirect()) return;
          setDontAskAgainForTel(telDialog.tel, value.dontAskAgain);
          void performTelConfirm(telDialog.tel, value).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performTelUndo(telDialog.tel).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
      />

      <BankReportDialog
        open={bankDialog.open}
        bankName={bankDialog.bankName}
        account={bankDialog.account}
        reported={jachoei.isReportedBank(bankDialog.account)}
        initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
        initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
        confirmLoading={jachoeiMut.loading.reportBank}
        undoLoading={jachoeiMut.loading.unreportBank}
        onCancel={() => setBankDialog({ open: false, bankName: null, account: "" })}
        onConfirm={(value: BankReportDialogValue) => {
          if (!requireAuthOrRedirect()) return;
          void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
      />

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
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
