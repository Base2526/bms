'use client';
import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider, Tag, Alert, Popconfirm, Input, Modal, Descriptions, Typography } from 'antd';
import { gql, useQuery, useMutation } from '@apollo/client';
import { SHOP_ARCHETYPE_OPTIONS } from '@/lib/bms/shopArchetypes';

const Q_ME = gql`
  query {
    bmsIsPlatformAdmin
    bmsMe { tenant { id name slug } }
  }
`;
const Q_TENANTS = gql`query { bmsTenants { id name slug active } }`;
const M_ENTER_TENANT = gql`mutation ($tenantId: ID!) { bmsEnterTenant(tenantId: $tenantId) }`;

type ProvisionResult = {
  tenant: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
  summary: Record<string, number>;
};

type DemoProvisionResult = {
  key: string;
  tenant: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
  businessArchetype: string;
  summary: Record<string, number>;
};

type CreatedRow = any;

const KINDS = [
  { label: 'BMS Staff (users)', value: 'users' },
  { label: 'BMS Products', value: 'bms-products' },
  { label: 'BMS Customers', value: 'bms-customers' },
  { label: 'BMS Orders (+pay/ship)', value: 'bms-orders' },
  { label: 'BMS Conversations', value: 'bms-conversations' },
  { label: 'BMS Restock Subscriptions', value: 'bms-restock-subscriptions' },
  { label: 'BMS Purchase (PO)', value: 'bms-purchase' },
  { label: 'BMS Coupons', value: 'bms-coupons' },
  { label: 'BMS AI Usage', value: 'bms-ai-usage' },
];

type FakeKind = 'users' | 'bms-products' | 'bms-customers' | 'bms-orders' | 'bms-conversations' | 'bms-restock-subscriptions' | 'bms-purchase' | 'bms-coupons' | 'bms-ai-usage';

