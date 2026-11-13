"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Card, Space, Input, Select, Button, Popconfirm, List, Tag, Divider, message, Checkbox, DatePicker } from 'antd';
import Link from 'next/link';
import dayjs from 'dayjs';

type LogRow = {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  category: string;
  message: string;
  meta: any;
  created_by: number | null;
  created_at: string;
};

const ADMIN_API_PREFIX = '/api';

// ========== API helpers ==========
async function fetchLogs(params: {
  q?: string;
  level?: string;
  category?: string;
  user_id?: string;
  action?: string;
  status?: string;
  correlation_id?: string;
  session_id?: string;
  platform?: string;
  app_version?: string;
  date_start?: string;
  date_end?: string;
  page: number;
  pageSize: number;
}, uiText: UiTranslator = thaiUiText) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.level) qs.set('level', params.level);
  if (params.category) qs.set('category', params.category);
  if (params.user_id) qs.set('user_id', params.user_id);
  if (params.action) qs.set('action', params.action);
  if (params.status) qs.set('status', params.status);
  if (params.correlation_id) qs.set('correlation_id', params.correlation_id);
  if (params.session_id) qs.set('session_id', params.session_id);
  if (params.platform) qs.set('platform', params.platform);
  if (params.app_version) qs.set('app_version', params.app_version);
  if (params.date_start) qs.set('date_start', params.date_start);
  if (params.date_end) qs.set('date_end', params.date_end);
  qs.set('page', String(params.page));
  qs.set('pageSize', String(params.pageSize));
  const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(uiText("admin_ui.en_failed_to_load_logs_9448b"));
  return res.json(); // { items: LogRow[], total: number }
}

async function deleteLogsByIds(ids: (string|number)[], uiText: UiTranslator = thaiUiText) {
  const qs = new URLSearchParams();
  qs.set('ids', ids.join(','));
  const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { method: 'DELETE' });
  const j = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(j.error || uiText("admin_ui.en_bulk_delete_failed_d3ba6"));
  return j; // { deleted: number }
}

function levelTag(level: string){
  const color =
    level === 'error' ? 'red' :
    level === 'warn' ? 'orange' :
    level === 'info' ? 'blue' :
    level === 'debug' ? 'default' : 'default';
  return <Tag color={color}>{level}</Tag>;
}

