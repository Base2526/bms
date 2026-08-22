'use client';
import { gql, useMutation, useQuery } from "@apollo/client";
import { Card, Form, Input, Select, Button, message, Alert } from "antd";
import React from "react";
import { useI18n } from "@/lib/i18nContext";
import { assignableStaffRoles } from "@/lib/bms/staffRoles";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const M_UPSERT = gql`
mutation($data:UserInput!){
  upsertUser(data:$data){ id }
}
`;

// role ต้องดึงจาก DB จริง (ไม่ hardcode) — มี Administrator/Manager/Sales/Warehouse/Subscriber ฯลฯ
// ตรงกับที่หน้า Edit User ใช้อยู่แล้ว (เดิมหน้านี้ hardcode ค้างจาก project เก่า ทำให้ role ไม่ครบ)
const Q_ROLES = gql`
query { roles { id name is_active } }
`;

const Q_ME = gql`query { bmsMe { id role is_platform_admin } }`;

function FormNew(){
  const { t } = useI18n();
  const [form] = Form.useForm();
  const watchName = Form.useWatch('name', form);   // 👈 debug helper
  const watchEmail = Form.useWatch('email', form); // 👈 debug helper

  const { data: rolesData, loading: rolesLoading, error: rolesError } = useQuery(Q_ROLES);
  const allRoles: { id: string; name: string; is_active?: boolean }[] =
    (rolesData?.roles || []).filter((r: { is_active?: boolean }) => r.is_active !== false);

  // กำหนดได้เฉพาะบทบาทที่ต่ำกว่าตัวเอง (Administrator เห็นทุกบทบาทเหมือนเดิม)
  // ⚠️ ซ่อนตัวเลือกเป็นแค่ UX — ตัวบังคับจริงคือ resolveAssignableRole() ฝั่ง server
  const { data: meData } = useQuery(Q_ME);
  const myRole: string | undefined = meData?.bmsMe?.role;
  const isPlatformAdmin = meData?.bmsMe?.is_platform_admin === true;
  const { can } = useBmsPermissions();
  const canWrite = isPlatformAdmin || myRole === "Administrator" || can("user.manage");
  const assignable = React.useMemo(
    () => new Set(assignableStaffRoles(myRole, allRoles.map((r) => r.name))),
    [myRole, allRoles]
  );
  const roles = myRole ? allRoles.filter((r) => assignable.has(r.name)) : allRoles;
  const noAssignableRoles = Boolean(myRole) && !rolesLoading && roles.length === 0;
  const readOnly = Boolean(meData) && !canWrite;

  const [save,{loading}] = useMutation(M_UPSERT,{
    onCompleted:()=>{ message.success(t("admin_users_new.create_success")); window.location.href='/admin/users'; },
    // server ปฏิเสธได้จริง (บทบาทที่ assign ไม่ได้ / โควตาเต็ม) — ต้องโชว์เหตุผล
    // ใส่ onError แล้ว Apollo จะไม่ reject promise ทิ้งเป็น unhandled rejection
    onError:(e)=>{ message.error(e.message); },
  });

  const onFinish = async (v:any) => {
    const pwd: string = typeof v.password === 'string' ? v.password : '';
    const pwd2: string = typeof v.confirmPassword === 'string' ? v.confirmPassword : '';
    if (!pwd) { message.error(t("admin_users_new.password_required_toast")); return; }
    if (pwd !== pwd2) { message.error(t("admin_users_new.password_mismatch_toast")); return; }
    await save({ variables:{
      data: {
        name: v.name,
        email: v.email,
        phone: v.phone || null,
        avatar: v.avatar || null,
        role_id: v.role_id,
        password: pwd
      }
    }});
  };

  const onFinishFailed = (info:any) => {
    console.warn('[onFinishFailed]', info.errorFields);
    message.error(t("admin_users_new.fill_required_fields"));
  };

  return (
    <Card title={t("admin_users_new.title")} style={{maxWidth:640}}>
      {readOnly && (
        <Alert
          type="warning"
          showIcon
          message={t("admin_users_new.read_only_title")}
          description={t("admin_users_new.read_only_desc")}
          style={{ marginBottom: 16 }}
        />
      )}
      {/* สำคัญ: ไม่มี <form> ซ้อนทับ, ปุ่ม submit อยู่ "ใน" Form, ใช้ htmlType="submit" */}
      <Form
        name="user_new"
        form={form}
        layout="vertical"
        autoComplete="off"
        disabled={readOnly}
        onFinish={onFinish}
        onFinishFailed={onFinishFailed}
      >
        <Form.Item name="name" label={t("admin_users_new.name_label")} rules={[{ required: true, message: t("admin_users_new.name_required") }]}>
          <Input placeholder={t("admin_users_new.name_placeholder")} />
        </Form.Item>

        <Form.Item name="email" label={t("admin_users_new.email_label")} rules={[{ required: true, message: t("admin_users_new.email_required") }, { type: 'email', message: t("admin_users_new.email_invalid") }]}>
          <Input placeholder={t("admin_users_new.email_placeholder")} />
        </Form.Item>

        <Form.Item name="phone" label={t("admin_users_new.phone_label")}><Input /></Form.Item>
        <Form.Item name="avatar" label={t("admin_users_new.avatar_label")}><Input /></Form.Item>

        {rolesError && <Alert type="error" showIcon message={t("admin_users_new.roles_load_error")} description={rolesError.message} style={{ marginBottom: 16 }} />}
        {noAssignableRoles && <Alert type="warning" showIcon message={t("admin_users_new.no_assignable_roles")} style={{ marginBottom: 16 }} />}
        <Form.Item name="role_id" label={t("admin_users_new.role_label")} rules={[{ required: true, message: t("admin_users_new.role_required") }]}>
          <Select
            loading={rolesLoading}
            placeholder={t("admin_users_new.role_placeholder")}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Form.Item>

        {/* Password + Confirm */}
        <Form.Item
          name="password"
          label={t("admin_users_new.password_label")}
          rules={[{ required:true, message: t("admin_users_new.password_required") }, { min:8, message: t("admin_users_new.password_min_length") }]}
          hasFeedback
        >
          <Input.Password placeholder={t("admin_users_new.password_placeholder")}/>
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label={t("admin_users_new.confirm_password_label")}
          dependencies={['password']}
          hasFeedback
          rules={[
            { required:true, message: t("admin_users_new.confirm_password_required") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error(t("admin_users_new.confirm_password_mismatch")));
              },
            }),
          ]}
        >
          <Input.Password placeholder={t("admin_users_new.confirm_password_placeholder")}/>
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={loading} disabled={readOnly || noAssignableRoles}>{t("admin_users_new.submit")}</Button>
      </Form>

      {/* debug ดูค่าในฟอร์ม */}
      <pre style={{marginTop:16, opacity:.6}}>
        name: {String(watchName || '')} | email: {String(watchEmail || '')}
      </pre>
    </Card>
  );
}

export default function Page(){
  return <FormNew/>;
}
