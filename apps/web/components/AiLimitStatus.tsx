'use client';
import { useEffect, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Alert, Badge, Button, Popover } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18nContext';
import { useSessionCtx } from '@/lib/session-context';

const QUERY = gql`query AiLimitStatus {
  bmsAiUsage { tenantId yearMonth resetsAt creditStatus sharedBudgetStatus sharedBudgetRequiredUsd sharedBudgetRemainingUsd }
  bmsAiLimitNotifications { unreadCount items { id dimension level yearMonth isRead createdAt } }
}`;
const READ = gql`mutation ReadAiLimitNotice($id: ID!) { bmsReadAiLimitNotification(id: $id) }`;
type Notice = { id: string; dimension: string; level: string; yearMonth: string; isRead: boolean; createdAt: string };

/** Server statuses are authoritative; this component never decides admission. */
export default function AiLimitStatus() {
  const { admin } = useSessionCtx();
  const { t, lang } = useI18n();
  const pathname = usePathname();
  const { data, error, loading, refetch } = useQuery(QUERY, {
    skip: !admin?.id, fetchPolicy: 'cache-and-network', pollInterval: 30_000,
  });
  const [read, { loading: saving }] = useMutation(READ);
  const [ackError, setAckError] = useState(false);
  useEffect(() => {
    if (!admin?.id) return;
    const refresh = () => { if (document.visibilityState === 'visible') void refetch().catch(() => {}); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [admin?.id, refetch]);
  if (!admin?.id) return null;
  const usage = data?.bmsAiUsage;
  const inbox = data?.bmsAiLimitNotifications;
  const reset = usage?.resetsAt ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(usage.resetsAt)) : '';
  const content = <div style={{ width: 'min(340px, calc(100vw - 56px))', maxHeight: '65vh', overflowY: 'auto' }}>
    <p>{t('ai_limit.history_help')}</p>
    {ackError && <Alert type="error" closable message={t('ai_limit.read_failed')} onClose={() => setAckError(false)} />}
    {!inbox?.items?.length && <p>{t('ai_limit.empty')}</p>}
    {(inbox?.items ?? []).map((notice: Notice) => <div key={notice.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--app-border)' }}>
      <strong>{t(`ai_limit.${notice.dimension}`)} · {t(`ai_limit.notice_${notice.level}`)}</strong>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('ai_limit.period', { month: notice.yearMonth })}</div>
      {!notice.isRead && <Button size="small" loading={saving} onClick={async () => {
        try {
          setAckError(false);
          const result = await read({ variables: { id: notice.id } });
          if (!result.data?.bmsReadAiLimitNotification) throw new Error('not acknowledged');
          await refetch();
        } catch { setAckError(true); }
      }}>{t('ai_limit.mark_read')}</Button>}
    </div>)}
    <Link href="/admin/billing">{t('ai_limit.billing')}</Link>
  </div>;
  return <section aria-label={t('ai_limit.title')} style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
      <Button size="small" loading={loading} onClick={() => void refetch().catch(() => {})}>{t('ai_limit.refresh')}</Button>
      <Popover trigger="click" placement="bottomRight" content={content} title={t('ai_limit.title')}>
        <Badge count={inbox?.unreadCount ?? 0} overflowCount={99}>
          <Button size="small" icon={<BellOutlined />} aria-label={t('ai_limit.title')}>{t('ai_limit.title')}</Button>
        </Badge>
      </Popover>
    </div>
    {error && <Alert closable showIcon type="warning" message={t('ai_limit.unavailable')} />}
    {!error && usage && (['CREDITS', 'BUDGET'] as const).map(dimension => {
      const status: string = dimension === 'CREDITS' ? usage.creditStatus : usage.sharedBudgetStatus;
      if (!status || status === 'NORMAL') return null;
      return <Alert key={`${usage.tenantId}:${usage.yearMonth}:${pathname}:${dimension}:${status}`} closable showIcon
        style={{ marginBottom: 8 }} type={status.startsWith('PAUSED_') ? 'error' : 'warning'}
        message={<span>{t(`ai_limit.${dimension}`)}: {t(`ai_limit.status_${status}`)}</span>}
        description={<div>
          <p>{t(dimension === 'CREDITS' ? status === 'PAUSED_CREDITS' ? 'ai_limit.credit_help' : 'ai_limit.credit_warning_help' : status === 'PAUSED_UNPRICED' ? 'ai_limit.unpriced_help' : 'ai_limit.budget_help')}</p>
          <p>{t('ai_limit.reset', { date: reset })}</p>
          <Link href="/admin/billing">{t('ai_limit.billing')}</Link>
        </div>} />;
    })}
  </section>;
}
