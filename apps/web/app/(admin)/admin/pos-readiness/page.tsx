'use client';
// หน้าเช็คความพร้อมก่อนเปิดขายหน้าร้าน
// -------------------------------------------------------------
// ร้านยาเลือกแนวทาง "รีวิว policy ให้ครบทุกสินค้าก่อนเปิดร้าน" → openPosShift()
// จะบล็อกจนกว่าจะครบ หน้านี้คือที่ที่ตอบว่า "เหลืออีกกี่ตัว" ก่อนจะไปเจอ
// PHARMACY_POLICY_UNKNOWN ตอนมีลูกค้ายืนรออยู่หน้าเคาน์เตอร์
//
// การแก้ policy รายตัวยังอยู่ที่ /admin/pharmacy-protocols (มี editor ครบอยู่แล้ว)
// หน้านี้ตั้งใจไม่ทำซ้ำ — ทำหน้าที่เป็นตัวนับถอยหลังกับรายการงานที่เหลือ
import { gql, useQuery } from "@apollo/client";
import { Alert, Card, Empty, Progress, Space, Statistic, Table, Tag, Typography } from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q_READINESS = gql`
  query PosReadiness {
    bmsPharmacyPolicyReadiness {
      pharmacyArchetype
      totalProducts
      approved
      pendingReview
      draft
      missing
      ready
    }
    bmsProductsNeedingPolicyReview(limit: 200) {
      sku
      name
      policyStatus
    }
    bmsExpiringLots(withinDays: 90) {
      id
      productSku
      size
      lotNo
      expiryDate
      qty
    }
    bmsLotReconcile {
      productSku
      size
      currentStock
      lotTotal
    }
  }
`;

const POLICY_LABEL: Record<string, { text: string; color: string }> = {
  MISSING: { text: "ยังไม่เริ่ม", color: "red" },
  DRAFT: { text: "ร่าง", color: "orange" },
  PENDING_REVIEW: { text: "รอเภสัชกรตรวจ", color: "blue" },
  RETIRED: { text: "เลิกใช้", color: "default" },
};

export default function PosReadinessPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canRead = can("pharmacy.policy.read");
  const { data, loading } = useQuery(Q_READINESS, {
    fetchPolicy: "cache-and-network",
    skip: !canRead,
  });

  if (!permsLoading && !canRead) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี pharmacy.policy.read)" />;
  }

  const readiness = data?.bmsPharmacyPolicyReadiness;
  const pending = data?.bmsProductsNeedingPolicyReview ?? [];
  const expiring = data?.bmsExpiringLots ?? [];
  const mismatches = data?.bmsLotReconcile ?? [];

  const total = readiness?.totalProducts ?? 0;
  const approved = readiness?.approved ?? 0;
  const percent = total === 0 ? 100 : Math.round((approved / total) * 100);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="ความพร้อมก่อนเปิดขายหน้าร้าน" />

      {readiness && !readiness.pharmacyArchetype && (
        <Alert
          type="info"
          showIcon
          message="ร้านนี้ไม่ได้ตั้งเป็นร้านยา"
          description="กฎการขายยาไม่ถูกบังคับใช้ และไม่มีการบล็อกการเปิดกะจากเรื่อง policy สินค้า"
        />
      )}

      {readiness?.pharmacyArchetype && (
        <Card>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {readiness.ready ? (
              <Alert type="success" showIcon message="รีวิวครบแล้ว เปิดกะขายได้" />
            ) : (
              <Alert
                type="warning"
                showIcon
                message={`ยังเปิดกะไม่ได้ — เหลืออีก ${total - approved} รายการ`}
                description="เภสัชกรต้องอนุมัตินโยบายการขายให้ครบทุกสินค้าที่ยังใช้งานอยู่ก่อน มิฉะนั้นสินค้าที่ยังไม่ผ่านจะขายไม่ได้กลางคิวลูกค้า"
              />
            )}
            <Progress percent={percent} status={readiness.ready ? "success" : "active"} />
            <Space size="large" wrap>
              <Statistic title="สินค้าทั้งหมด" value={total} />
              <Statistic title="อนุมัติแล้ว" value={approved} valueStyle={{ color: "#3f8600" }} />
              <Statistic title="ยังไม่เริ่ม" value={readiness.missing} valueStyle={{ color: "#cf1322" }} />
              <Statistic title="ร่าง" value={readiness.draft} />
              <Statistic title="รอตรวจ" value={readiness.pendingReview} />
            </Space>
          </Space>
        </Card>
      )}

      <Card title="สินค้าที่ยังรอเภสัชกร" loading={loading}>
        {pending.length === 0 ? (
          <Empty description="ไม่มีรายการค้าง" />
        ) : (
          <Table
            size="small"
            rowKey="sku"
            dataSource={pending}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 160 },
              { title: "ชื่อสินค้า", dataIndex: "name" },
              {
                title: "สถานะ",
                dataIndex: "policyStatus",
                width: 160,
                render: (v: string) => {
                  const meta = POLICY_LABEL[v] ?? { text: v, color: "default" };
                  return <Tag color={meta.color}>{meta.text}</Tag>;
                },
              },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          แก้ไขและอนุมัติได้ที่ <a href="/admin/pharmacy-protocols">นโยบายการขายรายสินค้า</a>
        </Typography.Paragraph>
      </Card>

      <Card title="lot ที่หมดอายุแล้ว / จะหมดใน 90 วัน" loading={loading}>
        {expiring.length === 0 ? (
          <Empty description="ไม่มี lot ใกล้หมดอายุ" />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={expiring}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "productSku", width: 160 },
              { title: "ไซซ์", dataIndex: "size", width: 80 },
              { title: "lot", dataIndex: "lotNo", width: 140 },
              {
                title: "วันหมดอายุ",
                dataIndex: "expiryDate",
                width: 140,
                render: (v: string) =>
                  v && v < today ? <Tag color="red">{v} (หมดแล้ว)</Tag> : <Tag color="orange">{v}</Tag>,
              },
              { title: "คงเหลือ", dataIndex: "qty", width: 100 },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          lot ที่หมดอายุแล้วจะถูกข้ามอัตโนมัติตอนขาย (FEFO) — แต่ยังนับอยู่ในสต็อกรวมจนกว่าจะตัดออก
        </Typography.Paragraph>
      </Card>

      <Card title="ยอด lot ไม่ตรงกับสต็อกรวม" loading={loading}>
        {mismatches.length === 0 ? (
          <Empty description="ตรงกันทุกแถว" />
        ) : (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="สินค้าที่ยังไม่ได้บันทึก lot จะขึ้นที่นี่"
              description="ถ้ายังไม่เคย backfill lot ให้ของเดิม รายการนี้จะยาวเป็นปกติ · หลัง backfill ครบแล้วรายการนี้ควรว่าง ถ้ายังมีแปลว่ามีที่ไหนเขียนสต็อกโดยไม่ผ่าน lot"
            />
            <Table
              size="small"
              rowKey={(r: any) => `${r.productSku}__${r.size}`}
              dataSource={mismatches}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: "SKU", dataIndex: "productSku", width: 160 },
                { title: "ไซซ์", dataIndex: "size", width: 80 },
                { title: "สต็อกรวม", dataIndex: "currentStock", width: 120 },
                { title: "รวมจาก lot", dataIndex: "lotTotal", width: 120 },
                {
                  title: "ต่าง",
                  width: 100,
                  render: (_: unknown, r: any) => (
                    <Tag color="red">{r.currentStock - r.lotTotal}</Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </Space>
  );
}
