'use client';

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Switch, Table, Tag,
  Typography, message,
} from "antd";
import { useEffect, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

type Setting = Record<string, any> & { id: string; provider: string; environment: string };

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store", ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`);
  return body;
}

export default function DeliveryProviderSettingsPage() {
  const { lang } = useI18n();
  const L = (th: string, en: string) => lang === "th" ? th : en;
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const provider = Form.useWatch("provider", form);
  const environment = Form.useWatch("environment", form);
  const editingId = Form.useWatch("id", form);
  const activationReady = provider
    ? rows.find((row) => row.provider === provider && row.environment === environment)?.activationReady === true
    : false;

  const load = async () => {
    setLoading(true);
    try {
      const body = await jsonFetch("/api/admin/delivery-providers");
      setRows(body.settings ?? []);
    } catch (error: any) {
      message.error(error?.message ?? L("โหลดการตั้งค่าไม่สำเร็จ", "Unable to load provider settings"));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (row?: Setting) => {
    form.resetFields();
    form.setFieldsValue(row ? {
      ...row,
      configJson: JSON.stringify(row.config ?? {}, null, 2),
      contractReviewedAt: row.contractReviewedAt ? new Date(row.contractReviewedAt).toISOString() : undefined,
      credentialExpiresAt: row.credentialExpiresAt ? new Date(row.credentialExpiresAt).toISOString() : undefined,
    } : {
      provider: "LINEMAN", environment: "SANDBOX", onboardingStatus: "DRAFT",
      credentialAuthority: "UNCONFIRMED", authenticationMode: "UNCONFIRMED",
      tenantConnectionsEnabled: false, configJson: "{}",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const config = values.configJson?.trim() ? JSON.parse(values.configJson) : {};
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("config must be an object");
      await jsonFetch("/api/admin/delivery-providers", {
        method: "POST", body: JSON.stringify({ ...values, config }),
      });
      message.success(L("บันทึก Partner API แล้ว", "Partner API settings saved"));
      setOpen(false); await load();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed"));
    }
  };

  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <AdminPageHeader title={L("Partner API เดลิเวอรี", "Delivery Partner APIs")}>
      <Space>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{L("รีเฟรช", "Refresh")}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => start()}>{L("เพิ่ม Provider", "Add provider")}</Button>
      </Space>
    </AdminPageHeader>
    <Alert closable showIcon type="info"
      message={L("หน้านี้เป็นของเจ้าของระบบ BMS", "This page belongs to the BMS platform owner")}
      description={L("เก็บ Partner contract และ credential ส่วนกลางครั้งเดียว เจ้าของร้านใช้ /admin/delivery-platforms เพื่อเชื่อมร้านและ mapping เท่านั้น Secret เข้ารหัสและอ่านค่าจริงกลับไม่ได้", "Store the platform Partner contract and credentials once. Shop owners use /admin/delivery-platforms only for shop authorization and mappings. Secrets are encrypted and never returned in plaintext.")} />
    <Card>
      <Table rowKey="id" loading={loading} dataSource={rows} pagination={false} columns={[
        { title: "Provider", dataIndex: "provider" },
        { title: L("ระบบ", "Environment"), dataIndex: "environment" },
        { title: L("สถานะ", "Status"), dataIndex: "onboardingStatus", render: (value) => <Tag color={value === "ACTIVE" ? "green" : value === "SUSPENDED" ? "red" : "orange"}>{value}</Tag> },
        { title: L("เจ้าของ credential", "Credential authority"), dataIndex: "credentialAuthority" },
        { title: L("การยืนยัน", "Authentication"), dataIndex: "authenticationMode" },
        { title: L("Credential", "Credential"), render: (_, row) => [row.clientSecretMasked, row.accessTokenMasked, row.webhookSecretMasked].filter(Boolean).join(" · ") || "—" },
        { title: L("เปิดให้ร้านเชื่อม", "Tenant connections"), dataIndex: "tenantConnectionsEnabled", render: (value) => <Tag color={value ? "green" : "default"}>{value ? L("เปิด", "Enabled") : L("ปิด", "Disabled")}</Tag> },
        { title: L("Adapter", "Adapter"), dataIndex: "activationReady", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "VERIFIED" : "CONTRACT_BLOCKED"}</Tag> },
        { title: "", render: (_, row) => <Button size="small" onClick={() => start(row)}>{L("ตั้งค่า", "Configure")}</Button> },
      ]} />
    </Card>

    <Modal open={open} width={860} title={L("ตั้งค่า Partner API", "Configure Partner API")}
      onCancel={() => setOpen(false)} onOk={() => void save()} okText={L("บันทึก", "Save")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={form} layout="vertical">
        <Form.Item name="id" hidden><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="provider" label="Provider" rules={[{ required: true }]}><Select disabled={Boolean(editingId)} options={["LINEMAN","GRABFOOD","FOODPANDA"].map((value) => ({ value }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="environment" label="Environment" rules={[{ required: true }]}><Select disabled={Boolean(editingId)} options={["SANDBOX","LIVE"].map((value) => ({ value }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="onboardingStatus" label={L("สถานะ onboarding", "Onboarding status")} rules={[{ required: true }]}><Select options={["DRAFT","CONTRACT_REVIEW","SANDBOX","CERTIFIED","ACTIVE","SUSPENDED"].map((value) => ({ value, disabled: !activationReady && ["CERTIFIED","ACTIVE"].includes(value) }))} /></Form.Item></Col>
        </Row>
        {!activationReady && <Alert closable showIcon type="warning" style={{ marginBottom: 16 }} message={L("Adapter ยังไม่ VERIFIED", "Adapter is not VERIFIED")} description={L("บันทึก contract และ credential เตรียมไว้ได้ แต่เปิด CERTIFIED/ACTIVE หรือให้ร้านเชื่อมไม่ได้จนกว่าโค้ด adapter จะผ่าน contract tests", "You may save the contract and credentials, but CERTIFIED/ACTIVE and tenant connections remain blocked until the adapter passes contract tests.")} />}
        <Row gutter={12}>
          <Col span={12}><Form.Item name="credentialAuthority" label={L("เจ้าของ credential", "Credential authority")} rules={[{ required: true }]}><Select options={["UNCONFIRMED","PLATFORM","TENANT","AUTHORIZATION_FLOW"].map((value) => ({ value }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="authenticationMode" label={L("วิธี authentication", "Authentication mode")} rules={[{ required: true }]}><Select options={["UNCONFIRMED","OAUTH_CLIENT_CREDENTIALS","API_KEY","BEARER_TOKEN","SIGNED_REQUEST","CUSTOM"].map((value) => ({ value }))} /></Form.Item></Col>
        </Row>
        <Form.Item name="tenantConnectionsEnabled" label={L("เปิดให้ร้านเชื่อมต่อ", "Enable tenant connections")} valuePropName="checked"><Switch disabled={!activationReady} /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item name="partnerId" label="Partner / Program ID"><Input /></Form.Item></Col><Col span={12}><Form.Item name="clientId" label="Client ID"><Input /></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="clientSecret" label={L("Client Secret (เว้นว่างเพื่อคงเดิม)", "Client Secret (blank keeps current)")}><Input.Password /></Form.Item></Col><Col span={12}><Form.Item name="accessToken" label={L("Access Token (เว้นว่างเพื่อคงเดิม)", "Access Token (blank keeps current)")}><Input.Password /></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="refreshToken" label={L("Refresh Token (เว้นว่างเพื่อคงเดิม)", "Refresh Token (blank keeps current)")}><Input.Password /></Form.Item></Col><Col span={12}><Form.Item name="webhookSecret" label={L("Webhook Secret (เว้นว่างเพื่อคงเดิม)", "Webhook Secret (blank keeps current)")}><Input.Password /></Form.Item></Col></Row>
        <Row gutter={12}><Col span={16}><Form.Item name="apiBaseUrl" label="API Base URL"><Input placeholder="https://provider.example/api" /></Form.Item></Col><Col span={8}><Form.Item name="apiVersion" label="API Version"><Input /></Form.Item></Col></Row>
        <Form.Item name="webhookAuthHeader" label={L("ชื่อ Header สำหรับ webhook", "Webhook authentication header")}><Input /></Form.Item>
        <Row gutter={12}><Col span={16}><Form.Item name="contractUrl" label={L("URL เอกสาร Partner contract", "Partner contract URL")}><Input placeholder="https://..." /></Form.Item></Col><Col span={8}><Form.Item name="contractVersion" label={L("เวอร์ชัน contract", "Contract version")}><Input /></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="contractReviewedAt" label={L("วันที่ตรวจ contract", "Contract reviewed at")}><Input placeholder="2026-09-27T12:00:00+07:00" /></Form.Item></Col><Col span={12}><Form.Item name="credentialExpiresAt" label={L("Credential หมดอายุ", "Credential expires at")}><Input placeholder="2027-09-27T12:00:00+07:00" /></Form.Item></Col></Row>
        <Form.Item name="configJson" label={L("Config ที่ไม่ใช่ความลับ (JSON)", "Non-secret config (JSON)")}><Input.TextArea rows={6} /></Form.Item>
        <Typography.Text type="secondary">{L("ห้ามใส่ secret/token/password ใน JSON ใช้ช่อง write-only ด้านบนเท่านั้น", "Do not put secrets, tokens, or passwords in JSON; use the write-only fields above.")}</Typography.Text>
      </Form>
    </Modal>
  </Space>;
}
