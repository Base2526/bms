'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Space, Input, Button, List, Tag, message } from 'antd';
import Link from 'next/link';

type LogRow = {
  id: number;
  level: string;
  category: string;
  message: string;
  meta: any;
  created_by: number | null;
  created_at: string;
  action?: string | null;
  status?: string | null;
  correlation_id?: string | null;
  session_id?: string | null;
  screen_name?: string | null;
  route_name?: string | null;
  platform?: string | null;
  app_version?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
};

const ADMIN_API_PREFIX = '/api';

function levelTag(level: string){
  const color =
    level === 'error' ? 'red' :
    level === 'warn' ? 'orange' :
    level === 'info' ? 'blue' :
    level === 'debug' ? 'default' : 'default';
  return <Tag color={color}>{level}</Tag>;
}

export default function LogsTimelinePage() {
  const [sessionId, setSessionId] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LogRow[]>([]);

  const title = useMemo(() => {
    if (correlationId.trim()) return `Timeline (correlation_id=${correlationId.trim()})`;
    if (sessionId.trim()) return `Timeline (session_id=${sessionId.trim()})`;
    return 'Timeline';
  }, [correlationId, sessionId]);

  async function load() {
    const sid = sessionId.trim();
    const cid = correlationId.trim();
    if (!sid && !cid) {
      message.warning('Enter a sessionId or correlationId');
      return;
    }

    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (sid) qs.set('session_id', sid);
      if (cid) qs.set('correlation_id', cid);
      qs.set('page', '1');
      qs.set('pageSize', '200');
      const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load logs');
      const j = await res.json();
      const items: LogRow[] = Array.isArray(j.items) ? j.items : [];
      // API is newest-first; show oldest-first for timeline.
      setData([...items].reverse());
    } catch (e: any) {
      message.error(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // no auto-load
  }, []);

  return (
    <Card
      title={title}
      extra={
        <Space wrap>
          <Input
            placeholder="Session ID"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Input
            placeholder="Correlation ID"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Button type="primary" onClick={load} loading={loading}>Load</Button>
          <Link href="/admin/logs"><Button>Back</Button></Link>
        </Space>
      }
      styles={{ body: { paddingTop: 12 } }}
    >
      <List
        loading={loading}
        dataSource={data}
        rowKey={(x) => String(x.id)}
        renderItem={(item) => (
          <List.Item style={{ borderBottom: '1px solid var(--app-border)', padding: '10px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {levelTag(item.level)}
                {item.status ? <Tag>{item.status}</Tag> : null}
                {item.action ? <Tag color="geekblue">{item.action}</Tag> : null}
                <span style={{ fontSize: 12, color: 'var(--app-muted)' }}>{new Date(item.created_at).toLocaleString()}</span>
                <span style={{ flex: 1 }} />
                <Link href={`/admin/logs/${item.id}/view`}>View</Link>
              </div>
              <div style={{ fontWeight: 600 }}>{item.message}</div>
              <div style={{ fontSize: 12, color: 'var(--app-muted)' }}>
                user={item.created_by ?? '-'} route={item.route_name ?? '-'} screen={item.screen_name ?? '-'} platform={item.platform ?? '-'} v={item.app_version ?? '-'}
                {item.duration_ms ? ` • ${item.duration_ms}ms` : ''}
              </div>
              {item.error_message ? (
                <div style={{ marginTop: 6, color: 'var(--app-danger)' }}>{item.error_message}</div>
              ) : null}
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
