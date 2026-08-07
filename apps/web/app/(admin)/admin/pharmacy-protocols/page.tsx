'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Alert, Table, Tag, Typography, Switch, message } from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q = gql`
  query {
    bmsPharmacyProtocols {
      id protocolKey name version supportedSymptomGroup status clinicallyApproved enabled reviewedBy reviewedAt
    }
  }
`;
const M_SET_ENABLED = gql`
  mutation($id: ID!, $enabled: Boolean!) { bmsSetPharmacyProtocolEnabled(id: $id, enabled: $enabled) { id enabled } }
`;

export default function PharmacyProtocolsPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("pharmacy.protocol.manage");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("pharmacy.assessment.read"),
    fetchPolicy: "cache-and-network",
  });
  const [setEnabled] = useMutation(M_SET_ENABLED, {
    onCompleted: () => { message.success("บันทึกแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
  });

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลด protocol ไม่ได้" description={error.message} />;

  const rows = data?.bmsPharmacyProtocols || [];
  const columns = [
    { title: "Protocol", dataIndex: "name", key: "name" },
    { title: "Key", dataIndex: "protocolKey", key: "protocolKey" },
    { title: "Version", dataIndex: "version", key: "version" },
    { title: "Symptom group", dataIndex: "supportedSymptomGroup", key: "supportedSymptomGroup" },
    {
      title: "การรับรองทางคลินิก",
      dataIndex: "clinicallyApproved",
      key: "clinicallyApproved",
      render: (v: boolean) => (v ? <Tag color="green">ผ่านการรับรองแล้ว</Tag> : <Tag color="red">DRAFT — ยังไม่ผ่านการรับรอง</Tag>),
    },
    {
      title: "เปิดใช้งาน",
      dataIndex: "enabled",
      key: "enabled",
      render: (v: boolean, row: any) => (
        <Switch
          checked={v}
          disabled={!canManage}
          onChange={(checked) => setEnabled({ variables: { id: row.id, enabled: checked } })}
        />
      ),
    },
    { title: "ผู้ตรวจล่าสุด", dataIndex: "reviewedBy", key: "reviewedBy", render: (v: string | null) => v || "—" },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>AI Pharmacy Intake — Protocols</Typography.Title>} />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Protocol ทั้งหมดในรอบนี้เป็นข้อมูลตัวอย่างสำหรับการพัฒนาเท่านั้น (DRAFT / NOT CLINICALLY APPROVED) — ห้ามเปิดใช้งานจริงจนกว่าเภสัชกรจะตรวจสอบและอนุมัติ"
      />
      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
    </div>
  );
}
