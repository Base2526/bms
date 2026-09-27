"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Card, Col, Modal, Row, Space, Switch, Tag, Typography, message } from "antd";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const SETTINGS = gql`
  query SocialAuthSettings {
    bmsSocialAuthSettings {
      provider
      configReady
      configIssues
      publicLoginEnabled
      adminLoginEnabled
      shopSignupEnabled
      publicLoginAvailable
      adminLoginAvailable
      shopSignupAvailable
      updatedAt
    }
  }
`;

const UPDATE_SETTING = gql`
  mutation UpdateSocialAuthSetting($input: BmsSocialAuthSettingInput!, $confirm: Boolean!) {
    bmsUpdateSocialAuthSetting(input: $input, confirm: $confirm) {
      provider
      configReady
      configIssues
      publicLoginEnabled
      adminLoginEnabled
      shopSignupEnabled
      publicLoginAvailable
      adminLoginAvailable
      shopSignupAvailable
      updatedAt
    }
  }
`;

type Setting = {
  provider: "google" | "facebook";
  configReady: boolean;
  configIssues: string[];
  publicLoginEnabled: boolean;
  adminLoginEnabled: boolean;
  shopSignupEnabled: boolean;
  publicLoginAvailable: boolean;
  adminLoginAvailable: boolean;
  shopSignupAvailable: boolean;
  updatedAt: string;
};

type ToggleKey = "publicLoginEnabled" | "adminLoginEnabled" | "shopSignupEnabled";
type Surface = "PUBLIC_LOGIN" | "ADMIN_LOGIN" | "SHOP_SIGNUP";

const issueLabels: Record<string, string> = {
  NEXT_PUBLIC_GOOGLE_CLIENT_ID_MISSING: "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_ID_MISSING: "GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_ID_MISMATCH: "Google Client ID mismatch",
  NEXT_PUBLIC_FACEBOOK_APP_ID_MISSING: "NEXT_PUBLIC_FACEBOOK_APP_ID",
  FACEBOOK_APP_ID_MISSING: "FACEBOOK_APP_ID",
  FACEBOOK_APP_SECRET_MISSING: "FACEBOOK_APP_SECRET",
  FACEBOOK_APP_ID_MISMATCH: "Facebook App ID mismatch",
};

export default function AuthSettingsPage() {
  const { lang } = useI18n();
  const L = (th: string, en: string) => lang === "th" ? th : en;
  const { data, loading, error, refetch } = useQuery(SETTINGS, { fetchPolicy: "network-only" });
  const [updateSetting, { loading: saving }] = useMutation(UPDATE_SETTING);
  const settings = (data?.bmsSocialAuthSettings ?? []) as Setting[];

  const toggle = (setting: Setting, key: ToggleKey, surfaceKey: Surface, enabled: boolean) => {
    const surface = key === "publicLoginEnabled"
      ? L("หน้าเข้าสู่ระบบสมาชิก", "Public login")
      : key === "adminLoginEnabled"
        ? L("หน้าเข้าสู่ระบบผู้ดูแล", "Admin login")
        : L("หน้าสมัครเปิดร้าน", "Shop signup");
    Modal.confirm({
      title: enabled
        ? L(`เปิด ${setting.provider} บน${surface}`, `Enable ${setting.provider} on ${surface}`)
        : L(`ปิด ${setting.provider} บน${surface}`, `Disable ${setting.provider} on ${surface}`),
      content: enabled
        ? L("ผู้ใช้จะเห็นปุ่มและสามารถยืนยันตัวตนผ่าน provider นี้ได้ทันที", "Users will immediately see and be able to use this provider.")
        : L("ปุ่มจะถูกซ่อน และ backend จะปฏิเสธคำขอใหม่บนหน้านี้ทันที", "The button will be hidden and new backend requests on this surface will be rejected immediately."),
      okText: enabled ? L("ยืนยันเปิด", "Enable") : L("ยืนยันปิด", "Disable"),
      cancelText: L("ยกเลิก", "Cancel"),
      okButtonProps: { danger: !enabled },
      async onOk() {
        try {
          await updateSetting({
            variables: {
              confirm: true,
              input: {
                provider: setting.provider,
                surface: surfaceKey,
                enabled,
              },
            },
          });
          await refetch();
          message.success(L("บันทึกการตั้งค่าแล้ว", "Authentication setting saved"));
        } catch (mutationError: any) {
          message.error(mutationError?.message ?? L("บันทึกไม่สำเร็จ", "Unable to save setting"));
          throw mutationError;
        }
      },
    });
  };

  const rows: Array<{
    key: ToggleKey;
    surface: Surface;
    availableKey: "publicLoginAvailable" | "adminLoginAvailable" | "shopSignupAvailable";
    title: string;
    path: string;
  }> = [
    { key: "publicLoginEnabled", surface: "PUBLIC_LOGIN", availableKey: "publicLoginAvailable", title: L("สมาชิกทั่วไป", "Public login"), path: "/login" },
    { key: "adminLoginEnabled", surface: "ADMIN_LOGIN", availableKey: "adminLoginAvailable", title: L("ผู้ดูแลร้านและแพลตฟอร์ม", "Admin login"), path: "/admin/login" },
    { key: "shopSignupEnabled", surface: "SHOP_SIGNUP", availableKey: "shopSignupAvailable", title: L("สมัครเปิดร้าน", "Shop signup"), path: "/shop-signup" },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={L("การเข้าสู่ระบบด้วย Social", "Social authentication")} />
      <Alert
        closable
        showIcon
        type="info"
        message={L("ควบคุมโดยผู้ดูแลแพลตฟอร์ม", "Controlled by platform administrators")}
        description={L(
          "Credential ยังอยู่ใน environment และไม่แสดงในหน้านี้ การเปิดใช้งานจะสำเร็จต่อเมื่อ config ของ provider พร้อมเท่านั้น ส่วนการเข้าสู่ระบบด้วยรหัสผ่านเปิดอยู่เสมอ",
          "Credentials remain in the runtime environment and are never shown here. A provider becomes available only when its configuration is ready. Password login always remains available.",
        )}
      />
      {error && (
        <Alert
          closable
          showIcon
          type="error"
          message={L("โหลดการตั้งค่าไม่สำเร็จ", "Unable to load authentication settings")}
          description={error.message}
        />
      )}
      <Row gutter={[16, 16]}>
        {settings.map((setting) => (
          <Col xs={24} xl={12} key={setting.provider}>
            <Card
              loading={loading}
              title={<span style={{ textTransform: "capitalize" }}>{setting.provider}</span>}
              extra={setting.configReady
                ? <Tag color="green">READY</Tag>
                : <Tag color="red">MISCONFIGURED</Tag>}
            >
              {!setting.configReady && (
                <Alert
                  closable
                  showIcon
                  type="warning"
                  style={{ marginBottom: 16 }}
                  message={L("ยังเปิดใช้งานไม่ได้", "Provider cannot be enabled")}
                  description={`${L("ตรวจสอบ", "Check")}: ${setting.configIssues.map((issue) => issueLabels[issue] ?? issue).join(", ")}`}
                />
              )}
              <Space direction="vertical" size={0} style={{ width: "100%" }}>
                {rows.map((row, index) => {
                  const effective = setting[row.availableKey];
                  return (
                    <div
                      key={row.key}
                      style={{
                        alignItems: "center",
                        borderTop: index === 0 ? undefined : "1px solid #f0f0f0",
                        display: "flex",
                        gap: 16,
                        justifyContent: "space-between",
                        minHeight: 70,
                        padding: "12px 0",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <Typography.Text strong>{row.title}</Typography.Text>
                        <br />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.path}</Typography.Text>
                      </div>
                      <Space>
                        <Tag color={effective ? "green" : "default"}>
                          {effective ? L("ใช้งานจริง", "AVAILABLE") : L("ปิดอยู่", "OFF")}
                        </Tag>
                        <Switch
                          checked={setting[row.key]}
                          disabled={saving || (!setting.configReady && !setting[row.key])}
                          onChange={(checked) => toggle(setting, row.key, row.surface, checked)}
                          aria-label={`${setting.provider} ${row.path}`}
                        />
                      </Space>
                    </div>
                  );
                })}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {L("แก้ไขล่าสุด", "Last updated")}: {new Date(setting.updatedAt).toLocaleString(lang === "th" ? "th-TH" : "en-US")}
              </Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}
