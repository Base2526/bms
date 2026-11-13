"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Select, Button, Space, Table, message, Divider, Tag, Alert, Popconfirm, Input, Modal, Descriptions, Typography } from 'antd';
import { gql, useQuery, useMutation } from '@apollo/client';
import { localizedShopArchetypeOptions } from '@/lib/bms/shopArchetypes';
import { DEMO_SCENARIO_SHOPS } from '@/lib/bms/demoScenarioSelection';
import { useI18n } from '@/lib/i18nContext';
import type { getFakeSeedPackage } from '@/lib/bms/devSeedPackage';
import type { Plan } from '@/lib/bms/entitlements';

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
  boardGame?: {
    members: number;
    areas: number;
    tables: number;
    rates: number;
    titles: number;
    copies: number;
    sessions: number;
    participants: number;
    activeLoans: number;
    publicProfiles: number;
  };
};

type ProvisionResult = {
  tenant: { id: string; slug: string; name: string; plan: string };
  admin: { email: string; password: string };
  summary: ProvisionSummary;
  groundTruth?: { id: string; cases: number; generatorVersion: string };
};

type DemoProvisionResult = {
  key: string;
  tenant: { id: string; slug: string; name: string; plan: string };
  admin: { email: string; password: string };
  businessArchetype: string;
  summary: ProvisionSummary;
  groundTruth?: { id: string; cases: number; generatorVersion: string };
};

type GroundTruthCase = {
  id?: string;
  caseKey: string;
  category: string;
  questionTh: string;
  answerType: string;
  expected: { value?: unknown };
  tolerance: number;
  tags: string[];
};

type GroundTruthRun = {
  id: string;
  label: string;
  generatorVersion: string;
  dataFingerprint: string;
  generatedAt: string;
  stale: boolean;
  sourceSnapshot: Record<string, any>;
  cases: GroundTruthCase[];
};

function channelOrderSummary(summary: ProvisionSummary): string {
  const counts = summary.ordersByChannel ?? {};
  return `POS ${counts.pos ?? 0} · LINE ${counts.line ?? 0} · IG ${counts.instagram ?? 0} · Facebook ${counts.facebook ?? 0} · Web ${counts.web ?? 0} · TikTok ${counts.tiktok ?? 0} · Shopee ${counts.shopee ?? 0} · Lazada ${counts.lazada ?? 0}`;
}

const DEMO_SHOP_OPTIONS = DEMO_SCENARIO_SHOPS.map((shop) => ({
  value: shop.key,
  label: `${shop.name} /${shop.slug}`,
}));

type CreatedRow = any;

const KINDS = (uiText: UiTranslator = thaiUiText) => ([
  { label: uiText("admin_ui.en_bms_staff_users_50be6"), value: 'users' },
  { label: uiText("admin_ui.en_bms_products_e866a"), value: 'bms-products' },
  { label: uiText("admin_ui.en_bms_customers_92bb4"), value: 'bms-customers' },
  { label: uiText("admin_ui.en_bms_orders_pay_ship_9e510"), value: 'bms-orders' },
  { label: uiText("admin_ui.en_bms_conversations_a87d9"), value: 'bms-conversations' },
  { label: uiText("admin_ui.en_bms_restock_subscriptions_a5dd9"), value: 'bms-restock-subscriptions' },
  { label: uiText("admin_ui.en_bms_purchase_po_6bb47"), value: 'bms-purchase' },
  { label: uiText("admin_ui.en_bms_coupons_e74f7"), value: 'bms-coupons' },
  // ต้อง seed Customers (และควร Orders) ก่อน — ปุ่มนี้ยกลูกค้าเดิมขึ้นเป็นสมาชิก
  { label: uiText("admin_ui.en_bms_members_points_fed6e"), value: 'bms-members' },
  { label: uiText("admin_ui.en_bms_board_game_cafe_e5135"), value: 'bms-board-game' },
  { label: uiText("admin_ui.en_bms_pharmacy_assessments_859ef"), value: 'bms-pharmacy-assessments' },
  { label: uiText("admin_ui.en_support_tickets_6564b"), value: 'support-tickets' },
]);

