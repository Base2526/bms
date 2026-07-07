'use client';
import React, { useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider, Tag, Alert } from 'antd';

type CreatedRow = any;

const KINDS = [
  { label: 'Posts', value: 'posts' },
  { label: 'Users', value: 'users' },
  { label: 'BMS Products', value: 'bms-products' },
  { label: 'BMS Customers', value: 'bms-customers' },
  { label: 'BMS Orders (+pay/ship)', value: 'bms-orders' },
  { label: 'BMS Conversations', value: 'bms-conversations' },
  { label: 'BMS Purchase (PO)', value: 'bms-purchase' },
];

export default function DevFakePage() {
  const [kind, setKind] = useState<'posts' | 'users' | 'bms-products' | 'bms-customers' | 'bms-orders' | 'bms-conversations' | 'bms-purchase'>('bms-products');
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedRow[]>([]);

  async function doFake() {
    setLoading(true);
    try {
      const res = await fetch(`/api/dev/fake/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      message.success(`Created ${j.created?.length || 0} ${kind}`);
      setCreated(prev => [...(j.created || []), ...prev].slice(0, 300));
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally { setLoading(false); }
  }

  async function cleanup() {
    setLoading(true);
    try {
      const res = await fetch('/api/dev/fake/cleanup', { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Cleanup failed');
      message.success(
        `Deleted ${j.deleted} — orders:${j.bmsOrders ?? 0} conv:${j.bmsConversations ?? 0} PO:${j.bmsPurchaseOrders ?? 0} suppliers:${j.bmsSuppliers ?? 0} products:${j.bmsProducts ?? 0} customers:${j.bmsCustomers ?? 0}`
      );
      setCreated([]);
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally { setLoading(false); }
  }

  const cols = [
    { title: 'id / sku', key: 'id', width: 200, render: (_: any, r: any) => r.sku || r.id },
    { title: 'name', dataIndex: 'name', key: 'name', render: (_: any, r: any) => r.name || r.title },
    { title: 'price', dataIndex: 'price', key: 'price', width: 100, render: (v: any) => (v != null ? `${Number(v).toLocaleString()} ฿` : '—') },
    { title: 'phone', dataIndex: 'phone', key: 'phone' },
    { title: 'tags', dataIndex: 'tags', key: 'tags', render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
  ];

  return (
    <Card
      title="Dev: Fake Data Generator"
      extra={<Space wrap>
        <Select value={kind} onChange={(v) => setKind(v as any)} options={KINDS} style={{ width: 160 }} />
        <InputNumber min={1} max={2000} value={count} onChange={(v) => setCount(v || 1)} />
        <Button type="primary" onClick={doFake} loading={loading}>Create</Button>
        <Button danger onClick={cleanup} disabled={loading}>Cleanup</Button>
      </Space>}
    >
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message="ใช้เฉพาะ dev/test เท่านั้น (ปิดใน production) · ต้องเป็น admin/internal caller"
        description={<>ลำดับแนะนำ: <b>Products → Customers → Orders → Conversations → Purchase</b> (Orders/Conv/Purchase สุ่มจาก products/customers ที่มี) ·
          ลง <b>tenant default</b> · <b>Orders</b> backdate 30 วัน + พ่วง payment/shipment → เติม Dashboard/Reports/CRM/Payment/Shipping ·
          <b>Conversations</b> + messages → เติม Inbox · marker: <code>FAKE-</code> / tag <code>fake</code> ·
          <b>Cleanup</b> ลบ fake ทั้งหมด (ตามลำดับ FK, ข้ามตัวที่มี order อ้างถึง)</>}
      />
      <Divider style={{ margin: '8px 0 16px' }} />
      <Table dataSource={created} columns={cols} rowKey={(r) => r.id || r.sku} size="small" pagination={{ pageSize: 20 }} />
    </Card>
  );
}
