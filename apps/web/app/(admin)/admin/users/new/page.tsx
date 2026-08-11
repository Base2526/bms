'use client';
import { gql, useMutation, useQuery } from "@apollo/client";
import { Card, Form, Input, Select, Button, message, Alert } from "antd";
import React from "react";
import bcrypt from "bcryptjs";
import { useI18n } from "@/lib/i18nContext";

const M_UPSERT = gql`
mutation($data:UserInput!){
  upsertUser(data:$data){ id }
}
`;

// role ต้องดึงจาก DB จริง (ไม่ hardcode) — มี Administrator/Manager/Sales/Warehouse/Subscriber ฯลฯ
// ตรงกับที่หน้า Edit User ใช้อยู่แล้ว (เดิมหน้านี้ hardcode ค้างจาก project เก่า ทำให้ role ไม่ครบ)
const Q_ROLES = gql`
query { roles { id name } }
`;

function FormNew(){
  const { t } = useI18n();
  const [form] = Form.useForm();
  const watchName = Form.useWatch('name', form);   // 👈 debug helper
  const watchEmail = Form.useWatch('email', form); // 👈 debug helper

  const { data: rolesData, loading: rolesLoading, error: rolesError } = useQuery(Q_ROLES);
  const roles: { id: string; name: string }[] = rolesData?.roles || [];

  const [save,{loading}] = useMutation(M_UPSERT,{
    onCompleted:()=>{ message.success(t("admin_users_new.create_success")); window.location.href='/admin/users'; }
  });

  const onFinish = async (v:any) => {
    const pwd: string = v.password?.trim() || '';
    const pwd2: string = v.confirmPassword?.trim() || '';
    if (!pwd) { message.error(t("admin_users_new.password_required_toast")); return; }
    if (pwd !== pwd2) { message.error(t("admin_users_new.password_mismatch_toast")); return; }
    const passwordHash = await bcrypt.hash(pwd, 10);

    await save({ variables:{
      data: {
        name: v.name,
        email: v.email,
        phone: v.phone || null,
        avatar: v.avatar || null,
        role_id: v.role_id,
        passwordHash
      }
    }});
  };

  const onFinishFailed = (info:any) => {
    console.warn('[onFinishFailed]', info.errorFields);
    message.error(t("admin_users_new.fill_required_fields"));
  };

  return (
    <Card title={t("admin_users_new.title")} style={{maxWidth:640}}>
      {/* สำคัญ: ไม่มี <form> ซ้อนทับ, ปุ่ม submit อยู่ "ใน" Form, ใช้ htmlType="submit" */}
      <Form
        name="user_new"
        form={form}
        layout="vertical"
        autoComplete="off"
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

        <Button type="primary" htmlType="submit" loading={loading}>{t("admin_users_new.submit")}</Button>
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
