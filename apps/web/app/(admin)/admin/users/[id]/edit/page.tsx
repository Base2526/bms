'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Form, Input, Select, Button, Space, Upload, message, Image, Alert } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18nContext";
import { assignableStaffRoles, canManageStaffRole } from "@/lib/bms/staffRoles";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

// TypeScript Types
type Role = {
  id: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
};

type User = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string | null;
  role?: string | null; // Legacy field (backward compatibility)
  role_id?: string | null; // New normalized field
  tenantName?: string | null;
  lastLoginAt?: string | null;
  is_platform_admin: boolean;
};

// Fetch user details including role_id
const Q = gql`
  query($id:ID!){
    user(id:$id){
      id
      name
      email
      phone
      avatar
      role
      role_id
      tenantName
      lastLoginAt
      is_platform_admin
    }
  }
`;

// Fetch all active roles
const Q_ROLES = gql`
  query {
    roles {
      id
      name
      description
      is_active
    }
  }
`;

const M_UPSERT = gql`
mutation($id:ID!, $data:UserInput!){
  upsertUser(id:$id, data:$data){ id }
}
`;

const M_UPLOAD_AVATAR = gql`
mutation($user_id:ID!, $file:Upload!){
  uploadAvatar(user_id:$user_id, file:$file)
}
`;

const Q_ME = gql`query { bmsMe { id role is_platform_admin } }`;

