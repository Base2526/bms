'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Form, Input, Select, Button, Space, Upload, message, Image, Alert } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import bcrypt from "bcryptjs";

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

function FormEdit({ id }: { id: string }) {
  const [form] = Form.useForm();
  const { data, refetch } = useQuery(Q, { variables: { id } });
  
  // Fetch available roles
  const { data: rolesData, loading: rolesLoading, error: rolesError } = useQuery(Q_ROLES);
  
  const [save, { loading }] = useMutation(M_UPSERT, {
    onCompleted: () => message.success('Saved'),
  });
  const [uploadAvatar] = useMutation(M_UPLOAD_AVATAR);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Get roles and user data
  const roles: Role[] = rolesData?.roles || [];
  const u: User | undefined = data?.user;

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
  if (!u) return <div>Loading user...</div>;
  if (rolesLoading) return <div>Loading roles...</div>;
  if (rolesError) {
    return (
      <Alert
        type="error"
        message="Error loading roles"
        description={rolesError.message}
        showIcon
      />
    );
  }
  if (roles.length === 0) {
    return (
      <Alert
        type="warning"
        message="No roles available"
        description="Please create roles in the system before editing users."
        showIcon
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
        message.success('Avatar updated');
        refetch(); // refresh user info
      }
    } catch (e) {
      console.error(e);
      message.error('Upload failed');
    }
  }

  return (
    <Card title={`Edit User: ${u.name}`} style={{ maxWidth: 640 }}>
      <Space direction="vertical" size={0} style={{ marginBottom: 16, color: '#888', fontSize: 13 }}>
        {u.tenantName ? <span>ร้าน: <b>{u.tenantName}</b></span> : null}
        <span>Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'ยังไม่เคย'}</span>
      </Space>
      <Form
        key={u.id}
        form={form}
        layout="vertical"
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

          const pwd: string = (v.password || '').trim();
          const pwd2: string = (v.confirmPassword || '').trim();
          if (pwd || pwd2) {
            if (!pwd) { message.error('Password is empty'); return; }
            if (pwd.length < 8) { message.error('Password must be at least 8 characters'); return; }
            if (pwd !== pwd2) { message.error('Confirm password not match'); return; }
            dataToSend.passwordHash = await bcrypt.hash(pwd, 10);
          }

          // Validate role_id
          if (!dataToSend.role_id) {
            message.error('Please select a role');
            return;
          }

          await save({ variables: { id, data: dataToSend } });
        }}
      >
        <Form.Item label="Avatar">
          <Space direction="vertical">
            <div style={{ width: 100, height: 100, borderRadius: '50%', overflow: 'hidden', background: 'var(--app-surface-2)' }}>
              {currentAvatar ? (
                <Image src={currentAvatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--app-muted)'
                }}>No Avatar</div>
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
              <Button icon={<UploadOutlined />}>Change Avatar</Button>
            </Upload>
          </Space>
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input disabled /></Form.Item>
        <Form.Item name="phone" label="Phone"><Input /></Form.Item>

        <Form.Item 
          name="role_id" 
          label="Role" 
          rules={[{ required: true, message: 'Please select a role' }]}
          tooltip="Select user role from available roles"
        >
          <Select 
            placeholder="Select a role"
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
          label="New Password"
          tooltip="Leave empty to keep current password"
          rules={[{ min: 8, message: 'At least 8 characters' }]}
          hasFeedback
        >
          <Input.Password placeholder="(optional) new password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          dependencies={['password']}
          hasFeedback
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const pwd = getFieldValue('password');
                if (!pwd && !value) return Promise.resolve();
                if (pwd === value) return Promise.resolve();
                return Promise.reject(new Error('Confirm password not match'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="(optional) confirm password" />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>Save</Button>
          <Button href="/admin/users">Back</Button>
        </Space>
      </Form>
    </Card>
  );
}

export default function Page({ params }: { params: { id: string } }) {
  return <FormEdit id={params.id} />;
}
