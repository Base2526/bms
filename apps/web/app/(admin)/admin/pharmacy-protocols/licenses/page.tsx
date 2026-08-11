'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Alert, Table, Switch, Input, Typography, message, Space } from "antd";
import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { useI18n } from "@/lib/i18nContext";
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
  const { t } = useI18n();
  const { admin } = useSession();
  const isAdministrator = admin?.role === "Administrator";
  const { data, loading, error, refetch } = useQuery(Q, { skip: !isAdministrator, fetchPolicy: "cache-and-network" });
  const [draftLicenseNo, setDraftLicenseNo] = useState<Record<string, string>>({});
  const [setLicense, { loading: saving }] = useMutation(M_SET, {
    onCompleted: () => { message.success(t("admin_pharmacist_licenses.save_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_pharmacist_licenses.save_error")),
  });

  if (!isAdministrator) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t("admin_pharmacist_licenses.administrator_only")}
      />
    );
  }
  if (error) return <Alert type="error" showIcon message={t("admin_pharmacist_licenses.load_error")} description={error.message} />;

  const rows = data?.bmsPharmacyLicenseCandidates || [];
  const columns = [
    { title: t("admin_pharmacist_licenses.col_name"), dataIndex: "name", key: "name" },
    { title: t("admin_pharmacist_licenses.col_email"), dataIndex: "email", key: "email", render: (v: string | null) => v || "—" },
    {
      title: t("admin_pharmacist_licenses.col_license_no"),
      key: "licenseNo",
      render: (_: unknown, row: any) => (
        <Input
          size="small"
          style={{ width: 200 }}
          defaultValue={row.pharmacistLicenseNo || ""}
          placeholder={t("admin_pharmacist_licenses.license_no_placeholder")}
          onChange={(e) => setDraftLicenseNo((prev) => ({ ...prev, [row.id]: e.target.value }))}
        />
      ),
    },
    {
      title: t("admin_pharmacist_licenses.col_is_licensed"),
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
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_pharmacist_licenses.title")}</Typography.Title>} />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacist_licenses.enforcement_notice")}
      />
      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
    </div>
  );
}