function FormEdit({ id }: { id: string }) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const { data, refetch } = useQuery(Q, { variables: { id } });

  // Fetch available roles
  const { data: rolesData, loading: rolesLoading, error: rolesError } = useQuery(Q_ROLES);

  const [save, { loading }] = useMutation(M_UPSERT, {
    onCompleted: () => message.success(t("admin_users_edit.save_success")),
    // server ปฏิเสธได้จริง (บทบาทไม่ถึง / เปลี่ยน role ตัวเอง) — ต้องโชว์เหตุผล
    // ใส่ onError แล้ว Apollo จะไม่ reject promise ทิ้งเป็น unhandled rejection
    onError: (e) => message.error(e.message),
  });
  const [uploadAvatar] = useMutation(M_UPLOAD_AVATAR);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Get roles and user data
  const allRoles: Role[] = (rolesData?.roles || []).filter((r: Role) => r.is_active !== false);
  const u: User | undefined = data?.user;

  const { data: meData } = useQuery(Q_ME);
  const myId: string | undefined = meData?.bmsMe?.id;
  const myRole: string | undefined = meData?.bmsMe?.role;
  const isPlatformAdmin = meData?.bmsMe?.is_platform_admin === true;
  const { can } = useBmsPermissions();
  const canWrite = isPlatformAdmin || myRole === "Administrator" || can("user.manage");
  const isSelf = Boolean(u && myId && u.id === myId);
  const isAdministrator = myRole === "Administrator";
  const readOnly = Boolean(meData) && !canWrite;

  // แตะแถวที่ role สูงกว่า/เท่ากับตัวเองไม่ได้ (server ปฏิเสธที่ requireManageableTarget อยู่แล้ว —
  // เช็คที่นี่ด้วยเพื่อไม่ให้เปิด URL ตรงมาแล้วกดบันทึกเปลี่ยน role โดยไม่รู้ตัว)
  const blockedByRank = Boolean(
    u && canWrite && !isSelf && (u.is_platform_admin || (myRole && !canManageStaffRole(myRole, u.role)))
  );

  // ตัวเลือกบทบาท = ที่ตัวเอง assign ได้ + บทบาทปัจจุบันของเป้าหมาย (ต้องคงอยู่เสมอ ไม่งั้น
  // getInitialRoleId() จะ fallback ไปบทบาทแรกของลิสต์แล้วกดบันทึกทีเดียวเปลี่ยน role โดยไม่ตั้งใจ)
  const roles: Role[] = (() => {
    if (!myRole || isAdministrator) return allRoles;
    const allowed = new Set(assignableStaffRoles(myRole, allRoles.map((r) => r.name)));
    return allRoles.filter((r) => allowed.has(r.name) || (u?.role && r.name === u.role));
  })();

  // แก้บทบาทตัวเองไม่ได้ (server ปฏิเสธด้วย reason self_role_change)
  const roleSelectDisabled = isSelf && !isAdministrator;

  // Determine initial role_id with fallback for backward compatibility
  const getInitialRoleId = (): string => {
    if (!u) return '';

    // Prefer role_id if available
    if (u.role_id) return u.role_id;

    // Fallback: match by role name for backward compatibility
    if (u.role && roles.length > 0) {
      const matchedRole = roles.find(r => r.name === u.role);
      if (matchedRole) return matchedRole.id;
    }

    // Default to first role or empty
    return roles[0]?.id || '';
  };

  // Update form when user data or roles change
  useEffect(() => {
    if (u && roles.length > 0) {
      form.setFieldsValue({
        name: u.name ?? '',
        email: u.email ?? '',
        phone: u.phone ?? '',
        role_id: getInitialRoleId(),
      });
    }
  }, [u, roles, form]);

  // Loading states
  if (!u) return <div>{t("admin_users_edit.loading_user")}</div>;
  if (rolesLoading) return <div>{t("admin_users_edit.loading_roles")}</div>;
  if (rolesError) {
    return (
      <Alert closable
        type="error"
        message={t("admin_users_edit.roles_load_error_title")}
        description={rolesError.message}
        showIcon
      />
    );
  }
  if (roles.length === 0) {
    return (
      <Alert closable
        type="warning"
        message={t("admin_users_edit.no_roles_title")}
        description={t("admin_users_edit.no_roles_desc")}
        showIcon
      />
    );
  }
  // บทบาทสูงกว่า/เท่ากับเรา → ไม่แสดงฟอร์มเลย (กันกดบันทึกแล้วโดน 403 ทีหลัง)
  if (blockedByRank) {
    return (
      <Alert closable
        type="warning"
        showIcon
        message={t("admin_users_edit.cannot_manage_title")}
        description={t("admin_users_edit.cannot_manage_desc")}
        action={<Button href="/admin/users">{t("admin_users_edit.back")}</Button>}
      />
    );
  }

  const currentAvatar = avatarUrl || u.avatar || null;

  async function handleUpload(file: File) {
    try {
      const { data } = await uploadAvatar({ variables: { user_id: id, file } });
      const url = data?.uploadAvatar;
      if (url) {
        setAvatarUrl(url);
        message.success(t("admin_users_edit.avatar_updated"));
        refetch(); // refresh user info
      }
    } catch (e) {
      console.error(e);
      message.error(t("admin_users_edit.upload_failed"));
    }
  }

  return (
    <Card title={`${t("admin_users_edit.title_prefix")} ${u.name}`} style={{ maxWidth: 640 }}>
      {readOnly && (
        <Alert closable
          type="warning"
          showIcon
          message={t("admin_users_edit.read_only_title")}
          description={t("admin_users_edit.read_only_desc")}
          style={{ marginBottom: 16 }}
        />
      )}
      <Space direction="vertical" size={0} style={{ marginBottom: 16, color: '#888', fontSize: 13 }}>
        {u.tenantName ? <span>{t("admin_users_edit.shop_label")} <b>{u.tenantName}</b></span> : null}
        <span>{t("admin_users_edit.last_login")} {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t("admin_users_edit.never")}</span>
      </Space>
      <Form
        key={u.id}
        form={form}
        layout="vertical"
        disabled={readOnly}
        initialValues={{
          name: u.name ?? '',
          email: u.email ?? '',
          phone: u.phone ?? '',
          role_id: getInitialRoleId(),
        }}
        onFinish={async (v: any) => {
          const dataToSend: any = {
            name: v.name,
            phone: v.phone || null,
            avatar: currentAvatar,
            role_id: v.role_id, // ✅ Use role_id instead of role text
          };

          const pwd: string = typeof v.password === 'string' ? v.password : '';
          const pwd2: string = typeof v.confirmPassword === 'string' ? v.confirmPassword : '';
          if (pwd || pwd2) {
            if (!pwd) { message.error(t("admin_users_edit.password_empty_error")); return; }
            if (pwd.length < 8) { message.error(t("admin_users_edit.password_too_short")); return; }
            if (pwd !== pwd2) { message.error(t("admin_users_edit.confirm_password_mismatch")); return; }
            dataToSend.password = pwd;
          }

          // Validate role_id
          if (!dataToSend.role_id) {
            message.error(t("admin_users_edit.role_required_toast"));
            return;
          }

          await save({ variables: { id, data: dataToSend } });
        }}
      >
        <Form.Item label={t("admin_users_edit.field_avatar")}>
          <Space direction="vertical">
            <div style={{ width: 100, height: 100, borderRadius: '50%', overflow: 'hidden', background: 'var(--app-surface-2)' }}>
              {currentAvatar ? (
                <Image src={currentAvatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--app-muted)'
                }}>{t("admin_users_edit.no_avatar")}</div>
              )}
            </div>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                handleUpload(file);
                return false; // prevent default upload
              }}
              accept="image/*"
            >
              <Button icon={<UploadOutlined />}>{t("admin_users_edit.change_avatar")}</Button>
            </Upload>
          </Space>
        </Form.Item>
        <Form.Item name="name" label={t("admin_users_edit.field_name")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="email" label={t("admin_users_edit.field_email")} rules={[{ required: true, type: 'email' }]}><Input disabled /></Form.Item>
        <Form.Item name="phone" label={t("admin_users_edit.field_phone")}><Input /></Form.Item>

        <Form.Item
          name="role_id"
          label={t("admin_users_edit.field_role")}
          rules={[{ required: true, message: t("admin_users_edit.role_required") }]}
          tooltip={t("admin_users_edit.role_tooltip")}
          extra={roleSelectDisabled ? t("admin_users_edit.self_role_locked") : undefined}
        >
          <Select
            placeholder={t("admin_users_edit.role_placeholder")}
            disabled={roleSelectDisabled}
            options={roles.map(role => ({
              value: role.id,
              label: role.name,
              title: role.description || role.name,
            }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={t("admin_users_edit.field_password")}
          tooltip={t("admin_users_edit.password_tooltip")}
          rules={[{ min: 8, message: t("admin_users_edit.password_min_length") }]}
          hasFeedback
        >
          <Input.Password placeholder={t("admin_users_edit.password_placeholder")} />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label={t("admin_users_edit.field_confirm_password")}
          dependencies={['password']}
          hasFeedback
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const pwd = getFieldValue('password');
                if (!pwd && !value) return Promise.resolve();
                if (pwd === value) return Promise.resolve();
                return Promise.reject(new Error(t("admin_users_edit.confirm_password_mismatch")));
              },
            }),
          ]}
        >
          <Input.Password placeholder={t("admin_users_edit.confirm_password_placeholder")} />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={loading} disabled={readOnly}>{t("admin_users_edit.save")}</Button>
          <Button href="/admin/users">{t("admin_users_edit.back")}</Button>
        </Space>
      </Form>
    </Card>
  );
}

export default function Page({ params }: { params: { id: string } }) {
  return <FormEdit id={params.id} />;
}