export default function AdminLogsPage() {
  const uiText = useUiText();
  const [q,setQ] = useState('');
  const [level,setLevel] = useState<string|undefined>();
  const [category,setCategory] = useState<string|undefined>();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [status, setStatus] = useState<string|undefined>();
  const [correlationId, setCorrelationId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [platform, setPlatform] = useState<string|undefined>();
  const [appVersion, setAppVersion] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState<string | undefined>();
  const [dateEnd, setDateEnd] = useState<string | undefined>();
  const [data,setData] = useState<LogRow[]>([]);
  const [total,setTotal] = useState(0);
  const [page,setPage] = useState(1);
  const [pageSize,setPageSize] = useState(50);
  const [loading,setLoading] = useState(false);

  const reloadLockRef = useRef(false);

  useEffect(() => {
    fetch(`${ADMIN_API_PREFIX}/admin/log-categories`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(uiText("admin_ui.en_failed_to_load_categories_8c99f")))))
      .then((arr) => setCategories(Array.isArray(arr) ? arr : []))
      .catch(() => setCategories([]));
  }, []);

  // ========== NEW: selections ==========
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const pageIds = useMemo(()=> data.map(d => d.id), [data]);
  const allChecked = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id));
  const indeterminate = selectedIds.length > 0 && !allChecked;

  function toggleSelectAllPage(checked: boolean) {
    if (checked) {
      // รวม id ที่ยังไม่ได้เลือก + ของหน้านี้
      const merged = Array.from(new Set([...selectedIds, ...pageIds]));
      setSelectedIds(merged);
    } else {
      // ลบ id ของหน้านี้ออกจาก selections
      const remain = selectedIds.filter(id => !pageIds.includes(id));
      setSelectedIds(remain);
    }
  }
  function toggleOne(id: number, checked: boolean) {
    if (checked) setSelectedIds(prev => Array.from(new Set([...prev, id])));
    else setSelectedIds(prev => prev.filter(x => x !== id));
  }

  async function load(){
    if (dateStart && dateEnd) {
      const start = dayjs(dateStart);
      const end = dayjs(dateEnd);
      if (start.isValid() && end.isValid() && start.isAfter(end, 'day')) {
        message.warning(uiText("admin_ui.en_date_start_must_be_before_or_equal_to_c2682"));
        return;
      }
    }

    setLoading(true);
    try{
      const res = await fetchLogs({
        q,
        level,
        category,
        user_id: userId.trim() || undefined,
        action: action.trim() || undefined,
        status,
        correlation_id: correlationId.trim() || undefined,
        session_id: sessionId.trim() || undefined,
        platform,
        app_version: appVersion.trim() || undefined,
        date_start: dateStart,
        date_end: dateEnd,
        page,
        pageSize,
      }, uiText);
      setData(res.items || []); setTotal(res.total || 0);
      // เคลียร์ selections ที่ไม่อยู่ในผลลัพธ์แล้ว (กันค้าง)
      setSelectedIds(prev => prev.filter(id => (res.items || []).some((x:LogRow)=> x.id === id)));
    }catch(e:any){
      message.error(e.message||uiText("admin_ui.en_load_logs_failed_d25f7"));
    }finally{ setLoading(false); }
  }
  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, [q, level, category, userId, action, status, correlationId, sessionId, platform, appVersion, dateStart, dateEnd, page, pageSize]);

  async function reload() {
    if (loading || reloadLockRef.current) return;
    reloadLockRef.current = true;
    try {
      await load();
    } finally {
      reloadLockRef.current = false;
    }
  }

  async function addTest(){
    const res = await fetch(`${ADMIN_API_PREFIX}/logs`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ level: 'info', category: 'logs-page', message: 'Test log from /admin/logs' })
    });
    if(res.ok){ message.success(uiText("admin_ui.en_created_accf4")); load(); } else { message.error(uiText("admin_ui.en_create_failed_aac8c")); }
  }

  async function purgeByFilter(){
    const qs = new URLSearchParams();
    if(level) qs.set('level', level);
    if(category) qs.set('category', category);
    if(q) qs.set('q', q);
    if(dateStart) qs.set('date_start', dateStart);
    if(dateEnd) qs.set('date_end', dateEnd);
    const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { method: 'DELETE' });
    const j = await res.json();
    if(res.ok){ message.success(uiText("admin_ui.en_deleted_logs_8ae08", { v0: j.deleted })); load(); } else { message.error(j.error||uiText("admin_ui.en_purge_failed_3a59b")); }
  }

  async function bulkDeleteSelected() {
    if (!selectedIds.length) return;
    try {
      const j = await deleteLogsByIds(selectedIds, uiText);
      message.success(uiText("admin_ui.en_deleted_logs_8ae08", { v0: j.deleted ?? selectedIds.length }));
      setSelectedIds([]);
      load();
    } catch (e:any) {
      message.error(e.message || uiText("admin_ui.en_bulk_delete_failed_d3ba6"));
    }
  }

  return (
    <Card
      title={uiText("admin_ui.en_system_logs_26e97")}
      extra={
        <Space wrap>
          <Input.Search placeholder={uiText("admin_ui.en_search_text_36ff8")} onSearch={(val)=>{ setPage(1); setQ(val); }} allowClear enterButton />
          <Input
            placeholder={uiText("admin_ui.en_user_id_23bf4")}
            style={{ width: 120 }}
            value={userId}
            onChange={(e) => {
              setPage(1);
              setUserId(e.target.value);
            }}
            allowClear
          />
          <Input
            placeholder={uiText("admin_ui.en_action_97c89")}
            style={{ width: 180 }}
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
            allowClear
          />
          <Select
            allowClear
            placeholder={uiText("admin_ui.en_status_bae7d")}
            style={{ width: 140 }}
            value={status}
            onChange={(v)=>{ setPage(1); setStatus(v); }}
            options={[ 'start','success','error' ].map(v=>({ value: v, label: v }))}
          />
          <Select
            allowClear
            placeholder={uiText("admin_ui.en_level_7c7f5")}
            style={{ width: 140 }}
            value={level}
            onChange={(v)=>{ setPage(1); setLevel(v); }}
            options={[ 'debug','info','warn','error' ].map(v=>({ value: v, label: v }))}
          />
          <Select
            allowClear
            placeholder={uiText("admin_ui.en_platform_123a7")}
            style={{ width: 140 }}
            value={platform}
            onChange={(v)=>{ setPage(1); setPlatform(v); }}
            options={[ 'android','ios','web' ].map(v=>({ value: v, label: v }))}
          />
          <Input
            placeholder={uiText("admin_ui.en_app_version_0e25b")}
            style={{ width: 140 }}
            value={appVersion}
            onChange={(e) => {
              setPage(1);
              setAppVersion(e.target.value);
            }}
            allowClear
          />
          <Select
            placeholder={uiText("admin_ui.en_category_a3c68")}
            allowClear
            style={{ width: 200 }}
            value={category}
            options={categories.map((c) => ({ label: c, value: c }))}
            onChange={(v) => {
              setPage(1);
              setCategory(v || undefined);
            }}
          />
          <Input
            placeholder={uiText("admin_ui.en_correlation_id_805ca")}
            style={{ width: 180 }}
            value={correlationId}
            onChange={(e) => {
              setPage(1);
              setCorrelationId(e.target.value);
            }}
            allowClear
          />
          <Input
            placeholder={uiText("admin_ui.en_session_id_25e4f")}
            style={{ width: 180 }}
            value={sessionId}
            onChange={(e) => {
              setPage(1);
              setSessionId(e.target.value);
            }}
            allowClear
          />
          <DatePicker
            allowClear
            placeholder={uiText("admin_ui.en_date_start_2bc8f")}
            style={{ width: 160 }}
            value={dateStart ? dayjs(dateStart) : null}
            onChange={(v) => {
              setPage(1);
              setDateStart(v ? v.format('YYYY-MM-DD') : undefined);
            }}
          />
          <DatePicker
            allowClear
            placeholder={uiText("admin_ui.en_date_end_873f9")}
            style={{ width: 160 }}
            value={dateEnd ? dayjs(dateEnd) : null}
            onChange={(v) => {
              setPage(1);
              setDateEnd(v ? v.format('YYYY-MM-DD') : undefined);
            }}
          />

          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading} disabled={loading}>
            {uiText("admin_ui.en_reload_cce71")}</Button>
          {/* <Button onClick={addTest}>Add test</Button> */}
          {/* <Popconfirm title="Delete logs by current filters?" onConfirm={purgeByFilter}>
            <Button danger>Purge by filter</Button>
          </Popconfirm> */}

          {/* NEW: select-all (current page) + bulk delete */}
          <Checkbox
            indeterminate={indeterminate}
            checked={allChecked}
            onChange={e => toggleSelectAllPage(e.target.checked)}
          >
            {uiText("admin_ui.en_select_page_e9921")}</Checkbox>
          <Popconfirm
            title={uiText("admin_ui.en_delete_selected_log_s_45d15", { v0: selectedIds.length })}
            onConfirm={bulkDeleteSelected}
            okButtonProps={{ danger:true }}
            disabled={!selectedIds.length}
          >
            <Button danger disabled={!selectedIds.length}>
              {uiText("admin_ui.en_delete_selected_eec82")}{selectedIds.length})
            </Button>
          </Popconfirm>
        </Space>
      }
      styles={{ body: { paddingTop: 12 } }}
    >
      <List
        loading={loading}
        itemLayout="vertical"
        dataSource={data}
        rowKey={(x)=> String(x.id)}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange:(p,ps)=>{ setPage(p); setPageSize(ps||50); },
        }}
        renderItem={(item) => {
          const checked = selectedIds.includes(item.id);
          return (
            <List.Item
              key={item.id}
              style={{
                borderBottom: '1px solid var(--app-border)',
                padding: '12px 0',
              }}
            >
              {/* checkbox + level */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <Checkbox
                  checked={checked}
                  onChange={(e) => toggleOne(item.id, e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                {levelTag(item.level)}
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--app-muted)' }}>
                  {new Date(item.created_at).toLocaleString(uiText.locale)}
                </span>
              </div>

              {/* title / message */}
              <div style={{ fontWeight: 600, color: 'var(--app-text)' }}>
                <Link href={`/admin/logs/${item.id}/view`}>
                  {item.message || uiText("admin_ui.en_no_message_e0f65")}
                </Link>
              </div>

              {/* category */}
              <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(var(--app-text-rgb),0.72)' }}>
                <Tag color="geekblue">{item.category}</Tag>
              </div>

              {/* meta JSON */}
              {item.meta && Object.keys(item.meta).length > 0 && (
                <div
                  style={{
                    background: 'var(--app-surface-2)',
                    border: '1px solid var(--app-border)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    color: 'rgba(var(--app-text-rgb),0.78)',
                  }}
                >
                  {JSON.stringify(item.meta, null, 2)}
                </div>
              )}
            </List.Item>
          );
        }}
      />
    </Card>
  );
}
