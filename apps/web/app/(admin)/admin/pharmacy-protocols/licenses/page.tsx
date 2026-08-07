'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Alert, Table, Switch, Input, Typography, message, Space } from "antd";
import { useState } from "react";
import { useSession } from "@/lib/useSession";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q = gql`
  query {
    bmsPharmacyLicenseCandidates { id name email isLicensedPharmacist pharmacistLicenseNo }
  }
`;
const M_SET = gql`
  mutation($userId: ID!, $isLicensedPharmacist: Boolean!, $licenseNo: String) {
    bmsSetPharmacistLicense(userId: $userId, isLicensedPharmacist: $isLicensedPharmacist, licenseNo: $licenseNo)
  }
`;

export default function PharmacistLicensesPage() {
  const { admin } = useSession();
  const isAdministrator = admin?.role === "Administrator";
  const { data, loading, error, refetch } = useQuery(Q, { skip: !isAdministrator, fetchPolicy: "cache-and-network" });
  const [draftLicenseNo, setDraftLicenseNo] = useState<Record<string, string>>({});
  const [setLicense, { loading: saving }] = useMutation(M_SET, {
    onCompleted: () => { message.success("บันทึกแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
  });

  if (!isAdministrator) {
    return (
      <Alert
        type="warning"
        showIcon
        message="เฉพาะ Administrator เท่านั้นที่กำหนดสถานะเภสัชกร (users.is_licensed_pharmacist) ได้"
      />
    );
  }
  if (error) return <Alert type="error" showIcon message="โหลดรายชื่อผู้ใช้ไม่ได้" description={error.message} />;

  const rows = data?.bmsPharmacyLicenseCandidates || [];
  const columns = [
    { title: "ชื่อ", dataIndex: "name", key: "name" },
    { title: "อีเมล", dataIndex: "email", key: "email", render: (v: string | null) => v || "—" },
    {
      title: "เลขที่ใบประกอบวิชาชีพ",
      key: "licenseNo",
      render: (_: unknown, row: any) => (
        <Input
          size="small"
          style={{ width: 200 }}
          defaultValue={row.pharmacistLicenseNo || ""}
          placeholder="ไม่บังคับ"
          onChange={(e) => setDraftLicenseNo((prev) => ({ ...prev, [row.id]: e.target.value }))}
        />
      ),
    },
    {
      title: "เภสัชกรที่มีใบประกอบวิชาชีพ",
      key: "isLicensedPharmacist",
      render: (_: unknown, row: any) => (
        <Switch
          checked={row.isLicensedPharmacist}
          loading={saving}
          onChange={(checked) =>
            setLicense({
              variables: {
                userId: row.id,
                isLicensedPharmacist: checked,
                licenseNo: draftLicenseNo[row.id] ?? row.pharmacistLicenseNo ?? null,
              },
            })
          }
        />
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>เภสัชกรที่มีใบประกอบวิชาชีพ</Typography.Title>} />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="ค่านี้เป็นตัวบังคับจริงที่ server สำหรับการอนุมัติ/ปฏิเสธ/ส่งต่อแพทย์ใน AI Pharmacy Intake — ไม่ขึ้นกับ role หรือสิทธิ์อื่นใด แม้ Administrator เองก็อนุมัติเคสไม่ได้ถ้ายังไม่เปิดสวิตช์นี้"
      />
      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
    </div>
  );
}
