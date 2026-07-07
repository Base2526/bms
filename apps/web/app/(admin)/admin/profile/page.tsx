'use client';
import { gql, useQuery } from "@apollo/client";
import { Card, Descriptions, Avatar, Tag, Space, Alert, Button, Row, Col, Empty } from "antd";
import { UserOutlined, ReloadOutlined, CrownOutlined, ShopOutlined, SafetyOutlined } from "@ant-design/icons";

const Q = gql`
  query {
    bmsMe {
      id name username email phone avatar role language
      is_platform_admin created_at
      tenant { id name slug plan }
      permissions
    }
  }
`;

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-";

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });

  if (error) return <Alert type="error" showIcon message="โหลดโปรไฟล์ไม่ได้" description={error.message} />;

  const me = data?.bmsMe;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><UserOutlined /> โปรไฟล์ของฉัน</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {me && (
        <Row gutter={[16, 16]}>
          {/* บัตรผู้ใช้ */}
          <Col xs={24} md={8}>
            <Card>
              <Space direction="vertical" align="center" style={{ width: "100%" }} size={12}>
                <Avatar size={88} src={me.avatar || undefined} icon={<UserOutlined />} />
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{me.name || me.username || me.email}</div>
                  <div style={{ color: "var(--app-text-secondary, #888)" }}>{me.email}</div>
                </div>
                <Space wrap style={{ justifyContent: "center" }}>
                  <Tag color="blue" icon={<SafetyOutlined />}>{me.role}</Tag>
                  {me.is_platform_admin && (
                    <Tag color="gold" icon={<CrownOutlined />}>แอดมินแพลตฟอร์ม</Tag>
                  )}
                </Space>
              </Space>
            </Card>
          </Col>

          {/* รายละเอียด */}
          <Col xs={24} md={16}>
            <Card title="ข้อมูลบัญชี" style={{ marginBottom: 16 }}>
              <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                <Descriptions.Item label="ชื่อ">{me.name || "-"}</Descriptions.Item>
                <Descriptions.Item label="Username">{me.username || "-"}</Descriptions.Item>
                <Descriptions.Item label="อีเมล">{me.email || "-"}</Descriptions.Item>
                <Descriptions.Item label="เบอร์โทร">{me.phone || "-"}</Descriptions.Item>
                <Descriptions.Item label="Role">{me.role}</Descriptions.Item>
                <Descriptions.Item label="ภาษา">{me.language || "-"}</Descriptions.Item>
                <Descriptions.Item label="สมาชิกตั้งแต่" span={2}>{fmtDate(me.created_at)}</Descriptions.Item>
                <Descriptions.Item label="User ID" span={2}>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.id}</span>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title={<><ShopOutlined /> ร้านที่สังกัด</>} style={{ marginBottom: 16 }}>
              {me.tenant ? (
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                  <Descriptions.Item label="ชื่อร้าน">{me.tenant.name}</Descriptions.Item>
                  <Descriptions.Item label="Slug">/{me.tenant.slug}</Descriptions.Item>
                  <Descriptions.Item label="แพ็กเกจ"><Tag color="green">{me.tenant.plan}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Tenant ID">
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.tenant.id}</span>
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description="ไม่ได้สังกัดร้านใด" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>

            <Card title={<><SafetyOutlined /> สิทธิ์การใช้งาน ({me.permissions?.length || 0})</>}>
              {me.permissions?.length ? (
                <Space wrap size={[8, 8]}>
                  {me.permissions.map((p: string) => <Tag key={p}>{p}</Tag>)}
                </Space>
              ) : (
                <Empty description="ยังไม่มีสิทธิ์" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
