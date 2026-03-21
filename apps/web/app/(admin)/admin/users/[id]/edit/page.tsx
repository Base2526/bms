'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Form, Input, Select, Button, Space, Upload, message, Image } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState } from "react";

const Q = gql`
  query($id:ID!){
    user(id:$id){ id name email phone avatar role }
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

async function sha256Hex(input: string) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function FormEdit({ id }: { id: string }) {
  const [form] = Form.useForm();
  const { data, refetch } = useQuery(Q, { variables: { id } });
  const [save, { loading }] = useMutation(M_UPSERT, {
    onCompleted: () => message.success('Saved'),
  });
  const [uploadAvatar] = useMutation(M_UPLOAD_AVATAR);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  if (!data?.user) return <div>Loading...</div>;
  const u = data.user;

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
      <Form
        key={u.id}
        form={form}
        layout="vertical"
        initialValues={{
          name:   u.name   ?? '',
          email:  u.email  ?? '',
          phone:  u.phone  ?? '',
          role:   u.role   ?? 'Subscriber',
        }}
        onFinish={async (v) => {
          const dataToSend: any = {
            name: v.name,
            phone: v.phone || null,
            avatar: currentAvatar, // ✅ ใช้ค่าปัจจุบันจาก upload
            role: v.role,
          };

          const pwd: string = (v.password || '').trim();
          const pwd2: string = (v.confirmPassword || '').trim();
          if (pwd || pwd2) {
            if (!pwd) { message.error('Password is empty'); return; }
            if (pwd.length < 8) { message.error('Password must be at least 8 characters'); return; }
            if (pwd !== pwd2) { message.error('Confirm password not match'); return; }
            dataToSend.passwordHash = await sha256Hex(pwd);
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

        <Form.Item name="role" label="Role" rules={[{ required: true }]}>
          <Select options={[
            { value: 'Subscriber', label: 'Subscriber' },
            { value: 'Author', label: 'Author' },
            { value: 'Administrator', label: 'Administrator' },
          ]} />
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
