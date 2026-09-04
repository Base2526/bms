'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Switch, Select, Button, Space, Alert, message, Statistic, Row, Col, Card, Popconfirm } from "antd";
import { ReloadOutlined, ShopOutlined, LoginOutlined, DeleteOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const Q = gql`
  query {
    bmsIsPlatformAdmin
    bmsTenants {
      id name slug plan active created_at
      users products orders revenue
    }
    bmsBilling { plans { code name } }
  }
`;
const M_ACTIVE = gql`mutation ($tenantId: ID!, $active: Boolean!) { bmsSetTenantActive(tenantId: $tenantId, active: $active) }`;
const M_PLAN = gql`mutation ($tenantId: ID!, $planCode: String!) { bmsSetTenantPlan(tenantId: $tenantId, planCode: $planCode) }`;
const M_ENTER = gql`mutation ($tenantId: ID!) { bmsEnterTenant(tenantId: $tenantId) }`;
const M_DELETE = gql`mutation ($tenantId: ID!) { bmsDeleteTenant(tenantId: $tenantId) }`;

const baht = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;

export default function Page() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [setActive] = useMutation(M_ACTIVE, {
    onCompleted: () => { message.success(t("admin_tenants.active_update_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_tenants.active_update_error")),
  });
  const [setPlan] = useMutation(M_PLAN, {
    onCompleted: () => { message.success(t("admin_tenants.plan_update_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_tenants.plan_update_error")),
  });
  const [enterTenant, { loading: entering }] = useMutation(M_ENTER, {
    // reload ทั้งหน้าเพื่อให้ context (tenant) ใหม่มีผลกับทุกหน้า
    onCompleted: () => { window.location.href = "/admin/dashboard"; },
    onError: (e) => message.error(e?.message || t("admin_tenants.enter_error")),
  });
  const [deleteTenant, { loading: deleting }] = useMutation(M_DELETE, {
    onCompleted: () => { message.success(t("admin_tenants.delete_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_tenants.delete_error")),
  });

  if (error) return <Alert closable type="error" showIcon message={t("admin_tenants.load_error")} description={error.message} />;
  if (data && data.bmsIsPlatformAdmin === false) {
    return <Alert closable type="warning" showIcon message={t("admin_tenants.platform_admin_only_title")} description={t("admin_tenants.platform_admin_only_desc")} />;
  }

  const rows = data?.bmsTenants || [];
  const plans = data?.bmsBilling?.plans || [];
  const totalRevenue = rows.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);

  const columns = [
    {
      title: t("admin_tenants.col_shop"), dataIndex: "name", key: "name",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>/{r.slug}</span>
        </Space>
      ),
    },
    {
      title: t("admin_tenants.col_plan"), dataIndex: "plan", key: "plan", width: 160,
      render: (plan: string, r: any) => (
        <Select
          size="small" style={{ width: 140 }} value={plan}
          options={plans.map((p: any) => ({ value: p.code, label: p.name }))}
          onChange={(planCode) => setPlan({ variables: { tenantId: r.id, planCode } })}
        />
      ),
    },
    { title: t("admin_tenants.col_users"), dataIndex: "users", key: "users", width: 80, align: "right" as const },
    { title: t("admin_tenants.col_products"), dataIndex: "products", key: "products", width: 80, align: "right" as const },
    { title: t("admin_tenants.col_orders"), dataIndex: "orders", key: "orders", width: 90, align: "right" as const },
    {
      title: t("admin_tenants.col_revenue"), dataIndex: "revenue", key: "revenue", width: 130, align: "right" as const,
      render: (v: number) => baht(v),
    },
    {
      title: t("admin_tenants.col_status"), dataIndex: "active", key: "active", width: 120,
      render: (active: boolean, r: any) => (
        <Space>
          <Switch
            size="small" checked={active}
            onChange={(v) => setActive({ variables: { tenantId: r.id, active: v } })}
          />
          <Tag color={active ? "green" : "red"}>{active ? t("admin_tenants.status_on") : t("admin_tenants.status_off")}</Tag>
        </Space>
      ),
    },
    {
      title: t("admin_tenants.col_created_at"), dataIndex: "created_at", key: "created_at", width: 120,
      render: (v: string) => (v ? new Date(v).toLocaleDateString("th-TH") : "-"),
    },
    {
      title: "", key: "act", width: 180, fixed: "right" as const,
      render: (_: any, r: any) => {
        const isTestShop = typeof r.slug === "string" && r.slug.startsWith("test-");
        return (
          <Space>
            <Button size="small" icon={<LoginOutlined />} loading={entering}
              onClick={() => enterTenant({ variables: { tenantId: r.id } })}>
              {t("admin_tenants.enter")}
            </Button>
            {isTestShop && (
              <Popconfirm
                title={t("admin_tenants.delete_confirm_title")}
                description={t("admin_tenants.delete_confirm_desc")}
                okText={t("admin_tenants.delete_confirm_ok")} okButtonProps={{ danger: true }} cancelText={t("admin_tenants.delete_confirm_cancel")}
                onConfirm={() => deleteTenant({ variables: { tenantId: r.id } })}
              >
                <Button size="small" danger icon={<DeleteOutlined />} loading={deleting}>{t("admin_tenants.delete")}</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><ShopOutlined /> {t("admin_tenants.title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_tenants.refresh")}</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={t("admin_tenants.stat_tenant_count")} value={rows.length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={t("admin_tenants.stat_active_count")} value={rows.filter((r: any) => r.active).length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={t("admin_tenants.stat_total_revenue")} value={totalRevenue} suffix="฿" /></Card></Col>
      </Row>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_tenants.platform_notice")} />

      <Table
        rowKey="id" size="middle" loading={loading}
        dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
