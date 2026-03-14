'use client';
import React, { useEffect, useMemo, useState } from 'react';
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
  date_start?: string;
  date_end?: string;
  page: number;
  pageSize: number;
}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.level) qs.set('level', params.level);
  if (params.category) qs.set('category', params.category);
  if (params.date_start) qs.set('date_start', params.date_start);
  if (params.date_end) qs.set('date_end', params.date_end);
  qs.set('page', String(params.page));
  qs.set('pageSize', String(params.pageSize));
  const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load logs');
  return res.json(); // { items: LogRow[], total: number }
}

async function deleteLogsByIds(ids: (string|number)[]) {
  const qs = new URLSearchParams();
  qs.set('ids', ids.join(','));
  const res = await fetch(`${ADMIN_API_PREFIX}/logs?` + qs.toString(), { method: 'DELETE' });
  const j = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(j.error || 'Bulk delete failed');
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
  const [q,setQ] = useState('');
  const [level,setLevel] = useState<string|undefined>();
  const [category,setCategory] = useState<string|undefined>();
  const [categories, setCategories] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState<string | undefined>();
  const [dateEnd, setDateEnd] = useState<string | undefined>();
  const [data,setData] = useState<LogRow[]>([]);
  const [total,setTotal] = useState(0);
  const [page,setPage] = useState(1);
  const [pageSize,setPageSize] = useState(50);
  const [loading,setLoading] = useState(false);

  useEffect(() => {
    fetch(`${ADMIN_API_PREFIX}/admin/log-categories`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load categories'))))
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
        message.warning('Date start must be before or equal to date end');
        return;
      }
    }

    setLoading(true);
    try{
      const res = await fetchLogs({ q, level, category, date_start: dateStart, date_end: dateEnd, page, pageSize });
      setData(res.items || []); setTotal(res.total || 0);
      // เคลียร์ selections ที่ไม่อยู่ในผลลัพธ์แล้ว (กันค้าง)
      setSelectedIds(prev => prev.filter(id => (res.items || []).some((x:LogRow)=> x.id === id)));
    }catch(e:any){
      message.error(e.message||'Load logs failed');
    }finally{ setLoading(false); }
  }
  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, [q, level, category, dateStart, dateEnd, page, pageSize]);

  async function addTest(){
    const res = await fetch(`${ADMIN_API_PREFIX}/logs`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ level: 'info', category: 'logs-page', message: 'Test log from /admin/logs' })
    });
    if(res.ok){ message.success('Created'); load(); } else { message.error('Create failed'); }
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
    if(res.ok){ message.success(`Deleted ${j.deleted} logs`); load(); } else { message.error(j.error||'Purge failed'); }
  }

  async function bulkDeleteSelected() {
    if (!selectedIds.length) return;
    try {
      const j = await deleteLogsByIds(selectedIds);
      message.success(`Deleted ${j.deleted ?? selectedIds.length} logs`);
      setSelectedIds([]);
      load();
    } catch (e:any) {
      message.error(e.message || 'Bulk delete failed');
    }
  }

  return (
    <Card
      title="System Logs"
      extra={
        <Space wrap>
          <Input.Search placeholder="Search text" onSearch={(val)=>{ setPage(1); setQ(val); }} allowClear enterButton />
          <Select
            allowClear
            placeholder="Level"
            style={{ width: 140 }}
            value={level}
            onChange={(v)=>{ setPage(1); setLevel(v); }}
            options={[ 'debug','info','warn','error' ].map(v=>({ value: v, label: v }))}
          />
          <Select
            placeholder="Category"
            allowClear
            style={{ width: 200 }}
            value={category}
            options={categories.map((c) => ({ label: c, value: c }))}
            onChange={(v) => {
              setPage(1);
              setCategory(v || undefined);
            }}
          />
          <DatePicker
            allowClear
            placeholder="Date start"
            style={{ width: 160 }}
            value={dateStart ? dayjs(dateStart) : null}
            onChange={(v) => {
              setPage(1);
              setDateStart(v ? v.format('YYYY-MM-DD') : undefined);
            }}
          />
          <DatePicker
            allowClear
            placeholder="Date end"
            style={{ width: 160 }}
            value={dateEnd ? dayjs(dateEnd) : null}
            onChange={(v) => {
              setPage(1);
              setDateEnd(v ? v.format('YYYY-MM-DD') : undefined);
            }}
          />
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
            Select page
          </Checkbox>
          <Popconfirm
            title={`Delete ${selectedIds.length} selected log(s)?`}
            onConfirm={bulkDeleteSelected}
            okButtonProps={{ danger:true }}
            disabled={!selectedIds.length}
          >
            <Button danger disabled={!selectedIds.length}>
              Delete selected ({selectedIds.length})
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
                borderBottom: '1px solid #f0f0f0',
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
                <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>

              {/* title / message */}
              <div style={{ fontWeight: 600, color: '#000' }}>
                <Link href={`/admin/logs/${item.id}/view`}>
                  {item.message || '(no message)'}
                </Link>
              </div>

              {/* category */}
              <div style={{ marginTop: 4, fontSize: 13, color: '#555' }}>
                <Tag color="geekblue">{item.category}</Tag>
              </div>

              {/* meta JSON */}
              {item.meta && Object.keys(item.meta).length > 0 && (
                <div
                  style={{
                    background: '#fafafa',
                    border: '1px solid #eee',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    color: '#444',
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
