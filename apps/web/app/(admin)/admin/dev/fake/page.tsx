'use client';
import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider, Tag, Alert, Popconfirm, Input, Modal, Descriptions, Typography } from 'antd';
import { gql, useQuery, useMutation } from '@apollo/client';
import { SHOP_ARCHETYPE_OPTIONS } from '@/lib/bms/shopArchetypes';
import { useI18n } from '@/lib/i18nContext';

const Q_ME = gql`
  query {
    bmsIsPlatformAdmin
    bmsMe { tenant { id name slug } }
  }
`;
const Q_TENANTS = gql`query { bmsTenants { id name slug active } }`;
const M_ENTER_TENANT = gql`mutation ($tenantId: ID!) { bmsEnterTenant(tenantId: $tenantId) }`;
const M_EXIT_TENANT = gql`mutation { bmsExitTenant }`;

type ProvisionSummary = {
  staff?: number;
  products?: number;
  customers?: number;
  coupons?: number;
  orders?: number;
  conversations?: number;
  restockSubscriptions?: number;
  purchaseOrders?: number;
  posDevices?: number;
  pairedPosDevices?: number;
  posShifts?: number;
  posOrdersWithOperations?: number;
  ordersByChannel?: Record<string, number>;
};

type ProvisionResult = {
  tenant: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
  summary: ProvisionSummary;
};

type DemoProvisionResult = {
  key: string;
  tenant: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
  businessArchetype: string;
  summary: ProvisionSummary;
};

function channelOrderSummary(summary: ProvisionSummary): string {
  const counts = summary.ordersByChannel ?? {};
  return `POS ${counts.pos ?? 0} · LINE ${counts.line ?? 0} · IG ${counts.instagram ?? 0} · Facebook ${counts.facebook ?? 0} · Web ${counts.web ?? 0} · TikTok ${counts.tiktok ?? 0} · Shopee ${counts.shopee ?? 0} · Lazada ${counts.lazada ?? 0}`;
}

const DEMO_BUTTONS = [
  { key: "fashion", label: "Fashion" },
  { key: "food", label: "Food" },
  { key: "beauty", label: "Beauty" },
  { key: "grocery", label: "Minimart" },
  { key: "gadgets", label: "Gadget" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "general", label: "General Retail" },
] as const;

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
  // ต้อง seed Customers (และควร Orders) ก่อน — ปุ่มนี้ยกลูกค้าเดิมขึ้นเป็นสมาชิก
  { label: 'BMS Members + Points', value: 'bms-members' },
  { label: 'BMS AI Usage', value: 'bms-ai-usage' },
  { label: 'BMS Pharmacy Assessments', value: 'bms-pharmacy-assessments' },
  { label: 'Support Tickets', value: 'support-tickets' },
];

type FakeKind = 'users' | 'bms-products' | 'bms-customers' | 'bms-orders' | 'bms-conversations' | 'bms-restock-subscriptions' | 'bms-purchase' | 'bms-coupons' | 'bms-members' | 'bms-ai-usage' | 'bms-pharmacy-assessments' | 'support-tickets';

