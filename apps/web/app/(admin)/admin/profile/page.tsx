'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Descriptions, Avatar, Tag, Space, Alert, Button, Row, Col, Empty, Upload, Form, Input, Select, message } from "antd";
import { UserOutlined, ReloadOutlined, CrownOutlined, ShopOutlined, SafetyOutlined, UploadOutlined, SaveOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/useTheme";
import type { ThemeMode } from "@/lib/theme";
import { getLangCookie, setLangCookie, isLang } from "@/lib/lang";
import { useI18n } from "@/lib/i18nContext";

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
  const { t } = useI18n();
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

  if (error) return <Alert type="error" showIcon message={t("admin_profile.load_error")} description={error.message} />;

  async function handleUpload(file: File) {
    if (!me?.id) return false;
    try {
      const { data } = await uploadAvatar({ variables: { user_id: me.id, file } });
      const url = data?.uploadAvatar;
      if (url) {
        setAvatarUrl(url);
        message.success(t("admin_profile.avatar_upload_success"));
        refetch();
      } else {
        message.error(t("admin_profile.avatar_upload_error"));
      }
    } catch (err: any) {
      message.error(err?.message || t("admin_profile.avatar_upload_error"));
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
        message.success(t("admin_profile.save_success"));
        refetch();
      } else {
        message.error(t("admin_profile.save_error"));
      }
    } catch (err: any) {
      message.error(err?.message || t("admin_profile.save_error"));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><UserOutlined /> {t("admin_profile.title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_profile.refresh")}</Button>
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
                    {t("admin_profile.change_avatar")}
                  </Button>
                </Upload>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{me.name || me.username || me.email}</div>
                  <div style={{ color: "var(--app-text-secondary, #888)" }}>{me.email}</div>
                </div>
                <Space wrap style={{ justifyContent: "center" }}>
                  <Tag color="blue" icon={<SafetyOutlined />}>{me.role}</Tag>
                  {me.is_platform_admin && (
                    <Tag color="gold" icon={<CrownOutlined />}>{t("admin_profile.platform_admin_tag")}</Tag>
                  )}
                </Space>
              </Space>
            </Card>
          </Col>

          {/* รายละเอียด */}
          <Col xs={24} md={16}>
            <Card title={t("admin_profile.account_info_title")} style={{ marginBottom: 16 }}>
              <Form form={form} layout="vertical" onFinish={onSave}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="name" label={t("admin_profile.field_name")} rules={[{ required: true, message: t("admin_profile.field_name_required") }]}>
                      <Input placeholder={t("admin_profile.field_name_placeholder")} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="phone" label={t("admin_profile.field_phone")}>
                      <Input placeholder={t("admin_profile.field_phone_placeholder")} />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="username" label={t("admin_profile.field_username")}>
                      <Input disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="email" label={t("admin_profile.field_email")}>
                      <Input disabled />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="language" label={t("admin_profile.field_language")}>
                      <Select
                        options={[
                          { value: "th", label: t("admin_profile.lang_th") },
                          { value: "en", label: t("admin_profile.lang_en") },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="themePreference" label={t("admin_profile.field_theme")}>
                      <Select
                        options={[
                          { value: "system", label: t("admin_profile.theme_system") },
                          { value: "light", label: t("admin_profile.theme_light") },
                          { value: "dark", label: t("admin_profile.theme_dark") },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="gender" label={t("admin_profile.field_gender")}>
                      <Select
                        allowClear
                        placeholder={t("admin_profile.gender_placeholder")}
                        options={[
                          { value: "female", label: t("admin_profile.gender_female") },
                          { value: "male", label: t("admin_profile.gender_male") },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={t("admin_profile.field_role")}>
                      <Input value={me.role} disabled />
                    </Form.Item>
                  </Col>
                </Row>

                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label={t("admin_profile.member_since")} span={2}>{fmtDate(me.created_at)}</Descriptions.Item>
                  <Descriptions.Item label="User ID" span={2}>
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.id}</span>
                  </Descriptions.Item>
                </Descriptions>

                <Space>
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                    {t("admin_profile.save")}
                  </Button>
                  <Button onClick={() => form.resetFields()} disabled={saving || loading}>
                    {t("admin_profile.reset")}
                  </Button>
                </Space>
              </Form>
            </Card>

            <Card title={<><ShopOutlined /> {t("admin_profile.tenant_card_title")}</>} style={{ marginBottom: 16 }}>
              {me.tenant ? (
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                  <Descriptions.Item label={t("admin_profile.tenant_name")}>{me.tenant.name}</Descriptions.Item>
                  <Descriptions.Item label="Slug">/{me.tenant.slug}</Descriptions.Item>
                  <Descriptions.Item label={t("admin_profile.tenant_plan")}><Tag color="green">{me.tenant.plan}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Tenant ID">
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{me.tenant.id}</span>
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description={t("admin_profile.no_tenant")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>

            <Card title={<><SafetyOutlined /> {t("admin_profile.permissions_card_title", { count: me.permissions?.length || 0 })}</>}>
              {me.permissions?.length ? (
                <Space wrap size={[8, 8]}>
                  {me.permissions.map((p: string) => <Tag key={p}>{p}</Tag>)}
                </Space>
              ) : (
                <Empty description={t("admin_profile.no_permissions")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
