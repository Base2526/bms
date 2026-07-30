'use client';
import React, { useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider, Tag, Alert, Popconfirm, Input, Modal, Descriptions, Typography } from 'antd';
import { gql, useQuery, useMutation } from '@apollo/client';

const Q_ME = gql`query { bmsMe { tenant { name slug } } }`;
const M_ENTER_TENANT = gql`mutation ($tenantId: ID!) { bmsEnterTenant(tenantId: $tenantId) }`;

type ProvisionResult = {
  tenant: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
  summary: Record<string, number>;
};

type CreatedRow = any;

const KINDS = [
  { label: 'BMS Staff (users)', value: 'users' },
  { label: 'BMS Products', value: 'bms-products' },
  { label: 'BMS Customers', value: 'bms-customers' },
  { label: 'BMS Orders (+pay/ship)', value: 'bms-orders' },
  { label: 'BMS Conversations', value: 'bms-conversations' },
  { label: 'BMS Purchase (PO)', value: 'bms-purchase' },
  { label: 'BMS AI Usage', value: 'bms-ai-usage' },
];

type FakeKind = 'users' | 'bms-products' | 'bms-customers' | 'bms-orders' | 'bms-conversations' | 'bms-purchase' | 'bms-ai-usage';

export default function DevFakePage() {
  const [kind, setKind] = useState<FakeKind>('bms-products');
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedRow[]>([]);
  const { data: meData } = useQuery(Q_ME, { fetchPolicy: 'cache-and-network' });
  const tenant = meData?.bmsMe?.tenant;

  const [shopName, setShopName] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [enterTenant, { loading: entering }] = useMutation(M_ENTER_TENANT, {
    // reload ทั้งหน้าเพื่อให้ context (tenant) ใหม่มีผลกับทุกหน้า — pattern เดียวกับ /admin/tenants
    onCompleted: () => { window.location.href = '/admin/dashboard'; },
    onError: (e) => message.error(e?.message || 'เข้าดูร้านไม่สำเร็จ'),
  });

  async function provisionShop() {
    setProvisioning(true);
    try {
      const res = await fetch('/api/dev/fake/provision-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: shopName.trim() || undefined }),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      message.success(`สร้างร้าน "${j.tenant.name}" (/${j.tenant.slug}) สำเร็จ`);
      setProvisioned(j);
      setShopName('');
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally { setProvisioning(false); }
  }

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
    <>
    <Card title="สร้างร้านทดสอบทั้งร้าน (ครบชุด)" style={{ marginBottom: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="สร้าง tenant ใหม่ (slug ขึ้นต้น test- เสมอ) + admin user + staff/products/customers/orders/conversations/purchase ครบชุดในคลิกเดียว"
        description={<>ถ้า seed ขั้นไหนพังกลางทาง ร้านที่เพิ่งสร้างจะถูกลบทิ้งอัตโนมัติ (ไม่เหลือร้าน half-seeded ค้าง) ·
          ลบร้านนี้ทีหลังได้ที่ <code>/admin/tenants</code> (ปุ่ม &quot;ลบ&quot; โชว์เฉพาะร้านที่ slug ขึ้นต้น <code>test-</code>)</>}
      />
      <Space>
        <Input
          placeholder="ชื่อร้าน (ไม่ใส่ = สุ่มให้)"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          style={{ width: 260 }}
          onPressEnter={provisionShop}
        />
        <Button type="primary" onClick={provisionShop} loading={provisioning}>สร้างร้านทดสอบ</Button>
      </Space>
    </Card>

    <Modal
      open={!!provisioned}
      title="สร้างร้านทดสอบสำเร็จ"
      onCancel={() => setProvisioned(null)}
      footer={[
        <Button key="close" onClick={() => setProvisioned(null)}>ปิด</Button>,
        <Button key="enter" type="primary" loading={entering}
          onClick={() => provisioned && enterTenant({ variables: { tenantId: provisioned.tenant.id } })}>
          เข้าดูร้านนี้
        </Button>,
      ]}
    >
      {provisioned && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="ร้าน">{provisioned.tenant.name} <span style={{ opacity: 0.7 }}>/{provisioned.tenant.slug}</span></Descriptions.Item>
            <Descriptions.Item label="Admin email">{provisioned.admin.email}</Descriptions.Item>
            <Descriptions.Item label="Admin password">
              <Typography.Text code copyable>{provisioned.admin.password}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Alert style={{ marginTop: 12 }} type="warning" showIcon
            message="รหัสผ่านนี้แสดงครั้งเดียว — คัดลอกเก็บไว้ก่อนปิดหน้าต่างนี้" />
          <div style={{ marginTop: 12 }}>
            สร้างแล้ว: staff {provisioned.summary.staff ?? 0} · สินค้า {provisioned.summary.products ?? 0} ·
            ลูกค้า {provisioned.summary.customers ?? 0} · ออเดอร์ {provisioned.summary.orders ?? 0} ·
            แชท {provisioned.summary.conversations ?? 0} · PO {provisioned.summary.purchaseOrders ?? 0}
          </div>
        </>
      )}
    </Modal>

    <Card
      title="Dev: Fake Data Generator"
      extra={<Space wrap>
        <Select
          value={kind}
          onChange={(v) => {
            const next = v as FakeKind;
            setKind(next);
            if (next === 'bms-ai-usage') setCount(3);
          }}
          options={KINDS}
          style={{ width: 180 }}
        />
        <InputNumber min={1} max={2000} value={count} onChange={(v) => setCount(v || 1)} />
        <Button type="primary" onClick={doFake} loading={loading}>Create</Button>
        <Popconfirm
          title="ลบข้อมูล fake ทั้งหมดของร้านนี้?"
          description={<>ลบถาวร ย้อนกลับไม่ได้ — ร้าน <b>{tenant?.name || '…'}</b></>}
          okText="ลบเลย" okButtonProps={{ danger: true }} cancelText="ยกเลิก"
          onConfirm={cleanup}
        >
          <Button danger disabled={loading}>Cleanup</Button>
        </Popconfirm>
      </Space>}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={<Space wrap>กำลังสร้าง/ลบข้อมูลในร้าน:
          {tenant ? <Tag color="blue">{tenant.name} <span style={{ opacity: 0.7 }}>/{tenant.slug}</span></Tag> : <Tag>กำลังโหลด…</Tag>}
        </Space>}
        description="ข้อมูล fake ทั้งหมดลง 'ร้านของคุณ' (ตาม user ที่ล็อกอิน) → เห็นใน list/Dashboard ของร้านตัวเองทันที · Cleanup ลบเฉพาะ fake ของร้านนี้"
      />
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message="ใช้เฉพาะ dev/test (production ปิด default — เปิดด้วย env BMS_ALLOW_FAKE_SEED=1 บนเครื่อง demo)"
        description={<>ลำดับแนะนำ: <b>Staff → Products → Customers → Orders → Conversations → Purchase</b> (Orders/Conv/Purchase สุ่มจาก products/customers ที่มี) ·
          <b>Orders</b> backdate 30 วัน + พ่วง payment/shipment → เติม Dashboard/Reports/CRM/Payment/Shipping ·
          <b>Conversations</b> + messages → เติม Inbox · marker: <code>FAKE-</code> / tag <code>fake</code> ·
          <b>AI Usage</b> เพิ่มตัวนับ quota เดือนนี้จริงใน <code>bms_ai_usage_monthly</code> เพื่อทดสอบหน้า Settings ·
          <b>Cleanup</b> ลบ fake ทั้งหมด (ตามลำดับ FK, ข้ามตัวที่มี order อ้างถึง)</>}
      />
      <Divider style={{ margin: '8px 0 16px' }} />
      <Table dataSource={created} columns={cols} rowKey={(r) => r.id || r.sku} size="small" pagination={{ pageSize: 20 }} />
    </Card>
    </>
  );
}
