'use client';

import React from 'react';

import {
  Card,
  Descriptions,
  Image,
  Divider,
  Typography,
  Button,
  Space,
  Tooltip,
  Popconfirm,
  Row,
  Col,
  Grid,
  Modal,
  message,
  theme,
} from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MessageOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  FacebookFilled,
  ShareAltOutlined,
  LinkOutlined,
  PhoneOutlined,
  BankOutlined,
  LockOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

import type { PostRecord } from './PostForm';
import { useSessionCtx } from '@/lib/session-context';
import BookmarkButton from '@/components/BookmarkButton';
import { formatDate } from '@/lib/date';
import { CommentsSection } from '@/components/comments/CommentsSection';

import { TelBlockDialog } from '@/components/jachoei/TelBlockDialog';
import { BankReportDialog } from '@/components/jachoei/BankReportDialog';

import type { TelBlockDialogValue } from '@/components/jachoei/TelBlockDialog';
import type { BankReportDialogValue } from '@/components/jachoei/BankReportDialog';

import { useJachoeiLocalState } from '@/app/hooks/useJachoeiLocalState';
import { useJachoeiMutations } from '@/app/hooks/useJachoeiMutations';
import {
  getDontAskAgainForTel,
  normalizeBank,
  normalizeTel,
  setDontAskAgainForTel,
} from '@/app/lib/jachoeiLocalState';

const { useBreakpoint } = Grid;

type Props = {
  post: PostRecord | null;
  loading?: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  title?: string;

  onClone?: (id: string) => void;
  cloning?: boolean;
};

/** =========================
 *  Share helpers
 *  ========================= */
type SharePayload = {
  url: string;
  title: string;
  text: string;
};

function buildSharePayload(post: PostRecord, baseUrl: string): SharePayload {
  const url = `${baseUrl}/post/${String(post?.id ?? '')}`;
  const title = post?.title ? String(post.title) : 'จ่าเฉย (Jachoei)';
  const detail = post?.detail ? String(post.detail).replace(/\s+/g, ' ').trim() : '';
  const text = detail
    ? `${title}\n\n${detail.slice(0, 180)}${detail.length > 180 ? '...' : ''}`
    : title;

  return { url, title, text };
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function maskAccountForDisplay(accountRaw: string): string {
  const s = String(accountRaw ?? '').trim();
  if (!s) return '';

  const digits = s.replace(/[^\d]/g, '');
  if (digits.length <= 6) return s;

  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `${head} •••• ${tail}`;
}

function TelChipRow({
  tel,
  blocked,
  onAction,
}: {
  tel: string;
  blocked: boolean;
  onAction: (telRaw: string) => void;
}) {
  const { token } = theme.useToken();
  const telRaw = String(tel ?? '');

  return (
    <div
      style={{
        height: 42,
        width: '100%',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <Space size={8} style={{ minWidth: 0, flex: 1 }}>
        <PhoneOutlined style={{ color: token.colorTextSecondary }} />
        <Typography.Text
          ellipsis={{ tooltip: telRaw }}
          style={{ minWidth: 0, flex: 1, fontSize: 13 }}
        >
          {telRaw}
        </Typography.Text>

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
                await copyToClipboard(telRaw);
                message.success('Copied');
              } catch {
                message.error('Copy failed');
              }
            }}
          />
        </Tooltip>
      </Space>

      <Space size={8} align="center">
        {blocked ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: `1px solid ${token.colorErrorBorder}`,
              background: token.colorBgContainer,
              color: token.colorErrorText,
              fontSize: 12,
              whiteSpace: 'nowrap',
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
            onAction(telRaw);
          }}
          style={{
            paddingInline: 8,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          {blocked ? 'จัดการ' : 'บล็อก'}
        </Button>
      </Space>
    </div>
  );
}

function BankChipRow({
  bankName,
  account,
  reported,
  onAction,
}: {
  bankName: string | null | undefined;
  account: string;
  reported: boolean;
  onAction: (bankName: string | null | undefined, accountRaw: string) => void;
}) {
  const { token } = theme.useToken();
  const bankLabel = String(bankName ?? '').trim();
  const accountRaw = String(account ?? '').trim();
  const displayAccount = maskAccountForDisplay(accountRaw);
  const displayText = bankLabel ? `${bankLabel} • ${displayAccount || accountRaw}` : displayAccount || accountRaw;

  return (
    <div
      style={{
        height: 42,
        width: '100%',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <Space size={8} style={{ minWidth: 0, flex: 1 }}>
        <BankOutlined style={{ color: token.colorTextSecondary }} />
        <Typography.Text
          ellipsis={{ tooltip: displayText }}
          style={{ minWidth: 0, flex: 1, fontSize: 13 }}
        >
          {displayText || '-'}
        </Typography.Text>

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
                await copyToClipboard(accountRaw);
                message.success('Copied');
              } catch {
                message.error('Copy failed');
              }
            }}
          />
        </Tooltip>
      </Space>

      <Space size={8} align="center">
        {reported ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: `1px solid ${token.colorSuccessBorder}`,
              background: token.colorBgContainer,
              color: token.colorSuccessText,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            <CheckCircleOutlined />
            <span>รายงานแล้ว</span>
          </div>
        ) : null}

        <Button
          aria-label={reported ? `Undo report bank account ${accountRaw}` : `Report bank account ${accountRaw}`}
          type="text"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAction(bankName ?? null, accountRaw);
          }}
          style={{
            paddingInline: 8,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          {reported ? 'ยกเลิกรายงาน' : 'รายงาน'}
        </Button>
      </Space>
    </div>
  );
}

