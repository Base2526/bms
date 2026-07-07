'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Switch, Select, Button, Space, Alert, message, Statistic, Row, Col, Card } from "antd";
import { ReloadOutlined, ShopOutlined, LoginOutlined } from "@ant-design/icons";

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

const baht = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [setActive] = useMutation(M_ACTIVE, {
    onCompleted: () => { message.success("อัปเดตสถานะร้านแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "อัปเดตไม่สำเร็จ"),
  });
  const [setPlan] = useMutation(M_PLAN, {
    onCompleted: () => { message.success("เปลี่ยนแพ็กเกจร้านแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "เปลี่ยนแพ็กเกจไม่สำเร็จ"),
  });
  const [enterTenant, { loading: entering }] = useMutation(M_ENTER, {
    // reload ทั้งหน้าเพื่อให้ context (tenant) ใหม่มีผลกับทุกหน้า
    onCompleted: () => { window.location.href = "/admin/dashboard"; },
    onError: (e) => message.error(e?.message || "เข้าดูร้านไม่สำเร็จ"),
  });

  if (error) return <Alert type="error" showIcon message="โหลดรายการร้านไม่ได้" description={error.message} />;
  if (data && data.bmsIsPlatformAdmin === false) {
    return <Alert type="warning" showIcon message="เฉพาะแอดมินแพลตฟอร์ม" description="บัญชีนี้ไม่มีสิทธิ์ดูรายการร้านทั้งหมด" />;
  }

  const rows = data?.bmsTenants || [];
  const plans = data?.bmsBilling?.plans || [];
  const totalRevenue = rows.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);

  const columns = [
    {
      title: "ร้าน", dataIndex: "name", key: "name",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ color: "var(--app-text-secondary, #888)", fontSize: 12 }}>/{r.slug}</span>
        </Space>
      ),
    },
    {
      title: "แพ็กเกจ", dataIndex: "plan", key: "plan", width: 160,
      render: (plan: string, r: any) => (
        <Select
          size="small" style={{ width: 140 }} value={plan}
          options={plans.map((p: any) => ({ value: p.code, label: p.name }))}
          onChange={(planCode) => setPlan({ variables: { tenantId: r.id, planCode } })}
        />
      ),
    },
    { title: "ผู้ใช้", dataIndex: "users", key: "users", width: 80, align: "right" as const },
    { title: "สินค้า", dataIndex: "products", key: "products", width: 80, align: "right" as const },
    { title: "ออเดอร์", dataIndex: "orders", key: "orders", width: 90, align: "right" as const },
    {
      title: "ยอดขาย", dataIndex: "revenue", key: "revenue", width: 130, align: "right" as const,
      render: (v: number) => baht(v),
    },
    {
      title: "สถานะ", dataIndex: "active", key: "active", width: 120,
      render: (active: boolean, r: any) => (
        <Space>
          <Switch
            size="small" checked={active}
            onChange={(v) => setActive({ variables: { tenantId: r.id, active: v } })}
          />
          <Tag color={active ? "green" : "red"}>{active ? "เปิด" : "ปิด"}</Tag>
        </Space>
      ),
    },
    {
      title: "สร้างเมื่อ", dataIndex: "created_at", key: "created_at", width: 120,
      render: (v: string) => (v ? new Date(v).toLocaleDateString("th-TH") : "-"),
    },
    {
      title: "", key: "act", width: 110, fixed: "right" as const,
      render: (_: any, r: any) => (
        <Button size="small" icon={<LoginOutlined />} loading={entering}
          onClick={() => enterTenant({ variables: { tenantId: r.id } })}>
          เข้าดู
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><ShopOutlined /> ร้านค้าทั้งหมด</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="จำนวนร้าน" value={rows.length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="ร้านที่เปิดใช้งาน" value={rows.filter((r: any) => r.active).length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="ยอดขายรวมทุกร้าน" value={totalRevenue} suffix="฿" /></Card></Col>
      </Row>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="มุมมองแอดมินแพลตฟอร์ม — ปิดร้านคือระงับการใช้งาน · เปลี่ยนแพ็กเกจมีผลกับ quota ของร้านนั้นทันที · ทุกการเปลี่ยนถูกบันทึกใน Audit log" />

      <Table
        rowKey="id" size="middle" loading={loading}
        dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