type FakeKind = 'users' | 'bms-products' | 'bms-customers' | 'bms-orders' | 'bms-conversations' | 'bms-restock-subscriptions' | 'bms-purchase' | 'bms-coupons' | 'bms-members' | 'bms-board-game' | 'bms-pharmacy-assessments' | 'support-tickets';

export default function DevFakePage() {
  const uiText = useUiText();
  const { t } = useI18n();
  const archetypeOptions = localizedShopArchetypeOptions(t);
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
  const [planCode, setPlanCode] = useState('free');
  const [packageInfo, setPackageInfo] = useState<(Awaited<ReturnType<typeof getFakeSeedPackage>> & { plans: Plan[] }) | null>(null);
  const [packageRefresh, setPackageRefresh] = useState(0);
  const [packageError, setPackageError] = useState('');
  useEffect(() => {
    if (!selectedTenantId || !isPlatformAdmin) return;
    const controller = new AbortController();
    setPackageInfo(null);
    setPackageError('');
    fetch(`/api/dev/fake/package?tenantId=${encodeURIComponent(selectedTenantId)}`, { signal: controller.signal, credentials: 'include' })
      .then(async res => { const json = await res.json(); if (!res.ok) throw new Error(json.error || uiText("admin_ui.en_failed_09fef")); return json; })
      .then(info => { if (!controller.signal.aborted) setPackageInfo(info); })
      .catch(error => { if (!controller.signal.aborted) setPackageError(error.message); });
    return () => controller.abort();
  }, [selectedTenantId, isPlatformAdmin, packageRefresh]);
  const planOptions = packageInfo?.plans.map(plan => ({ value: plan.code, label: plan.name })) ?? [];
  const remaining = kind === 'users' ? packageInfo?.users.remaining : kind === 'bms-products' ? packageInfo?.products.remaining : undefined;
  const overQuota = remaining != null && remaining >= 0 && count > remaining;
  const quotaCount = (value: number) => value < 0 ? t('admin_billing.unlimited') : String(value);

  const [shopName, setShopName] = useState('');
  const [shopArchetype, setShopArchetype] = useState<string | undefined>(undefined);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [provisioningDemo, setProvisioningDemo] = useState(false);
  const [selectedDemoKey, setSelectedDemoKey] = useState<string | undefined>(undefined);
  const [deletingScenarios, setDeletingScenarios] = useState(false);
  const [demoProvisioned, setDemoProvisioned] = useState<DemoProvisionResult[]>([]);
  const [groundTruth, setGroundTruth] = useState<GroundTruthRun | null>(null);
  const [groundTruthLoading, setGroundTruthLoading] = useState(false);
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
          planCode,
        }),

        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_failed_09fef"));
      message.success(t('admin_dev_fake.shop_created', { name: j.tenant.name, slug: j.tenant.slug }));
      setProvisioned(j);
      setShopName('');
      await refetchTenants();
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally { setProvisioning(false); setPackageRefresh(value => value + 1); }
  }

  async function provisionDemoShop() {
    if (!selectedDemoKey) {
      message.warning(t('admin_dev_fake.scenario_select_required'));
      return;
    }
    setProvisioningDemo(true);
    try {
      const res = await fetch('/api/dev/fake/provision-demo-shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopKey: selectedDemoKey, planCode }),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_failed_09fef"));
      message.success(t('admin_dev_fake.demo_created', { count: j.created?.length || 0 }));
      setDemoProvisioned((current) => {
        const createdRows: DemoProvisionResult[] = j.created || [];
        const createdKeys = new Set(createdRows.map((row) => row.key));
        return [...createdRows, ...current.filter((row) => !createdKeys.has(row.key))];
      });
      await refetchTenants();
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally {
      setProvisioningDemo(false);
      setPackageRefresh(value => value + 1);
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
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_delete_failed_64513"));
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
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
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
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_failed_09fef"));
      message.success(uiText("admin_ui.en_created_c8af2", { v0: j.created?.length || 0, v1: kind }));
      setCreated(prev => [...(j.created || []), ...prev].slice(0, 300));
      setGroundTruth((current) => current ? { ...current, stale: true } : current);
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally { setLoading(false); setPackageRefresh(value => value + 1); }
  }

  async function loadGroundTruth() {
    if (!selectedTenantId) {
      message.warning(t('admin_dev_fake.select_shop_first'));
      return;
    }
    setGroundTruthLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: selectedTenantId });
      const res = await fetch(`/api/dev/fake/ground-truth?${params}`, { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_load_ground_truth_failed_09d29"));
      setGroundTruth(j.run || null);
      if (!j.run) message.info(t('admin_dev_fake.ground_truth_not_found'));
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally {
      setGroundTruthLoading(false);
    }
  }

  async function generateGroundTruth() {
    if (!selectedTenantId) {
      message.warning(t('admin_dev_fake.select_shop_first'));
      return;
    }
    setGroundTruthLoading(true);
    try {
      const res = await fetch('/api/dev/fake/ground-truth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId }),
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_generate_ground_truth_failed_1bccd"));
      setGroundTruth(j.run);
      message.success(t('admin_dev_fake.ground_truth_created', { count: j.run?.cases?.length ?? 0 }));
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally {
      setGroundTruthLoading(false);
    }
  }

  function downloadGroundTruth() {
    if (!groundTruth) return;
    const blob = new Blob([JSON.stringify(groundTruth, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bms-ground-truth-${groundTruth.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
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
      if (!res.ok) throw new Error(j?.error || uiText("admin_ui.en_cleanup_failed_2700e"));
      message.success(
        uiText("admin_ui.en_deleted_restock_orders_conv_po_coupons_suppliers_products_dc232", { v0: j.deleted, v1: j.bmsRestockSubscriptions ?? 0, v2: j.bmsOrders ?? 0, v3: j.bmsConversations ?? 0, v4: j.bmsPurchaseOrders ?? 0, v5: j.bmsCoupons ?? 0, v6: j.bmsSuppliers ?? 0, v7: j.bmsProducts ?? 0, v8: j.bmsCustomers ?? 0, v9: j.supportTickets ?? 0 })
      );
      setCreated([]);
      setGroundTruth(null);
    } catch (e: any) {
      message.error(e.message || uiText("admin_ui.en_error_7f2f6"));
    } finally { setLoading(false); setPackageRefresh(value => value + 1); }
  }

  const cols = [
    { title: uiText("admin_ui.en_id_sku_code_37f29"), key: 'id', width: 200, render: (_: any, r: any) => r.sku || r.code || r.id },
    { title: uiText("admin_ui.en_name_6ae99"), dataIndex: uiText("admin_ui.en_name_6ae99"), key: uiText("admin_ui.en_name_6ae99"), render: (_: any, r: any) => r.name || r.title || r.type },
    {
      title: uiText("admin_ui.en_price_value_602ea"), dataIndex: 'price', key: 'price', width: 110,
      render: (v: any, r: any) => {
        const n = v ?? r.value;
        if (n == null) return '—';
        return r.value != null && r.type === 'PERCENT' ? `${Number(n)}%` : `${Number(n).toLocaleString()} ฿`;
      },
    },
    { title: uiText("admin_ui.en_phone_f6be6"), dataIndex: uiText("admin_ui.en_phone_f6be6"), key: uiText("admin_ui.en_phone_f6be6") },
    { title: uiText("admin_ui.en_tags_9b6ef"), dataIndex: uiText("admin_ui.en_tags_9b6ef"), key: uiText("admin_ui.en_tags_9b6ef"), render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
  ];

  return (
    <>
    <Card title={t('admin_dev_fake.provision_card_title')} style={{ marginBottom: 16 }}>
      <Alert closable
        type="info" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.provision_alert')}
        description={<>{t('admin_dev_fake.provision_desc_1')} <code>/admin/tenants</code> {t('admin_dev_fake.provision_desc_2')} <code>test-</code>)</>}
      />
      <Alert closable type="info" showIcon style={{ marginBottom: 12 }} message={t('admin_dev_fake.package_help')} />
      <Space wrap>
        <Select aria-label={t('admin_dev_fake.package_label')} value={planCode} onChange={setPlanCode} options={planOptions} style={{ width: 160 }} />
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
          options={archetypeOptions}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={provisionShop} loading={provisioning}>{t('admin_dev_fake.btn_provision')}</Button>
      </Space>
    </Card>

    <Card title={t('admin_dev_fake.scenario_card_title')} style={{ marginBottom: 16 }}>
      <Alert closable
        type="info" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.demo_alert')}
        description={<>{t('admin_dev_fake.demo_desc_1')} <code>demo-fashion</code>, <code>demo-food</code>, <code>demo-beauty</code>, <code>demo-minimart</code>, <code>demo-gadget</code>, <code>demo-pharmacy</code>, <code>demo-general</code> {t('admin_dev_fake.demo_desc_2')}</>}
      />
      <Space wrap>
        <Select aria-label={t('admin_dev_fake.package_label')} value={planCode} onChange={setPlanCode} options={planOptions} style={{ width: 160 }} />
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={t('admin_dev_fake.scenario_select_placeholder')}
          value={selectedDemoKey}
          onChange={setSelectedDemoKey}
          options={DEMO_SHOP_OPTIONS as any}
          style={{ width: 260, maxWidth: '100%' }}
          disabled={provisioningDemo || deletingScenarios}
        />
        <Button
          type="primary"
          onClick={provisionDemoShop}
          loading={provisioningDemo}
          disabled={!selectedDemoKey || deletingScenarios}
        >
          {t('admin_dev_fake.btn_demo_selected')}
        </Button>
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
            <Alert closable
              key={row.tenant.id}
              type="success"
              showIcon
              style={{ marginTop: 8 }}
              message={`${row.tenant.name} /${row.tenant.slug} · ${row.tenant.plan}`}
              description={uiText("admin_ui.en_archetype_staff_pos_devices_products_orders_inbox_chats_ebf5d", { v0: row.businessArchetype, v1: row.summary.staff ?? 0, v2: row.summary.posDevices ?? 0, v3: row.summary.products ?? 0, v4: row.summary.orders ?? 0, v5: channelOrderSummary(row.summary), v6: row.summary.conversations ?? 0, v7: row.summary.customers ?? 0, v8: row.groundTruth?.cases ?? 0 })}
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
            <Descriptions.Item label={uiText("admin_ui.en_archetype_85e8a")}>{(provisioned as any).businessArchetype || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('admin_dev_fake.package_label')}>{provisioned.tenant.plan}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_admin_email_f0fee")}>{provisioned.admin.email}</Descriptions.Item>
            <Descriptions.Item label={uiText("admin_ui.en_admin_password_b2cee")}>
              <Typography.Text code copyable>{provisioned.admin.password}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Alert closable style={{ marginTop: 12 }} type="warning" showIcon
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
          {provisioned.summary.boardGame && (
            <Alert
              closable
              style={{ marginTop: 12 }}
              type="success"
              showIcon
              message={t('admin_dev_fake.board_game_summary', {
                tables: provisioned.summary.boardGame.tables,
                sessions: provisioned.summary.boardGame.sessions,
                games: provisioned.summary.boardGame.titles,
                copies: provisioned.summary.boardGame.copies,
                members: provisioned.summary.boardGame.members,
              })}
            />
          )}
          {provisioned.groundTruth && (
            <Alert closable
              style={{ marginTop: 12 }}
              type="success"
              showIcon
              message={t('admin_dev_fake.ground_truth_auto_created', { count: provisioned.groundTruth.cases })}
            />
          )}
        </>
      )}
    </Modal>

    <Card
      title={t('admin_dev_fake.ground_truth_title')}
      style={{ marginBottom: 16 }}
    >
        <Space wrap style={{ marginBottom: 12 }}>
          <Button onClick={loadGroundTruth} loading={groundTruthLoading} disabled={!selectedTenantId}>
            {t('admin_dev_fake.ground_truth_load')}
          </Button>
          <Button type="primary" onClick={generateGroundTruth} loading={groundTruthLoading} disabled={!selectedTenantId}>
            {t('admin_dev_fake.ground_truth_generate')}
          </Button>
          <Button onClick={downloadGroundTruth} disabled={!groundTruth}>
            {t('admin_dev_fake.ground_truth_download')}
          </Button>
        </Space>
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.ground_truth_alert')}
        description={t('admin_dev_fake.ground_truth_desc')}
      />
      {groundTruth && (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 4 }} style={{ marginBottom: 12 }}>
            <Descriptions.Item label={uiText("admin_ui.en_run_id_79adb")}><Typography.Text code copyable>{groundTruth.id}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label={t('admin_dev_fake.ground_truth_version')}>{groundTruth.generatorVersion}</Descriptions.Item>
            <Descriptions.Item label={t('admin_dev_fake.ground_truth_cases')}>{groundTruth.cases.length}</Descriptions.Item>
            <Descriptions.Item label={t('admin_dev_fake.ground_truth_status')}>
              <Tag color={groundTruth.stale ? 'orange' : 'green'}>
                {groundTruth.stale ? t('admin_dev_fake.ground_truth_stale') : t('admin_dev_fake.ground_truth_ready')}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          {groundTruth.stale && (
            <Alert closable type="warning" showIcon style={{ marginBottom: 12 }} message={t('admin_dev_fake.ground_truth_stale_desc')} />
          )}
          <Table
            rowKey="caseKey"
            size="small"
            scroll={{ x: 1050 }}
            pagination={{ pageSize: 10 }}
            dataSource={groundTruth.cases}
            columns={[
              { title: t('admin_dev_fake.ground_truth_category'), dataIndex: 'category', width: 120, render: (value: string) => <Tag>{value}</Tag> },
              { title: t('admin_dev_fake.ground_truth_question'), dataIndex: 'questionTh', width: 360 },
              { title: t('admin_dev_fake.ground_truth_type'), dataIndex: 'answerType', width: 110 },
              {
                title: t('admin_dev_fake.ground_truth_answer'),
                key: 'expected',
                width: 360,
                render: (_: unknown, row: GroundTruthCase) => (
                  <Typography.Text code>{JSON.stringify(row.expected?.value)}</Typography.Text>
                ),
              },
            ]}
          />
        </>
      )}
    </Card>

    <Card
      title={uiText("admin_ui.en_dev_fake_data_generator_a0de0")}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          showSearch
          placeholder={t('admin_dev_fake.select_shop_placeholder')}
          value={selectedTenantId}
          onChange={(value) => { setSelectedTenantId(value); setPackageInfo(null); setGroundTruth(null); }}
          options={tenantOptions}
          optionFilterProp="label"
          loading={pageLoading || tenantsLoading}
          disabled={!isPlatformAdmin}
          style={{ width: 260 }}
        />
        <Select
          value={kind}
          onChange={(v) => {
            const next = v as FakeKind;
            setKind(next);
          if (next === 'bms-restock-subscriptions') setCount(20);
          else if (next === 'bms-pharmacy-assessments') setCount(5);
        }}
        options={KINDS(uiText)}
        style={{ width: 180 }}
      />
        <InputNumber min={1} max={10000} value={count} onChange={(v) => setCount(v || 1)} />
        <Button type="primary" onClick={doFake} loading={loading} disabled={!packageInfo || overQuota}>{uiText("admin_ui.en_create_6e157")}</Button>
        <Popconfirm
          title={t('admin_dev_fake.cleanup_confirm_title')}
          description={<>{t('admin_dev_fake.cleanup_confirm_desc_1')} <b>{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || '…'}</b></>}
          okText={t('admin_dev_fake.cleanup_ok')} okButtonProps={{ danger: true }} cancelText={t('admin_dev_fake.cleanup_cancel')}
          onConfirm={cleanup}
        >
          <Button danger disabled={loading || !selectedTenantId}>{uiText("admin_ui.en_cleanup_11c1c")}</Button>
        </Popconfirm>
      </Space>
      {packageError && <Alert closable type="error" showIcon message={packageError} />}
      {packageInfo && <Alert closable data-testid="fake-package" type={overQuota ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.package_usage', { plan: packageInfo.plan.name,
          products: packageInfo.products.used, productLimit: quotaCount(packageInfo.products.limit),
          users: packageInfo.users.used, userLimit: quotaCount(packageInfo.users.limit),
          devices: packageInfo.devices.used, deviceLimit: quotaCount(packageInfo.devices.limit) })}
        description={t('admin_dev_fake.package_seed_help')} />}
      <Alert closable
        type="info" showIcon style={{ marginBottom: 12 }}
        message={<Space wrap>{t('admin_dev_fake.target_shop_label')}
          {selectedTenantId
            ? <Tag color="blue">{tenantOptions.find((x: any) => x.value === selectedTenantId)?.label || t('admin_dev_fake.loading_shop')}</Tag>
            : <Tag>{t('admin_dev_fake.no_shop_selected')}</Tag>}
        </Space>}
        description={t('admin_dev_fake.target_shop_desc')}
      />
      <Alert closable
        type="warning" showIcon style={{ marginBottom: 12 }}
        message={t('admin_dev_fake.dev_only_title')}
        description={<>{t('admin_dev_fake.seed_desc_p1')}<b>{uiText("admin_ui.en_staff_products_customers_coupons_orders_conversations_purchase_2c6ac")}</b>{t('admin_dev_fake.seed_desc_p2')}
          <b>{uiText("admin_ui.en_orders_cded0")}</b>{t('admin_dev_fake.seed_desc_p3')}
          <b>{uiText("admin_ui.en_conversations_07c59")}</b>{t('admin_dev_fake.seed_desc_p4')}<b>{uiText("admin_ui.en_coupons_97a3b")}</b>{t('admin_dev_fake.seed_desc_p5')}<code>FAKE-</code>  {uiText("admin_ui.en_tag_8ce75")} <code>fake</code>  {uiText("admin_ui.en_note_1f21a")} <code>FAKE</code> ·
          <b>{uiText("admin_ui.en_restock_subscriptions_d51f6")}</b>{t('admin_dev_fake.seed_desc_p6')}
          <b>{uiText("admin_ui.en_pharmacy_assessments_5aaad")}</b>{t('admin_dev_fake.seed_desc_p7')}
          <b>{uiText("admin_ui.en_board_game_cafe_bdd22")}</b>{t('admin_dev_fake.seed_desc_board_game')}
          <b>{uiText("admin_ui.en_ai_point_c97bb")}</b>{t('admin_dev_fake.seed_desc_p8')}<code>/admin/billing</code>{t('admin_dev_fake.seed_desc_p9')}
          <b>{uiText("admin_ui.en_cleanup_11c1c")}</b>{t('admin_dev_fake.seed_desc_p10')}</>}
      />
      {data && isPlatformAdmin === false && (
        <Alert closable
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('admin_dev_fake.platform_only_title')}
          description={t('admin_dev_fake.platform_only_desc')}
        />
      )}
      <Divider style={{ margin: '8px 0 16px' }} />
      <Table dataSource={created} columns={cols} rowKey={(r) => r.id || r.sku} size="small" scroll={{ x: 720 }} pagination={{ pageSize: 20 }} />
    </Card>
    </>
  );
}