function ShareActionButton({
  post,
  baseUrl,
  isMobile,
}: {
  post: PostRecord;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const payload = React.useMemo(() => buildSharePayload(post, baseUrl), [post, baseUrl]);

  const openFacebookShare = (shareUrl: string) => {
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(fb, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async (e: React.MouseEvent<HTMLElement>) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
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

      setOpen(true);
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as Error & { name?: string }).name : undefined;
      if (String(name || '').toLowerCase().includes('abort')) return;
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip title="Share">
        <Button
          type="text"
          size={isMobile ? 'small' : 'middle'}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Typography.Text strong>{payload.title}</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {payload.url}
              </Typography.Text>
            </div>
          </div>

          <Space wrap>
            <Button
              icon={<LinkOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(payload.url);
                  message.success('Copied link');
                } catch {
                  message.error('Copy failed');
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
                  message.success('Copied text');
                } catch {
                  message.error('Copy failed');
                }
              }}
            >
              Copy text
            </Button>

            <Button icon={<FacebookFilled />} onClick={() => openFacebookShare(payload.url)}>
              Share to Facebook
            </Button>

            <Button
              onClick={() => {
                window.open(payload.url, '_blank', 'noopener,noreferrer');
              }}
            >
              Open link
            </Button>
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Tip: บนมือถือจะเปิด native share ให้เองถ้าเครื่องรองรับ
          </Typography.Text>
        </div>
      </Modal>
    </>
  );
}

type TelDialogState = { open: boolean; tel: string; dontAskStored: boolean };
type BankDialogState = { open: boolean; bankName: string | null; account: string };

type PostDetails = PostRecord & {
  id: string | number;
  transfer_amount?: number | null;
  transfer_date?: string | null;
  website?: string | null;
  province_name?: string | null;
  province_id?: string | null;
  fb_published_at?: string | null;
  fb_status?: string | null;
  fb_permalink_url?: string | null;
  fb_social_post_id?: string | null;
  author?: { id: string | number; name?: string | null } | null;
  is_bookmarked?: boolean | null;
};