export default function DevFakePage() {
  const [kind, setKind] = useState<FakeKind>('bms-products');
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedRow[]>([]);
  const { data, loading: pageLoading } = useQuery(Q_ME, { fetchPolicy: 'cache-and-network' });
  const isPlatformAdmin = data?.bmsIsPlatformAdmin === true;
  const tenant = data?.bmsMe?.tenant;
  const { data: tenantsData, loading: tenantsLoading } = useQuery(Q_TENANTS, {
    fetchPolicy: 'cache-and-network',
    skip: !isPlatformAdmin,
  });
  const tenantOptions = (tenantsData?.bmsTenants || []).map((t: any) => ({
    value: t.id,
    label: `${t.name} /${t.slug}${t.active === false ? ' (ปิดอยู่)' : ''}`,
  }));
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(undefined);

  const [shopName, setShopName] = useState('');
  const [shopArchetype, setShopArchetype] = useState<string | undefined>(undefined);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [provisioningDemo, setProvisioningDemo] = useState(false);
  const [demoProvisioned, setDemoProvisioned] = useState<DemoProvisionResult[]>([]);
  const [enterTenant, { loading: entering }] = useMutation(M_ENTER_TENANT, {
    // reload ทั้งหน้าเพื่อให้ context (tenant) ใหม่มีผลกับทุกหน้า — pattern เดียวกับ /admin/tenants
    onCompleted: () => { window.location.href = '/admin/dashboard'; },
    onError: (e) => message.error(e?.message || 'เข้าดูร้านไม่สำเร็จ'),
  });

  useEffect(() => {
    if (selectedTenantId) return;
    if (tenant?.id) {
      setSelectedTenantId(tenant.id);
      return;
    }
    if (tenantOptions.length > 0) {
      setSelectedTenantId(tenantOptions[0].value);
    }
  }, [selectedTenantId, tenant?.id, tenantOptions]);

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

  async function provisionDemoShops(shopKey?: string) {
    setProvisioningDemo(true);
    try {
      const res = await fetch('/api/dev/fake/provision-demo-shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopKey ? { shopKey } : {}),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      message.success(`สร้าง demo shop สำเร็จ ${j.created?.length || 0} ร้าน`);
      setDemoProvisioned(j.created || []);
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally {
      setProvisioningDemo(false);
    }
  }

  async function doFake() {
    if (!selectedTenantId) {
      message.warning('กรุณาเลือกร้านก่อน');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/dev/fake/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId, count }),
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
    if (!selectedTenantId) {
      message.warning('กรุณาเลือกร้านก่อน');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/dev/fake/cleanup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId }),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Cleanup failed');
      message.success(
        `Deleted ${j.deleted} — restock:${j.bmsRestockSubscriptions ?? 0} orders:${j.bmsOrders ?? 0} conv:${j.bmsConversations ?? 0} PO:${j.bmsPurchaseOrders ?? 0} coupons:${j.bmsCoupons ?? 0} suppliers:${j.bmsSuppliers ?? 0} products:${j.bmsProducts ?? 0} customers:${j.bmsCustomers ?? 0}`
      );
      setCreated([]);
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally { setLoading(false); }
  }

  const cols = [
    { title: 'id / sku / code', key: 'id', width: 200, render: (_: any, r: any) => r.sku || r.code || r.id },
    { title: 'name', dataIndex: 'name', key: 'name', render: (_: any, r: any) => r.name || r.title || r.type },
    {
      title: 'price / value', dataIndex: 'price', key: 'price', width: 110,
      render: (v: any, r: any) => {
        const n = v ?? r.value;
        if (n == null) return '—';
        return r.value != null && r.type === 'PERCENT' ? `${Number(n)}%` : `${Number(n).toLocaleString()} ฿`;
      },
    },
    { title: 'phone', dataIndex: 'phone', key: 'phone' },
    { title: 'tags', dataIndex: 'tags', key: 'tags', render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
  ];

  return (
    <>
    <Card title="สร้างร้านทดสอบทั้งร้าน (ครบชุด)" style={{ marginBottom: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="สร้าง tenant ใหม่ (slug ขึ้นต้น test- เสมอ) + admin user + staff/products/customers/coupons/orders/conversations/purchase ครบชุดในคลิกเดียว"
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
        <Select
          allowClear
          placeholder="เลือก archetype ร้าน"
          value={shopArchetype}
          onChange={setShopArchetype}
          options={SHOP_ARCHETYPE_OPTIONS as any}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={provisionShop} loading={provisioning}>สร้างร้านทดสอบ</Button>
      </Space>
    </Card>

    <Card title="Provision Demo Shops" style={{ marginBottom: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="สร้างร้าน demo คงที่สำหรับ public /demo"
        description={<>จะสร้าง slug คงที่ 5 ร้านคือ <code>demo-fashion</code>, <code>demo-food</code>, <code>demo-beauty</code>, <code>demo-minimart</code>, <code>demo-gadget</code> พร้อมสินค้าและข้อมูล fake เพื่อให้หน้า demo อ่านข้อมูลจริงได้</>}
      />
      <Space wrap>
        <Button type="primary" onClick={() => provisionDemoShops()} loading={provisioningDemo}>
          สร้าง demo shops ทั้งหมด
        </Button>
        <Button onClick={() => provisionDemoShops('fashion')} loading={provisioningDemo}>สร้างเฉพาะ Fashion</Button>
        <Button onClick={() => provisionDemoShops('food')} loading={provisioningDemo}>Food</Button>
        <Button onClick={() => provisionDemoShops('beauty')} loading={provisioningDemo}>Beauty</Button>
        <Button onClick={() => provisionDemoShops('grocery')} loading={provisioningDemo}>Minimart</Button>
        <Button onClick={() => provisionDemoShops('gadgets')} loading={provisioningDemo}>Gadget</Button>
      </Space>
      {demoProvisioned.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {demoProvisioned.map((row) => (
            <Alert
              key={row.tenant.id}
              type="success"
              showIcon
              style={{ marginTop: 8 }}
              message={`${row.tenant.name} /${row.tenant.slug}`}
              description={`archetype: ${row.businessArchetype} · products ${row.summary.products ?? 0} · orders ${row.summary.orders ?? 0} · conversations ${row.summary.conversations ?? 0}`}
            />
          ))}
        </div>
      )}
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
            <Descriptions.Item label="Archetype">{(provisioned as any).businessArchetype || '—'}</Descriptions.Item>
            <Descriptions.Item label="Admin email">{provisioned.admin.email}</Descriptions.Item>
            <Descriptions.Item label="Admin password">
              <Typography.Text code copyable>{provisioned.admin.password}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Alert style={{ marginTop: 12 }} type="warning" showIcon
            message="รหัสผ่านนี้แสดงครั้งเดียว — คัดลอกเก็บไว้ก่อนปิดหน้าต่างนี้" />
          <div style={{ marginTop: 12 }}>
            สร้างแล้ว: staff {provisioned.summary.staff ?? 0} · สินค้า {provisioned.summary.products ?? 0} ·
            ลูกค้า {provisioned.summary.customers ?? 0} · คูปอง {provisioned.summary.coupons ?? 0} ·
            ออเดอร์ {provisioned.summary.orders ?? 0} ·
            แชท {provisioned.summary.conversations ?? 0} · Restock {provisioned.summary.restockSubscriptions ?? 0} · PO {provisioned.summary.purchaseOrders ?? 0}
          </div>
        </>
      )}
    </Modal>

    <Card
      title="Dev: Fake Data Generator"
      extra={<Space wrap>
        <Select
          showSearch
          placeholder="เลือกร้าน"
          value={selectedTenantId}
          onChange={setSelectedTenantId}
          options={tenantOptions}
          optionFilterProp="label"
          loading={pageLoading || tenantsLoading}
          disabled={!isPlatformAdmin}
          style={{ width: 320 }}
        />
        <Select
          value={kind}
          onChange={(v) => {
            const next = v as FakeKind;
            setKind(next);
            if (next === 'bms-ai-usage') setCount(3);
            else if (next === 'bms-restock-subscriptions') setCount(20);
          }}
          options={KINDS}
          style={{ width: 180 }}
        />
        <InputNumber min={1} max={2000} value={count} onChange={(v) => setCount(v || 1)} />
        <Button type="primary" onClick={doFake} loading={loading}>Create</Button>
        <Popconfirm
          title="ลบข้อมูล fake ทั้งหมดของร้านนี้?"
          description={<>ลบถาวร ย้อนกลับไม่ได้ — ร้าน <b>{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || '…'}</b></>}
          okText="ลบเลย" okButtonProps={{ danger: true }} cancelText="ยกเลิก"
          onConfirm={cleanup}
        >
          <Button danger disabled={loading || !selectedTenantId}>Cleanup</Button>
        </Popconfirm>
      </Space>}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={<Space wrap>ร้านเป้าหมาย:
          {selectedTenantId
            ? <Tag color="blue">{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || 'กำลังโหลด…'}</Tag>
            : <Tag>ยังไม่ได้เลือกร้าน</Tag>}
        </Space>}
        description="เลือกร้านจากรายการจริงของระบบก่อนทุกครั้ง แล้ว API จะตรวจซ้ำว่า tenant นั้นมีอยู่จริงก่อน seed หรือ cleanup"
      />
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message="ใช้เฉพาะ dev/test (production ปิด default — เปิดด้วย env BMS_ALLOW_FAKE_SEED=1 บนเครื่อง demo)"
        description={<>ลำดับแนะนำ: <b>Staff → Products → Customers → Coupons → Orders → Conversations → Purchase</b> (Orders/Conv/Purchase สุ่มจาก products/customers ที่มี) ·
          <b>Orders</b> backdate 30 วัน + พ่วง payment/shipment → เติม Dashboard/Reports/CRM/Payment/Shipping ·
          <b>Conversations</b> + messages → เติม Inbox · <b>Coupons</b> สุ่มทั้ง PERCENT/FIXED บางอันปิดใช้งาน/มีขั้นต่ำ/จำกัดจำนวน →
          เติมหน้า Coupons · marker: <code>FAKE-</code> / tag <code>fake</code> / note <code>FAKE</code> ·
          <b>Restock Subscriptions</b> สร้างหลายสถานะผสมกัน (ACTIVE / READY / NOTIFIED / FAILED / PURCHASED / CANCELLED) พร้อม conversation และ delivery history →
          เติมหน้า Restock Subscriptions ·
          <b>AI Usage</b> เพิ่มตัวนับ quota เดือนนี้จริงใน <code>bms_ai_usage_monthly</code> เพื่อทดสอบหน้า Settings ·
          <b>Cleanup</b> ลบ fake ทั้งหมด (ตามลำดับ FK, ข้ามตัวที่มี order อ้างถึง)</>}
      />
      {data && isPlatformAdmin === false && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="เฉพาะแอดมินแพลตฟอร์ม"
          description="บัญชีนี้ไม่มีสิทธิ์เลือกหรือ seed ข้ามร้าน"
        />
      )}
      <Divider style={{ margin: '8px 0 16px' }} />
      <Table dataSource={created} columns={cols} rowKey={(r) => r.id || r.sku} size="small" pagination={{ pageSize: 20 }} />
    </Card>
    </>
  );
}
