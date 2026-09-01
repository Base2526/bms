'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Checkbox, Button, Space, Tag, message, Alert, Typography, Divider } from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, SaveOutlined, CrownOutlined } from "@ant-design/icons";
import { Q_MY_PERMS } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsPermissionCatalog
    bmsRolePermissions { id name is_super permissions }
  }
`;
const M_SET = gql`
  mutation ($roleId: ID!, $permissions: [String!]!) {
    bmsSetRolePermissions(roleId: $roleId, permissions: $permissions)
  }
`;

// จัดกลุ่ม permission ตาม resource เพื่อแสดงเป็นหมวด
function groupByResource(perms: string[]) {
  const g: Record<string, string[]> = {};
  perms.forEach((p) => {
    const parts = p.split(".");
    const res = parts[0] === "pharmacy" && parts.length >= 2
      ? `${parts[0]}.${parts[1]}`
      : parts[0];
    (g[res] ||= []).push(p);
  });
  return g;
}

function resourceLabels(t: (key: string) => string): Record<string, string> {
  return {
    product: t("admin_permissions.res_product"), stock: t("admin_permissions.res_stock"),
    order: t("admin_permissions.res_order"), customer: t("admin_permissions.res_customer"),
    report: t("admin_permissions.res_report"), purchase: t("admin_permissions.res_purchase"),
    payment: t("admin_permissions.res_payment"), shipping: t("admin_permissions.res_shipping"),
    inbox: t("admin_permissions.res_inbox"), ai_quality: t("admin_permissions.res_ai_quality"),
    coupon: t("admin_permissions.res_coupon"), followup: t("admin_permissions.res_followup"),
    restaurant: t("admin_permissions.res_restaurant"),
    support: t("admin_permissions.res_support"),
    "pharmacy.assessment": t("admin_permissions.res_pharmacy_assessment"),
    "pharmacy.protocol": t("admin_permissions.res_pharmacy_protocol"),
    "pharmacy.audit": t("admin_permissions.res_pharmacy_audit"),
  };
}

function permissionActionLabel(permission: string) {
  const parts = permission.split(".");
  if (parts[0] === "pharmacy") return parts.slice(2).join(".") || parts[1];
  return parts.slice(1).join(".") || permission;
}

export default function Page() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [setPerms] = useMutation(M_SET, {
    refetchQueries: [Q_MY_PERMS],
    awaitRefetchQueries: true,
    onCompleted: () => { message.success(t("admin_permissions.save_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_permissions.save_error")),
  });

  // draft state ต่อ role (แก้ก่อนกด save)
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (data?.bmsRolePermissions) {
      const d: Record<string, string[]> = {};
      data.bmsRolePermissions.forEach((r: any) => (d[r.id] = r.permissions));
      setDraft(d);
    }
  }, [data]);

  const resLabel = resourceLabels(t);

  if (error) return <Alert closable type="error" message={t("admin_permissions.load_error")} description={error.message} showIcon />;

  const catalog: string[] = data?.bmsPermissionCatalog || [];
  const groups = groupByResource(catalog);
  const roles = data?.bmsRolePermissions || [];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>{t("admin_permissions.title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_permissions.refresh")}</Button>
        </Space>
      </div>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={<>{t("admin_permissions.editing_tenant_prefix")} <b>{data?.bmsMyTenant?.name || "-"}</b> <Text code>{data?.bmsMyTenant?.slug || data?.bmsMyTenant?.id || "-"}</Text></>}
        description={t("admin_permissions.scope_notice")} />

      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {roles.map((role: any) => {
          const current = draft[role.id] || [];
          const dirty = JSON.stringify([...current].sort()) !== JSON.stringify([...role.permissions].sort());
          const setRole = (perms: string[]) => setDraft((d) => ({ ...d, [role.id]: perms }));
          const toggle = (perm: string, checked: boolean) =>
            setRole(checked ? [...current, perm] : current.filter((p) => p !== perm));

          return (
            <Card key={role.id} size="small"
              title={<Space>{role.name}{role.is_super && <Tag color="gold" icon={<CrownOutlined />}>{t("admin_permissions.super_role_tag")}</Tag>}</Space>}
              extra={
                !role.is_super && (
                  <Button type="primary" size="small" icon={<SaveOutlined />} disabled={!dirty}
                    onClick={() => setPerms({ variables: { roleId: role.id, permissions: current } })}>
                    {t("admin_permissions.save")}
                  </Button>
                )
              }
            >
              <Space wrap size={[24, 8]} align="start">
                {Object.entries(groups).map(([res, perms]) => (
                  <div key={res} style={{ minWidth: 160 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{resLabel[res] || res}</Text>
                    <div style={{ marginTop: 4 }}>
                      <Space direction="vertical" size={2}>
                        {perms.map((p) => (
                          <Checkbox key={p}
                            disabled={role.is_super}
                            checked={role.is_super || current.includes(p)}
                            onChange={(e) => toggle(p, e.target.checked)}>
                            {permissionActionLabel(p)}
                          </Checkbox>
                        ))}
                      </Space>
                    </div>
                  </div>
                ))}
              </Space>
            </Card>
          );
        })}
      </Space>

      <Divider />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("admin_permissions.footnote")}
      </Text>
    </div>
  );
}
