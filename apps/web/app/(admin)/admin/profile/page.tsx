'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Descriptions, Avatar, Tag, Space, Alert, Button, Row, Col, Empty, Upload, Form, Input, Select, message } from "antd";
import { UserOutlined, ReloadOutlined, CrownOutlined, ShopOutlined, SafetyOutlined, UploadOutlined, SaveOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/useTheme";
import type { ThemeMode } from "@/lib/theme";
import { getLangCookie, setLangCookie, isLang } from "@/lib/lang";

const Q = gql`
  query {
    bmsMe {
      id name username email phone avatar role language gender themePreference
      is_platform_admin created_at
      tenant { id name slug plan }
      permissions
    }
  }
`;

const M_UPLOAD_AVATAR = gql`
  mutation($user_id: ID!, $file: Upload!) {
    uploadAvatar(user_id: $user_id, file: $file)
  }
`;

const M_UPDATE_ME = gql`
  mutation($data: MeInput!) {
    updateMe(data: $data) {
      id
      name
      email
      phone
      username
      language
      themePreference
      avatar
    }
  }
`;

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-";

export default function Page() {
  const [form] = Form.useForm();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [uploadAvatar, { loading: uploadingAvatar }] = useMutation(M_UPLOAD_AVATAR);
  const [updateMe, { loading: saving }] = useMutation(M_UPDATE_ME);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const { setTheme } = useTheme();
  const router = useRouter();

  const me = data?.bmsMe;

  useEffect(() => {
    if (!me) return;
    form.setFieldsValue({
      name: me.name || "",
      phone: me.phone || "",
      language: me.language || "th",
      gender: me.gender || undefined,
      themePreference: me.themePreference || "system",
      email: me.email || "",
      username: me.username || "",
    });
    setAvatarUrl(me.avatar || "");
  }, [form, me]);

  if (error) return <Alert type="error" showIcon message="โหลดโปรไฟล์ไม่ได้" description={error.message} />;

  async function handleUpload(file: File) {
    if (!me?.id) return false;
    try {
      const { data } = await uploadAvatar({ variables: { user_id: me.id, file } });
      const url = data?.uploadAvatar;
      if (url) {
        setAvatarUrl(url);
        message.success("อัปโหลดรูปโปรไฟล์แล้ว");
        refetch();
      } else {
        message.error("อัปโหลดรูปไม่สำเร็จ");
      }
    } catch (err: any) {
      message.error(err?.message || "อัปโหลดรูปไม่สำเร็จ");
    }
    return false;
  }

  async function onSave(values: any) {
    try {
      const res = await updateMe({
        variables: {
          data: {
            name: values.name?.trim() || "",
            phone: values.phone?.trim() || "",
            language: values.language || "th",
            gender: values.gender || null,
            themePreference: values.themePreference || "system",
          },
        },
      });

      if (res?.data?.updateMe?.id) {
        const nextTheme = res.data.updateMe.themePreference as ThemeMode | undefined;
        if (nextTheme === "light" || nextTheme === "dark" || nextTheme === "system") {
          setTheme(nextTheme);
        }
        // เหมือน setTheme ด้านบน — ใช้ค่าที่ server ยืนยันกลับมา ไม่ใช่ค่าดิบจาก form
        const nextLang = res.data.updateMe.language;
        if (isLang(nextLang) && getLangCookie() !== nextLang) {
          setLangCookie(nextLang);
          router.refresh();
        }
        message.success("บันทึกโปรไฟล์แล้ว");
        refetch();
      } else {
        message.error("บันทึกไม่สำเร็จ");
      }
    } catch (err: any) {
      message.error(err?.message || "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><UserOutlined /> โปรไฟล์ของฉัน</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {me && (
        <Row gutter={[16, 16]}>
          {/* บัตรผู้ใช้ */}
          <Col xs={24} md={8}>
            <Card>
              <Space direction="vertical" align="center" style={{ width: "100%" }} size={12}>
                <Avatar size={88} src={avatarUrl || undefined} icon={<UserOutlined />} />
                <Upload accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
                  <Button icon={<UploadOutlined />} loading={uploadingAvatar}>
                    เปลี่ยนรูปโปรไฟล์
                  </Button>
                </Upload>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{me.name || me.username || me.email}</div>
                  <div style={{ color: "var(--app-text-secondary, #888)" }}>{me.email}</div>
                </div>
                <Space wrap style={{ justifyContent: "center" }}>
                  <Tag color="blue" icon={<SafetyOutlined />}>{me.role}</Tag>
                  {me.is_platform_admin && (
                    <Tag color="gold" icon={<CrownOutlined />}>แอดมินแพลตฟอร์ม</Tag>
                  )}
                </Space>
              </Space>
            </Card>
          </Col>

          {/* รายละเอียด */}
          <Col xs={24} md={16}>
            <Card title="ข้อมูลบัญชี" style={{ marginBottom: 16 }}>
              <Form form={form} layout="vertical" onFinish={onSave}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="name" label="ชื่อ" rules={[{ required: true, message: "ระบุชื่อ" }]}>
                      <Input placeholder="ชื่อที่ใช้แสดง" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="phone" label="เบอร์โทร">
                      <Input placeholder="เบอร์โทร" />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="username" label="Username">
                      <Input disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="email" label="อีเมล">
                      <Input disabled />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="language" label="ภาษา">
                      <Select
                        options={[
                          { value: "th", label: "ไทย" },
                          { value: "en", label: "English" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="themePreference" label="ธีมหน้าจอ">
                      <Select
                        options={[
                          { value: "system", label: "ตามระบบเครื่อง" },
                          { value: "light", label: "โหมดสว่าง" },
                          { value: "dark", label: "โหมดมืด" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="gender" label="คำลงท้าย (ใช้กับ AI แนะนำคำตอบ)">
                      <Select
                        allowClear
                        placeholder="ไม่ระบุ (ใช้ ค่ะ)"
                        options={[
                          { value: "female", label: "ผู้หญิง — ค่ะ" },
                          { value: "male", label: "ผู้ชาย — ครับ" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Role">
                      <Input value={me.role} disabled />
                    </Form.Item>
                  </Col>
                </Row>

                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="สมาชิกตั้งแต่" span={2}>{fmtDate(me.created_at)}</Descriptions.Item>
                  <Descriptions.Item label="User ID" span={2}>
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.id}</span>
                  </Descriptions.Item>
                </Descriptions>

                <Space>
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                    บันทึกข้อมูล
                  </Button>
                  <Button onClick={() => form.resetFields()} disabled={saving || loading}>
                    รีเซ็ต
                  </Button>
                </Space>
              </Form>
            </Card>

            <Card title={<><ShopOutlined /> ร้านที่สังกัด</>} style={{ marginBottom: 16 }}>
              {me.tenant ? (
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                  <Descriptions.Item label="ชื่อร้าน">{me.tenant.name}</Descriptions.Item>
                  <Descriptions.Item label="Slug">/{me.tenant.slug}</Descriptions.Item>
                  <Descriptions.Item label="แพ็กเกจ"><Tag color="green">{me.tenant.plan}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Tenant ID">
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.tenant.id}</span>
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description="ไม่ได้สังกัดร้านใด" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>

            <Card title={<><SafetyOutlined /> สิทธิ์การใช้งาน ({me.permissions?.length || 0})</>}>
              {me.permissions?.length ? (
                <Space wrap size={[8, 8]}>
                  {me.permissions.map((p: string) => <Tag key={p}>{p}</Tag>)}
                </Space>
              ) : (
                <Empty description="ยังไม่มีสิทธิ์" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
