'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Alert, Table, Switch, Input, Typography, message, Popconfirm, Button } from "antd";
import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q = gql`
  query($search: String) {
    bmsPharmacyLicenseCandidates(search: $search) { id name email isLicensedPharmacist pharmacistLicenseNo }
  }
`;
const M_SET = gql`
  mutation($userId: ID!, $isLicensedPharmacist: Boolean!, $licenseNo: String, $confirmed: Boolean!) {
    bmsSetPharmacistLicense(userId: $userId, isLicensedPharmacist: $isLicensedPharmacist, licenseNo: $licenseNo, confirmed: $confirmed)
  }
`;

export default function PharmacistLicensesPage() {
  const { t } = useI18n();
  const { admin } = useSession();
  const isAdministrator = admin?.role === "Administrator";
  const [search, setSearch] = useState("");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: !isAdministrator, variables: { search }, fetchPolicy: "cache-and-network",
  });
  const [draftLicenseNo, setDraftLicenseNo] = useState<Record<string, string>>({});
  const [draftLicensed, setDraftLicensed] = useState<Record<string, boolean>>({});
  const [setLicense, { loading: saving }] = useMutation(M_SET, {
    onCompleted: () => {
      message.success(t("admin_pharmacist_licenses.save_success"));
      setDraftLicenseNo({}); setDraftLicensed({}); refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_pharmacist_licenses.save_error")),
  });

  if (!isAdministrator) {
    return (
      <Alert closable
        type="warning"
        showIcon
        message={t("admin_pharmacist_licenses.administrator_only")}
      />
    );
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_pharmacist_licenses.load_error")} description={error.message} />;

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
          maxLength={100}
          value={draftLicenseNo[row.id] ?? row.pharmacistLicenseNo ?? ""}
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
          checked={draftLicensed[row.id] ?? row.isLicensedPharmacist}
          loading={saving}
          onChange={(checked) => setDraftLicensed((prev) => ({ ...prev, [row.id]: checked }))}
        />
      ),
    },
    {
      title: t("admin_pharmacist_licenses.col_action"), key: "action",
      render: (_: unknown, row: any) => {
        const licensed = draftLicensed[row.id] ?? row.isLicensedPharmacist;
        const licenseNo = draftLicenseNo[row.id] ?? row.pharmacistLicenseNo ?? "";
        const changed = licensed !== row.isLicensedPharmacist || licenseNo.trim() !== (row.pharmacistLicenseNo ?? "");
        return (
          <Popconfirm
            title={t("admin_pharmacist_licenses.confirm_title")}
            description={`${row.name} · ${licensed ? t("admin_pharmacist_licenses.status_licensed") : t("admin_pharmacist_licenses.status_unlicensed")} · ${licenseNo.trim() || "—"}`}
            onConfirm={() => setLicense({ variables: {
              userId: row.id, isLicensedPharmacist: licensed,
              licenseNo: licenseNo.trim() || null, confirmed: true,
            } })}
          >
            <Button disabled={!changed || saving}>{t("admin_pharmacist_licenses.btn_save")}</Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_pharmacist_licenses.title")}</Typography.Title>} />
      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacist_licenses.enforcement_notice")}
      />
      <Input.Search
        aria-label={t("admin_pharmacist_licenses.search_placeholder")}
        placeholder={t("admin_pharmacist_licenses.search_placeholder")}
        onSearch={(value) => setSearch(value.trim())}
        onChange={(event) => { if (!event.target.value) setSearch(""); }}
        allowClear
        style={{ maxWidth: 360, marginBottom: 12 }}
      />
      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
    </div>
  );
}
