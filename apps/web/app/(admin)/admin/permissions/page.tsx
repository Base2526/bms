'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Checkbox, Button, Space, Tag, message, Alert, Typography, Divider } from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, SaveOutlined, CrownOutlined } from "@ant-design/icons";
import { Q_MY_PERMS } from "@/app/hooks/useBmsPermissions";

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

const RES_LABEL: Record<string, string> = {
  product: "สินค้า", stock: "สต็อก", order: "ออเดอร์", customer: "ลูกค้า", report: "รายงาน",
  purchase: "purchase",
  payment: "payment",
  shipping: "shipping",
  inbox: "inbox",
  ai_quality: "ai_quality",
  coupon: "coupon",
  followup: "followup",
  "pharmacy.assessment": "pharmacy assessment",
  "pharmacy.protocol": "pharmacy protocol",
  "pharmacy.audit": "pharmacy audit",
};

function permissionActionLabel(permission: string) {
  const parts = permission.split(".");
  if (parts[0] === "pharmacy") return parts.slice(2).join(".") || parts[1];
  return parts.slice(1).join(".") || permission;
}

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [setPerms] = useMutation(M_SET, {
    refetchQueries: [Q_MY_PERMS],
    awaitRefetchQueries: true,
    onCompleted: () => { message.success("บันทึกสิทธิ์แล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
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

  if (error) return <Alert type="error" message="โหลดสิทธิ์ไม่ได้" description={error.message} showIcon />;

  const catalog: string[] = data?.bmsPermissionCatalog || [];
  const groups = groupByResource(catalog);
  const roles = data?.bmsRolePermissions || [];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Permissions (RBAC)</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={<>กำลังแก้สิทธิ์ของร้าน <b>{data?.bmsMyTenant?.name || "-"}</b> <Text code>{data?.bmsMyTenant?.slug || data?.bmsMyTenant?.id || "-"}</Text></>}
        description="สิทธิ์แยกต่อร้าน การเปลี่ยนมีผลเฉพาะผู้ใช้ในร้านนี้ทันที หากต้องการแก้ร้านอื่น ให้เข้ามุมมองของร้านนั้นก่อนบันทึก — Administrator ได้ทุกสิทธิ์เสมอ" />

      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {roles.map((role: any) => {
          const current = draft[role.id] || [];
          const dirty = JSON.stringify([...current].sort()) !== JSON.stringify([...role.permissions].sort());
          const setRole = (perms: string[]) => setDraft((d) => ({ ...d, [role.id]: perms }));
          const toggle = (perm: string, checked: boolean) =>
            setRole(checked ? [...current, perm] : current.filter((p) => p !== perm));

          return (
            <Card key={role.id} size="small"
              title={<Space>{role.name}{role.is_super && <Tag color="gold" icon={<CrownOutlined />}>super — ได้ทุกสิทธิ์</Tag>}</Space>}
              extra={
                !role.is_super && (
                  <Button type="primary" size="small" icon={<SaveOutlined />} disabled={!dirty}
                    onClick={() => setPerms({ variables: { roleId: role.id, permissions: current } })}>
                    บันทึก
                  </Button>
                )
              }
            >
              <Space wrap size={[24, 8]} align="start">
                {Object.entries(groups).map(([res, perms]) => (
                  <div key={res} style={{ minWidth: 160 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{RES_LABEL[res] || res}</Text>
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
        * สิทธิ์เหล่านี้ถูกบังคับใช้จริงในทุก BMS API (Products/Orders/Customers/Dashboard) — role ที่ไม่มีสิทธิ์จะโดนปฏิเสธ (403) และปุ่มในหน้าที่เกี่ยวข้องจะถูกซ่อน
      </Text>
    </div>
  );
}
