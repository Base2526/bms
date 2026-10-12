"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, Space, message } from "antd";
import { AndroidFilled, AppleFilled, SaveOutlined } from "@ant-design/icons";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

type Settings = { androidUrl: string; iosUrl: string };

export default function AppDownloadsPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/app-downloads", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        form.setFieldsValue(await response.json());
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [form]);

  async function save(values: Settings) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/app-downloads", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
      });
      if (!response.ok) {
        message.error(t(response.status === 400 ? "admin_app_downloads.invalidUrl" : "admin_app_downloads.saveError"));
        return;
      }
      form.setFieldsValue(await response.json());
      message.success(t("admin_app_downloads.saved"));
    } catch { message.error(t("admin_app_downloads.saveError")); }
    finally { setSaving(false); }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={t("admin_app_downloads.title")} />
      <Alert closable showIcon type="info" message={t("admin_app_downloads.description")} />
      {loadError ? <Alert closable showIcon type="error" message={t("admin_app_downloads.loadError")} /> : (
        <Card loading={loading}>
          <Form form={form} layout="vertical" initialValues={{ androidUrl: "", iosUrl: "" }} onFinish={save} disabled={loading || saving}>
            <Form.Item name="androidUrl" label={<Space><AndroidFilled />Android</Space>} extra={t("admin_app_downloads.androidHelp")}>
              <Input maxLength={2048} placeholder="https://…" allowClear autoComplete="off" />
            </Form.Item>
            <Form.Item name="iosUrl" label={<Space><AppleFilled />App Store</Space>} extra={t("admin_app_downloads.iosHelp")}>
              <Input maxLength={2048} placeholder="https://…" allowClear autoComplete="off" />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>{t("admin_app_downloads.save")}</Button>
          </Form>
        </Card>
      )}
    </Space>
  );
}
