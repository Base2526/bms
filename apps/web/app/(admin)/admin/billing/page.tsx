'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Row, Col, Button, Tag, Progress, message, Alert, Typography, Space } from "antd";
import { CheckOutlined, ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

const Q = gql`
  query {
    bmsBilling {
      plan { code name price_monthly max_products max_channels max_orders_month max_users }
      usage { products channels orders_month users }
      plans { code name price_monthly max_products max_channels max_orders_month max_users }
    }
  }
`;
const M = gql`mutation ($planCode: String!) { bmsChangePlan(planCode: $planCode) }`;

const lim = (v: number) => (v < 0 ? "ไม่จำกัด" : v);
const pct = (used: number, max: number) => (max < 0 ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100)));

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [changePlan, { loading: changing }] = useMutation(M, {
    onCompleted: () => { message.success("เปลี่ยนแพ็กเกจแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "เปลี่ยนแพ็กเกจไม่สำเร็จ"),
  });

  if (error) return <Alert type="error" message="โหลด billing ไม่ได้" description={error.message} showIcon />;

  const b = data?.bmsBilling;
  const cur = b?.plan;
  const usage = b?.usage;
  const plans = b?.plans || [];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Billing & Plan</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {cur && usage && (
        <Card style={{ marginBottom: 16 }} title={<>แพ็กเกจปัจจุบัน: <Tag color="blue">{cur.name}</Tag>{cur.price_monthly > 0 ? `${cur.price_monthly.toLocaleString()} ฿/เดือน` : "ฟรี"}</>}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Text type="secondary">สินค้า</Text>
              <Progress percent={pct(usage.products, cur.max_products)} format={() => `${usage.products}/${lim(cur.max_products)}`} status={cur.max_products>=0 && usage.products>=cur.max_products ? "exception":"active"} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">ช่องทางที่เชื่อม</Text>
              <Progress percent={pct(usage.channels, cur.max_channels)} format={() => `${usage.channels}/${lim(cur.max_channels)}`} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">ออเดอร์เดือนนี้</Text>
              <Progress percent={pct(usage.orders_month, cur.max_orders_month)} format={() => `${usage.orders_month}/${lim(cur.max_orders_month)}`} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">Staff</Text>
              <Progress percent={pct(usage.users, cur.max_users)} format={() => `${usage.users}/${lim(cur.max_users)}`} status={cur.max_users>=0 && usage.users>=cur.max_users ? "exception":"active"} />
            </Col>
          </Row>
        </Card>
      )}

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="เลือกแพ็กเกจ (โหมดสาธิต — ยังไม่ตัดเงินจริง) · quota สินค้าถูกบังคับใช้จริงตอนสร้างสินค้าใหม่" />

      <Row gutter={[16, 16]}>
        {plans.map((p: any) => {
          const isCurrent = p.code === cur?.code;
          return (
            <Col xs={24} md={8} key={p.code}>
              <Card
                title={p.name}
                style={{ borderColor: isCurrent ? "#1677ff" : undefined, borderWidth: isCurrent ? 2 : 1 }}
                extra={isCurrent && <Tag color="blue">ใช้อยู่</Tag>}
              >
                <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
                  {p.price_monthly > 0 ? <>{p.price_monthly.toLocaleString()} <Text type="secondary" style={{ fontSize: 14 }}>฿/เดือน</Text></> : "ฟรี"}
                </div>
                <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> สินค้า {lim(p.max_products)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> ช่องทาง {lim(p.max_channels)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> ออเดอร์/เดือน {lim(p.max_orders_month)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> Staff {lim(p.max_users)}</div>
                </Space>
                <Button type={isCurrent ? "default" : "primary"} block disabled={isCurrent || changing}
                  onClick={() => changePlan({ variables: { planCode: p.code } })}>
                  {isCurrent ? "แพ็กเกจปัจจุบัน" : "เลือกแพ็กเกจนี้"}
                </Button>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