export default function PostView({
  post,
  loading,
  onDelete,
  deleting,
  title,
  onClone,
  cloning,
}: Props) {
  // ✅ Hooks MUST be called unconditionally (before any return)
  const { user } = useSessionCtx();
  const router = useRouter();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();

  const jachoei = useJachoeiLocalState();
  const jachoeiMut = useJachoeiMutations();

  const requireAuthOrRedirect = React.useCallback((): boolean => {
    if (user) return true;

    const nextPath =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search || ''}`
        : '/';

    router.push(`/admin/login?next=${encodeURIComponent(nextPath)}`);
    return false;
  }, [router, user]);

  const [telDialog, setTelDialog] = React.useState<TelDialogState>({
    open: false,
    tel: '',
    dontAskStored: false,
  });
  const [bankDialog, setBankDialog] = React.useState<BankDialogState>({
    open: false,
    bankName: null,
    account: '',
  });

  const BASE_URL = React.useMemo(() => {
    return (
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://jachoei.com')
    );
  }, []);

  // ✅ Derived safe values (work even when post is null)
  const p = React.useMemo<PostDetails | null>(() => {
    if (!post || post.id == null) return null;
    return { ...post, id: post.id } as PostDetails;
  }, [post]);

  const postId = React.useMemo(() => (p?.id != null ? String(p.id) : ''), [p]);
  const authorId = React.useMemo(() => {
    const id = p?.author?.id;
    return id != null ? String(id) : null;
  }, [p]);
  const userId = React.useMemo(() => {
    const id = user?.id;
    return id != null ? String(id) : null;
  }, [user]);

  const telNumbers = React.useMemo(() => p?.tel_numbers ?? [], [p]);
  const sellerAccounts = React.useMemo(() => p?.seller_accounts ?? [], [p]);

  const fbStatus = React.useMemo(() => String(p?.fb_status ?? '').toUpperCase(), [p]);
  const fbPermalinkUrl = React.useMemo(() => String(p?.fb_permalink_url ?? '').trim(), [p]);
  const isFbPublished = React.useMemo(
    () => fbStatus === 'PUBLISHED' && !!fbPermalinkUrl,
    [fbStatus, fbPermalinkUrl]
  );

  const performTelConfirm = React.useCallback(
    async (telRaw: string, value: TelBlockDialogValue): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      const wantReport = !!value.wantReport;
      const nextCategory = wantReport ? value.category : undefined;
      const nextNote = wantReport ? value.note : '';

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
            const msg = err instanceof Error ? err.message : 'Report failed';
            message.warning(`Blocked, but report failed: ${msg}`);
          }
        }

        jachoei.setBlockedTelEntry(tel, {
          ...optimisticEntry,
          blockedAt: status.my_blocked_at ?? optimisticEntry.blockedAt,
          ctx: reportPayload?.ctx ?? optimisticEntry.ctx,
          tags: reportPayload?.tags ?? optimisticEntry.tags,
        });

        message.success(wasBlocked ? 'Updated' : 'Blocked');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else jachoei.removeBlockedTelEntry(tel);

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performTelUndo = React.useCallback(
    async (telRaw: string): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      jachoei.removeBlockedTelEntry(tel);

      try {
        await jachoeiMut.unblockPhone({ phone: tel });
        message.success('Unblocked');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else if (wasBlocked) jachoei.setBlockedTelEntry(tel, {});

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankConfirm = React.useCallback(
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

        message.success(wasReported ? 'Updated report' : 'Reported');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else jachoei.removeReportedBankEntry(account);

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankUndo = React.useCallback(
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
        message.success('Unreported');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else if (wasReported) jachoei.setReportedBankEntry(account, { bank_name: bankName ?? null });

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openTelBlockFlow = React.useCallback(
    (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      if (!requireAuthOrRedirect()) return;

      const skipConfirm = getDontAskAgainForTel(tel);
      const blockedNow = jachoei.isBlockedTel(tel);

      if (skipConfirm && !blockedNow) {
        setDontAskAgainForTel(tel, true);
        void performTelConfirm(tel, { wantReport: true, category: 'SCAM', note: '', dontAskAgain: true });
        return;
      }

      setTelDialog({ open: true, tel, dontAskStored: skipConfirm });
    },
    [jachoei, performTelConfirm, requireAuthOrRedirect]
  );

  const openBankReportFlow = React.useCallback((bankName: string | null | undefined, accountRaw: string) => {
    const account = normalizeBank(accountRaw);
    if (!account) return;

    if (!requireAuthOrRedirect()) return;
    setBankDialog({ open: true, bankName: bankName ?? null, account });
  }, [requireAuthOrRedirect]);

  // ✅ Early returns AFTER hooks are defined
  if (!post) {
    return (
      <Card loading={loading} title={title ?? 'Post [x]'}>
        No data.
      </Card>
    );
  }

  if (!p) {
    return (
      <Card loading={loading} title={title ?? 'Post [x]'}>
        Invalid post.
      </Card>
    );
  }

  const fbBtn = (
    <Button
      type="text"
      size={isMobile ? 'small' : 'middle'}
      icon={<FacebookFilled />}
      disabled={!isFbPublished}
      aria-label="Facebook"
      style={{
        opacity: isFbPublished ? 1 : 0.35,
        cursor: isFbPublished ? 'pointer' : 'not-allowed',
      }}
    />
  );

  return (
    <Card
      title={title ?? 'รายละเอียดโพสต์'}
      loading={loading}
      headStyle={{
        padding: isMobile ? '8px 12px' : '12px 16px',
      }}
      bodyStyle={{
        padding: isMobile ? 12 : 16,
      }}
      extra={
        <Space size={isMobile ? 4 : 8} wrap>
          <Tooltip
            title={isFbPublished ? 'Open Facebook post' : `Facebook: ${fbStatus || 'NOT PUBLISHED'}`}
          >
            {isFbPublished ? (
              <a href={fbPermalinkUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex' }}>
                {fbBtn}
              </a>
            ) : (
              fbBtn
            )}
          </Tooltip>

          {userId !== authorId && (
            <BookmarkButton postId={postId} defaultBookmarked={p.is_bookmarked ?? false} />
          )}

          {userId !== authorId && authorId && (
            <Link href={`/chat?to=${authorId}`} prefetch={false}>
              <Button type="text" size={isMobile ? 'small' : 'middle'} icon={<MessageOutlined />} title="Chat with" />
            </Link>
          )}

          {userId === authorId && (
            <>
              <Tooltip title="Clone">
                <Button
                  type="text"
                  size={isMobile ? 'small' : 'middle'}
                  onClick={() => onClone?.(postId)}
                  loading={cloning}
                  icon={<CopyOutlined />}
                />
              </Tooltip>

              <Tooltip title="Edit">
                <Link href={`/post/${postId}/edit`} prefetch={false}>
                  <Button type="text" size={isMobile ? 'small' : 'middle'} icon={<EditOutlined />} />
                </Link>
              </Tooltip>

              <Popconfirm title="Confirm delete?" okText="Yes" cancelText="No" onConfirm={() => onDelete?.(postId)}>
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size={isMobile ? 'small' : 'middle'}
                    danger
                    loading={deleting}
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}

          <ShareActionButton post={post} baseUrl={BASE_URL} isMobile={isMobile} />
        </Space>
      }
    >
      {/* Dialogs */}
      <TelBlockDialog
        open={telDialog.open}
        tel={telDialog.tel}
        blocked={telDialog.tel ? jachoei.isBlockedTel(normalizeTel(telDialog.tel)) : false}
        defaultDontAskAgain={telDialog.dontAskStored}
        initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
        initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
        initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
        confirmLoading={jachoeiMut.loading.blockPhone || jachoeiMut.loading.reportPhone}
        undoLoading={jachoeiMut.loading.unblockPhone}
        onCancel={() => setTelDialog({ open: false, tel: '', dontAskStored: false })}
        onConfirm={(value) => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;

          if (!requireAuthOrRedirect()) return;

          setDontAskAgainForTel(tel, value.dontAskAgain);
          void performTelConfirm(tel, value).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: '', dontAskStored: false });
          });
        }}
        onUndo={() => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;
          if (!requireAuthOrRedirect()) return;

          void performTelUndo(tel).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: '', dontAskStored: false });
          });
        }}
      />

      <BankReportDialog
        open={bankDialog.open}
        bankName={bankDialog.bankName}
        account={bankDialog.account}
        reported={bankDialog.account ? jachoei.isReportedBank(normalizeBank(bankDialog.account)) : false}
        initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
        initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
        confirmLoading={jachoeiMut.loading.reportBank}
        undoLoading={jachoeiMut.loading.unreportBank}
        onCancel={() => setBankDialog({ open: false, bankName: null, account: '' })}
        onConfirm={(value) => {
          if (!requireAuthOrRedirect()) return;
          void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: '' });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: '' });
          });
        }}
      />

      {/* Layout */}
      <Row gutter={isMobile ? 12 : 24} align="top">
        <Col xs={24} md={14}>
          <Descriptions
            column={1}
            bordered={!isMobile}
            size={isMobile ? 'small' : 'middle'}
            labelStyle={{
              width: isMobile ? 130 : 200,
              fontSize: isMobile ? 12 : 14,
              padding: isMobile ? '6px 8px' : undefined,
              color: token.colorTextSecondary,
            }}
            contentStyle={{
              fontSize: isMobile ? 13 : 14,
              padding: isMobile ? '6px 8px' : undefined,
              color: token.colorText,
            }}
          >
            <Descriptions.Item label="สินค้า/บริการ ที่สั่งซื้อ">{p.title || '-'}</Descriptions.Item>
            <Descriptions.Item label="รายละเอียดเพิ่มเติม">{p.detail || '-'}</Descriptions.Item>
            <Descriptions.Item label="ชื่อ-นามสกุล คนขาย">{p.first_last_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="เลขบัตรประชาชน / พาสปอร์ต">
              {p.id_card ? <Typography.Text copyable>{p.id_card}</Typography.Text> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="ยอดโอน">
              {p.transfer_amount != null
                ? Number(p.transfer_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="วันโอนเงิน">{p.transfer_date ? formatDate(p.transfer_date) : '-'}</Descriptions.Item>
            <Descriptions.Item label="เว็บประกาศขายของ">{p.website || '-'}</Descriptions.Item>
            <Descriptions.Item label="จังหวัดของคนสร้างรายงาน">{p.province_name || p.province_id || '-'}</Descriptions.Item>

            <Descriptions.Item label="Facebook">
              {isFbPublished ? (
                <Space size={8} wrap>
                  <Typography.Text>Published</Typography.Text>
                  {p.fb_published_at ? (
                    <Typography.Text type="secondary">{formatDate(p.fb_published_at)}</Typography.Text>
                  ) : null}
                  <Typography.Text type="secondary" copyable>
                    {fbPermalinkUrl}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">{fbStatus || 'NOT PUBLISHED'}</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          {/* Tel table */}
          {telNumbers.length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                เบอร์โทรศัพท์ / ไอดีไลน์
              </Divider>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {telNumbers.map((t: { id?: string | number | null; tel?: string | null }, i: number) => {
                  const telRaw = String(t?.tel ?? '').trim();
                  const telNorm = normalizeTel(telRaw);
                  const blocked = telNorm ? jachoei.isBlockedTel(telNorm) : false;

                  return (
                    <TelChipRow
                      key={String(t?.id ?? telRaw ?? i)}
                      tel={telRaw}
                      blocked={blocked}
                      onAction={(raw) => {
                        if (!raw) return;
                        openTelBlockFlow(raw);
                      }}
                    />
                  );
                })}
              </Space>
            </>
          )}

          {/* Bank table */}
          {sellerAccounts.length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                บัญชีคนขาย
              </Divider>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {sellerAccounts.map(
                  (
                    row: { seller_account?: string | null; bank_name?: string | null; id?: string | number | null },
                    i: number
                  ) => {
                    const accountRaw = String(row?.seller_account ?? '').trim();
                    const accountNorm = normalizeBank(accountRaw);
                    const reported = accountNorm ? jachoei.isReportedBank(accountNorm) : false;

                    return (
                      <BankChipRow
                        key={String(row?.id ?? accountRaw ?? row?.bank_name ?? i)}
                        bankName={row?.bank_name ?? null}
                        account={accountRaw}
                        reported={reported}
                        onAction={(bn, acc) => {
                          if (!acc) return;
                          openBankReportFlow(bn ?? null, acc);
                        }}
                      />
                    );
                  }
                )}
              </Space>
            </>
          )}

          {/* Images */}
          {(post.images || []).length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                ไฟล์แนบ / รูปภาพ
              </Divider>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 110 : 160}px, 1fr))`,
                  gap: isMobile ? 8 : 12,
                }}
              >
                {(post.images || []).map((img) => (
                  <Image
                    key={String(img.id)}
                    src={img.url}
                    width={isMobile ? 110 : 160}
                    height={isMobile ? 110 : 160}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ))}
              </div>
            </>
          )}
        </Col>

        {/* Comments */}
        <Col xs={24} md={10} style={{ marginTop: isMobile ? 16 : 0 }}>
          <Divider orientation="left" style={{ margin: isMobile ? '0 0 8px' : '0 0 12px' }}>
            ความคิดเห็น
          </Divider>
          <CommentsSection postId={postId} currentUserId={user?.id} />
        </Col>
      </Row>
    </Card>
  );
}