export default function DevFakePage() {
  const { t } = useI18n();
  const [kind, setKind] = useState<FakeKind>('bms-products');
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedRow[]>([]);
  const { data, loading: pageLoading } = useQuery(Q_ME, { fetchPolicy: 'cache-and-network' });
  const isPlatformAdmin = data?.bmsIsPlatformAdmin === true;
  const tenant = data?.bmsMe?.tenant;
  const { data: tenantsData, loading: tenantsLoading, refetch: refetchTenants } = useQuery(Q_TENANTS, {
    fetchPolicy: 'cache-and-network',
    skip: !isPlatformAdmin,
  });
  const tenantOptions = (tenantsData?.bmsTenants || []).map((row: any) => ({
    value: row.id,
    label: `${row.name} /${row.slug}${row.active === false ? t('admin_dev_fake.tenant_inactive_suffix') : ''}`,
  }));
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(undefined);

  const [shopName, setShopName] = useState('');
  const [shopArchetype, setShopArchetype] = useState<string | undefined>(undefined);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [provisioningDemo, setProvisioningDemo] = useState(false);
  const [deletingScenarios, setDeletingScenarios] = useState(false);
  const [demoProvisioned, setDemoProvisioned] = useState<DemoProvisionResult[]>([]);
  const [enterTenant, { loading: entering }] = useMutation(M_ENTER_TENANT, {
    // reload ทั้งหน้าเพื่อให้ context (tenant) ใหม่มีผลกับทุกหน้า — pattern เดียวกับ /admin/tenants
    onCompleted: () => { window.location.href = '/admin/dashboard'; },
    onError: (e) => message.error(e?.message || t('admin_dev_fake.impersonate_failed')),
  });
  const [exitTenant] = useMutation(M_EXIT_TENANT);

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
        body: JSON.stringify({
          name: shopName.trim() || undefined,
          businessArchetype: shopArchetype || undefined,
        }),

        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      message.success(t('admin_dev_fake.shop_created', { name: j.tenant.name, slug: j.tenant.slug }));
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
      message.success(t('admin_dev_fake.demo_created', { count: j.created?.length || 0 }));
      setDemoProvisioned(j.created || []);
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally {
      setProvisioningDemo(false);
    }
  }

  async function deleteAllScenarioShops() {
    setDeletingScenarios(true);
    try {
      const res = await fetch('/api/dev/fake/provision-demo-shops', {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Delete failed');
      message.success(t('admin_dev_fake.scenario_delete_success', { count: j.deletedCount ?? 0 }));
      setDemoProvisioned([]);
      setCreated([]);
      const deletedCurrentTenant = (j.deleted || []).some((row: any) => row.id === tenant?.id);
      if (deletedCurrentTenant) {
        await exitTenant();
        window.location.href = '/admin/dev/fake';
        return;
      }
      if ((j.deleted || []).some((row: any) => row.id === selectedTenantId)) {
        setSelectedTenantId(undefined);
      }
      await refetchTenants();
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally {
      setDeletingScenarios(false);
    }
  }

  async function doFake() {
    if (!selectedTenantId) {
      message.warning(t('admin_dev_fake.select_shop_first'));
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
      message.warning(t('admin_dev_fake.select_shop_first'));
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
        `Deleted ${j.deleted} — restock:${j.bmsRestockSubscriptions ?? 0} orders:${j.bmsOrders ?? 0} conv:${j.bmsConversations ?? 0} PO:${j.bmsPurchaseOrders ?? 0} coupons:${j.bmsCoupons ?? 0} suppliers:${j.bmsSuppliers ?? 0} products:${j.bmsProducts ?? 0} customers:${j.bmsCustomers ?? 0} support:${j.supportTickets ?? 0}`
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
    <Card title={t('admin_dev_fake.provision_card_title')} style={{ marginBottom: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.provision_alert')}
        description={<>{t('admin_dev_fake.provision_desc_1')} <code>/admin/tenants</code> {t('admin_dev_fake.provision_desc_2')} <code>test-</code>)</>}
      />
      <Space>
        <Input
          placeholder={t('admin_dev_fake.shop_name_placeholder')}
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          style={{ width: 260 }}
          onPressEnter={provisionShop}
        />
        <Select
          allowClear
          placeholder={t('admin_dev_fake.archetype_placeholder')}
          value={shopArchetype}
          onChange={setShopArchetype}
          options={SHOP_ARCHETYPE_OPTIONS as any}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={provisionShop} loading={provisioning}>{t('admin_dev_fake.btn_provision')}</Button>
      </Space>
    </Card>

    <Card title={t('admin_dev_fake.scenario_card_title')} style={{ marginBottom: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.demo_alert')}
        description={<>{t('admin_dev_fake.demo_desc_1')} <code>demo-fashion</code>, <code>demo-food</code>, <code>demo-beauty</code>, <code>demo-minimart</code>, <code>demo-gadget</code>, <code>demo-pharmacy</code>, <code>demo-general</code> {t('admin_dev_fake.demo_desc_2')}</>}
      />
      <Space wrap>
        <Button type="primary" onClick={() => provisionDemoShops()} loading={provisioningDemo}>
          {t('admin_dev_fake.btn_demo_all')}
        </Button>
        {DEMO_BUTTONS.map((demo) => (
          <Button key={demo.key} onClick={() => provisionDemoShops(demo.key)} loading={provisioningDemo}>
            {demo.label}
          </Button>
        ))}
        <Popconfirm
          title={t('admin_dev_fake.scenario_delete_confirm_title')}
          description={t('admin_dev_fake.scenario_delete_confirm_desc')}
          okText={t('admin_dev_fake.scenario_delete_confirm_ok')}
          okButtonProps={{ danger: true }}
          cancelText={t('admin_dev_fake.cleanup_cancel')}
          onConfirm={deleteAllScenarioShops}
        >
          <Button danger loading={deletingScenarios} disabled={provisioningDemo}>
            {t('admin_dev_fake.btn_delete_scenarios')}
          </Button>
        </Popconfirm>
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
              description={`archetype: ${row.businessArchetype} · staff ${row.summary.staff ?? 0} · POS devices ${row.summary.posDevices ?? 0} · products ${row.summary.products ?? 0} · orders ${row.summary.orders ?? 0} (${channelOrderSummary(row.summary)}) · inbox chats ${row.summary.conversations ?? 0} · customers ${row.summary.customers ?? 0}`}
            />
          ))}
        </div>
      )}
    </Card>

    <Modal
      open={!!provisioned}
      title={t('admin_dev_fake.provisioned_title')}
      onCancel={() => setProvisioned(null)}
      footer={[
        <Button key="close" onClick={() => setProvisioned(null)}>{t('admin_dev_fake.btn_close')}</Button>,
        <Button key="enter" type="primary" loading={entering}
          onClick={() => provisioned && enterTenant({ variables: { tenantId: provisioned.tenant.id } })}>
          {t('admin_dev_fake.btn_enter_shop')}
        </Button>,
      ]}
    >
      {provisioned && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('admin_dev_fake.label_shop')}>{provisioned.tenant.name} <span style={{ opacity: 0.7 }}>/{provisioned.tenant.slug}</span></Descriptions.Item>
            <Descriptions.Item label="Archetype">{(provisioned as any).businessArchetype || '—'}</Descriptions.Item>
            <Descriptions.Item label="Admin email">{provisioned.admin.email}</Descriptions.Item>
            <Descriptions.Item label="Admin password">
              <Typography.Text code copyable>{provisioned.admin.password}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Alert style={{ marginTop: 12 }} type="warning" showIcon
            message={t('admin_dev_fake.password_once_notice')} />
          <div style={{ marginTop: 12 }}>
            {t('admin_dev_fake.summary_line', {
              staff: provisioned.summary.staff ?? 0,
              products: provisioned.summary.products ?? 0,
              customers: provisioned.summary.customers ?? 0,
              coupons: provisioned.summary.coupons ?? 0,
              orders: provisioned.summary.orders ?? 0,
              conversations: provisioned.summary.conversations ?? 0,
              restock: provisioned.summary.restockSubscriptions ?? 0,
              po: provisioned.summary.purchaseOrders ?? 0,
              devices: provisioned.summary.posDevices ?? 0,
              shifts: provisioned.summary.posShifts ?? 0,
            })}
          </div>
          <div style={{ marginTop: 8 }}>{channelOrderSummary(provisioned.summary)}</div>
        </>
      )}
    </Modal>

    <Card
      title="Dev: Fake Data Generator"
      extra={<Space wrap>
        <Select
          showSearch
          placeholder={t('admin_dev_fake.select_shop_placeholder')}
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
          else if (next === 'bms-pharmacy-assessments') setCount(5);
        }}
        options={KINDS}
        style={{ width: 180 }}
      />
        <InputNumber min={1} max={2000} value={count} onChange={(v) => setCount(v || 1)} />
        <Button type="primary" onClick={doFake} loading={loading}>Create</Button>
        <Popconfirm
          title={t('admin_dev_fake.cleanup_confirm_title')}
          description={<>{t('admin_dev_fake.cleanup_confirm_desc_1')} <b>{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || '…'}</b></>}
          okText={t('admin_dev_fake.cleanup_ok')} okButtonProps={{ danger: true }} cancelText={t('admin_dev_fake.cleanup_cancel')}
          onConfirm={cleanup}
        >
          <Button danger disabled={loading || !selectedTenantId}>Cleanup</Button>
        </Popconfirm>
      </Space>}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={<Space wrap>{t('admin_dev_fake.target_shop_label')}
          {selectedTenantId
            ? <Tag color="blue">{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || t('admin_dev_fake.loading_shop')}</Tag>
            : <Tag>{t('admin_dev_fake.no_shop_selected')}</Tag>}
        </Space>}
        description={t('admin_dev_fake.target_shop_desc')}
      />
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.dev_only_title')}
        description={<>{t('admin_dev_fake.seed_desc_p1')}<b>Staff → Products → Customers → Coupons → Orders → Conversations → Purchase</b>{t('admin_dev_fake.seed_desc_p2')}
          <b>Orders</b>{t('admin_dev_fake.seed_desc_p3')}
          <b>Conversations</b>{t('admin_dev_fake.seed_desc_p4')}<b>Coupons</b>{t('admin_dev_fake.seed_desc_p5')}<code>FAKE-</code> / tag <code>fake</code> / note <code>FAKE</code> ·
          <b>Restock Subscriptions</b>{t('admin_dev_fake.seed_desc_p6')}
          <b>Pharmacy Assessments</b>{t('admin_dev_fake.seed_desc_p7')}
          <b>AI Usage</b>{t('admin_dev_fake.seed_desc_p8')}<code>bms_ai_usage_monthly</code>{t('admin_dev_fake.seed_desc_p9')}
          <b>Cleanup</b>{t('admin_dev_fake.seed_desc_p10')}</>}
      />
      {data && isPlatformAdmin === false && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('admin_dev_fake.platform_only_title')}
          description={t('admin_dev_fake.platform_only_desc')}
        />
      )}
      <Divider style={{ margin: '8px 0 16px' }} />
      <Table dataSource={created} columns={cols} rowKey={(r) => r.id || r.sku} size="small" pagination={{ pageSize: 20 }} />
    </Card>
    </>
  );
}
