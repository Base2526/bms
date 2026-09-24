'use client';

import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select,
  Space, Switch, Table, Tabs, Tag, Typography, message,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

type Integration = Record<string, any> & { id: string; provider: string; environment: string; capabilities: Record<string, string> };
type Boot = {
  integrations: Integration[];
  mappings: { locations: any[]; menus: any[]; availableLocations: any[]; catalog: any[] };
  operations: { orders: any[]; events: any[]; commands: any[]; controls: any[] };
  finance: { settlements: any[]; lines: any[]; adjustments: any[]; disputes: any[] };
};

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`);
  return body;
}

function statusColor(value: string) {
  if (["HEALTHY", "MATCHED", "SUCCEEDED", "PROCESSED", "VERIFIED", "ACCEPTING"].includes(value)) return "green";
  if (["FAILED", "DEAD_LETTER", "MISMATCH", "ACTION_REQUIRED", "AUTH_FAILED"].includes(value)) return "red";
  if (["RETRY", "PENDING", "PROCESSING", "STALE", "DEGRADED", "MANUAL_ACTION_REQUIRED"].includes(value)) return "orange";
  return "default";
}

export default function DeliveryPlatformsPage() {
  const { lang } = useI18n();
  const L = (th: string, en: string) => lang === "th" ? th : en;
  const { can, loading: permissionLoading } = useBmsPermissions();
  const canView = can("delivery.integration.view");
  const canManageIntegration = can("delivery.integration.manage");
  const canManageMapping = can("delivery.mapping.manage");
  const canViewFinance = can("delivery.settlement.view");
  const canManageFinance = can("delivery.settlement.manage");
  const canManageDispute = can("delivery.dispute.manage");
  const [boot, setBoot] = useState<Boot>({
    integrations: [], mappings: { locations: [], menus: [], availableLocations: [], catalog: [] },
    operations: { orders: [], events: [], commands: [], controls: [] },
    finance: { settlements: [], lines: [], adjustments: [], disputes: [] },
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("integrations");
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [integrationForm] = Form.useForm();
  const [locationForm] = Form.useForm();
  const [menuForm] = Form.useForm();
  const [settlementForm] = Form.useForm();
  const [adjustmentForm] = Form.useForm();
  const [disputeForm] = Form.useForm();

  const load = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const [integrations, mappings, operations, finance] = await Promise.all([
        jsonFetch("/api/bms/delivery/integrations"), jsonFetch("/api/bms/delivery/mappings"),
        jsonFetch("/api/bms/delivery/operations"),
        canViewFinance ? jsonFetch("/api/bms/delivery/settlements") : Promise.resolve({ settlements: [], lines: [], adjustments: [], disputes: [] }),
      ]);
      setBoot({ integrations: integrations.integrations ?? [], mappings, operations, finance });
    } catch (error: any) { message.error(error?.message ?? L("โหลดข้อมูลไม่สำเร็จ", "Unable to load delivery data")); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && ["integrations", "mappings", "operations", "finance"].includes(tab)) setActiveTab(tab);
  }, []);
  useEffect(() => { void load(); }, [canView, canViewFinance]); // eslint-disable-line react-hooks/exhaustive-deps

  const integrationOptions = boot.integrations.map((i) => ({ value: i.id, label: `${i.provider} · ${i.environment}` }));
  const catalogOptions = useMemo(() => boot.mappings.catalog.map((p) => ({
    value: JSON.stringify([p.sku, p.size]), label: `${p.name} · ${p.sku}/${p.size}`, row: p,
  })), [boot.mappings.catalog]);

  async function saveIntegration() {
    try {
      const values = await integrationForm.validateFields();
      let config: Record<string, unknown> = {};
      if (values.configJson?.trim()) {
        config = JSON.parse(values.configJson);
        if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("config must be a JSON object");
      }
      await jsonFetch("/api/bms/delivery/integrations", { method: "POST", body: JSON.stringify({ ...values, config }) });
      message.success(L("บันทึกการเชื่อมต่อแล้ว", "Integration saved"));
      setIntegrationOpen(false); integrationForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed")); }
  }

  async function saveLocationMapping() {
    try {
      const values = await locationForm.validateFields();
      await jsonFetch("/api/bms/delivery/mappings", { method: "POST", body: JSON.stringify({ action: "save_location", ...values }) });
      message.success(L("บันทึก branch mapping แล้ว", "Branch mapping saved"));
      setLocationOpen(false); locationForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed")); }
  }

  async function saveMenuMapping() {
    try {
      const values = await menuForm.validateFields();
      const [productSku, size] = values.catalogTarget ? JSON.parse(String(values.catalogTarget)) : [null, null];
      await jsonFetch("/api/bms/delivery/mappings", { method: "POST", body: JSON.stringify({
        action: "save_menu", ...values, productSku: productSku || null, size: size || null,
      }) });
      message.success(L("บันทึก menu mapping แล้ว", "Menu mapping saved"));
      setMenuOpen(false); menuForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed")); }
  }

  async function importSettlement() {
    try {
      const values = await settlementForm.validateFields();
      const integration = boot.integrations.find((i) => i.id === values.integrationId);
      const lines = JSON.parse(values.linesJson);
      await jsonFetch("/api/bms/delivery/settlements", { method: "POST", body: JSON.stringify({
        action: "import_manual", ...values, provider: integration?.provider,
        periodStart: values.period[0].toISOString(), periodEnd: values.period[1].toISOString(), lines,
      }) });
      message.success(L("นำเข้าและกระทบยอดแล้ว", "Statement imported and reconciled"));
      setSettlementOpen(false); settlementForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("นำเข้าไม่สำเร็จ", "Import failed")); }
  }

  async function saveAdjustment() {
    try {
      const values = await adjustmentForm.validateFields();
      await jsonFetch("/api/bms/delivery/settlements", { method: "POST", body: JSON.stringify({
        action: "record_adjustment", ...values,
        effectiveAt: values.effectiveAt.toISOString(),
      }) });
      message.success(L("บันทึก adjustment แล้ว", "Adjustment recorded"));
      setAdjustmentOpen(false); adjustmentForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed")); }
  }

  async function saveDispute() {
    try {
      const values = await disputeForm.validateFields();
      await jsonFetch("/api/bms/delivery/settlements", { method: "POST", body: JSON.stringify({ action: "create_dispute", ...values }) });
      message.success(L("สร้าง dispute แล้ว", "Dispute created"));
      setDisputeOpen(false); disputeForm.resetFields(); await load();
    } catch (error: any) { if (!error?.errorFields) message.error(error?.message ?? L("บันทึกไม่สำเร็จ", "Save failed")); }
  }

  async function transitionDispute(dispute: any, status: string) {
    try {
      const providerCaseId = status === "SUBMITTED"
        ? window.prompt(L("Provider case ID (เว้นว่างได้)", "Provider case ID (optional)"), dispute.provider_case_id ?? "")?.trim()
        : undefined;
      await jsonFetch("/api/bms/delivery/settlements", { method: "POST", body: JSON.stringify({
        action: "transition_dispute", disputeId: dispute.id, status, providerCaseId: providerCaseId || undefined,
      }) });
      message.success(L("อัปเดตสถานะ dispute แล้ว", "Dispute status updated")); await load();
    } catch (error: any) { message.error(error?.message ?? L("อัปเดตไม่สำเร็จ", "Update failed")); }
  }

  async function retry(kind: "event" | "command", id: string) {
    try {
      await jsonFetch("/api/bms/delivery/operations", { method: "POST", body: JSON.stringify({ action: `retry_${kind}`, [`${kind}Id`]: id }) });
      message.success(L("ส่งเข้าคิวใหม่แล้ว", "Queued for retry")); await load();
    } catch (error: any) { message.error(error?.message ?? L("ลองใหม่ไม่สำเร็จ", "Retry failed")); }
  }

  if (!permissionLoading && !canView) return <Alert closable type="error" showIcon message={L("ไม่มีสิทธิ์ delivery.integration.view", "Missing delivery.integration.view permission")} />;

  const integrations = <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Alert closable showIcon type="warning" message={L("Live gate ยังล็อกตาม official contract", "Live gate remains locked to verified official contracts")}
      description={L("LINE MAN และ GrabFood webhook ยังไม่เปิด live adapter; foodpanda เปิดเฉพาะ capability ที่เอกสารสาธารณะยืนยัน และยังต้องมี partner credential/sandbox certification", "LINE MAN and GrabFood webhooks remain blocked; foodpanda exposes only publicly verified capabilities and still requires partner credentials and sandbox certification.")} />
    <Card title={L("การเชื่อมต่อ", "Integrations")} extra={canManageIntegration && <Button type="primary" icon={<PlusOutlined />} onClick={() => {
      integrationForm.resetFields(); integrationForm.setFieldsValue({ provider: "FOODPANDA", environment: "SANDBOX", rolloutMode: "OFF", active: false, outboundCommandsEnabled: false, configJson: "{}" }); setIntegrationOpen(true);
    }}>{L("เพิ่ม", "Add")}</Button>}>
      <Table rowKey="id" loading={loading} dataSource={boot.integrations} pagination={false} columns={[
        { title: L("Provider", "Provider"), dataIndex: "provider" },
        { title: L("สภาพแวดล้อม", "Environment"), dataIndex: "environment" },
        { title: L("Rollout", "Rollout"), dataIndex: "rolloutMode", render: (v) => <Tag>{v}</Tag> },
        { title: L("สุขภาพ", "Health"), dataIndex: "healthStatus", render: (v) => <Tag color={statusColor(v)}>{v}</Tag> },
        { title: L("สาขา / mapping พร้อม", "Branches / verified"), render: (_, r) => `${r.locationCount} / ${r.verifiedMappingCount}` },
        { title: L("Credential", "Credential"), render: (_, r) => [r.accessTokenMasked, r.clientSecretMasked].filter(Boolean).join(" · ") || "—" },
        { title: "", render: (_, r) => canManageIntegration ? <Space><Button size="small" onClick={async () => {
          try { await jsonFetch("/api/bms/delivery/integrations", { method:"POST", body:JSON.stringify({ action:"test", integrationId:r.id }) }); message.success(L("เชื่อมต่อสำเร็จ", "Connection succeeded")); await load(); }
          catch (e:any) { message.error(e?.message ?? L("ตรวจไม่ผ่าน", "Connection check failed")); }
        }}>{L("ทดสอบ", "Test")}</Button><Button size="small" onClick={() => {
          integrationForm.setFieldsValue({ ...r, configJson: JSON.stringify(r.config ?? {}, null, 2), credentialExpiresAt: r.credentialExpiresAt ? dayjs(r.credentialExpiresAt).format("YYYY-MM-DDTHH:mm:ssZ") : undefined }); setIntegrationOpen(true);
        }}>{L("แก้ไข", "Edit")}</Button></Space> : null },
      ]} />
    </Card>
    <Card title={L("Capability matrix (จาก official contract)", "Capability matrix (official-contract based)")}>
      <Table rowKey={(r) => r.provider} pagination={false} dataSource={boot.integrations.map((i) => ({ provider: i.provider, ...i.capabilities }))}
        columns={["provider","webhookOrders","fetchOrder","acceptOrder","rejectOrder","markReady","pauseStore","setItemAvailability","fetchMenu","fetchSettlement"].map((key) => ({ title:key, dataIndex:key, render:(v) => key === "provider" ? v : <Tag color={v === "VERIFIED" ? "green" : v === "NOT_PUBLIC" ? "red" : "orange"}>{v}</Tag> }))} />
    </Card>
  </Space>;

  const mappings = <Space direction="vertical" size="large" style={{ width:"100%" }}>
    <Card title={L("จับคู่สาขา", "Branch mappings")} extra={canManageMapping && <Button icon={<PlusOutlined />} onClick={() => { locationForm.resetFields(); locationForm.setFieldsValue({ active:true, timezone:"Asia/Bangkok" }); setLocationOpen(true); }}>{L("เพิ่ม", "Add")}</Button>}>
      <Table rowKey="id" dataSource={boot.mappings.locations} pagination={false} columns={[
        { title:"Provider", dataIndex:"provider" }, { title:L("Provider store", "Provider store"), dataIndex:"provider_store_id" },
        { title:L("สาขา BMS", "BMS location"), dataIndex:"location_name" }, { title:"Timezone", dataIndex:"timezone" },
        { title:L("สถานะ", "Status"), dataIndex:"active", render:(v) => <Tag color={v ? "green" : "default"}>{v ? L("ใช้งาน", "Active") : L("ปิด", "Disabled")}</Tag> },
      ]} />
    </Card>
    <Card title={L("จับคู่เมนู / variant / modifier", "Menu / variant / modifier mappings")} extra={canManageMapping && <Button icon={<PlusOutlined />} onClick={() => { menuForm.resetFields(); menuForm.setFieldsValue({ mappingKind:"ITEM", mappingStatus:"UNMAPPED" }); setMenuOpen(true); }}>{L("เพิ่ม", "Add")}</Button>}>
      <Table rowKey="id" dataSource={boot.mappings.menus} scroll={{ x: 1000 }} columns={[
        { title:L("ชื่อบน provider", "Provider name"), dataIndex:"provider_name_snapshot" },
        { title:L("ชนิด", "Kind"), dataIndex:"mapping_kind" }, { title:L("Provider ID", "Provider ID"), dataIndex:"provider_item_id" },
        { title:L("เป้าหมาย BMS", "BMS target"), render:(_,r) => [r.product_sku,r.size,r.modifier_code].filter(Boolean).join(" / ") || "—" },
        { title:L("สถานะ", "Status"), dataIndex:"mapping_status", render:(v) => <Tag color={statusColor(v)}>{v}</Tag> },
      ]} />
    </Card>
  </Space>;

  const operations = <Space direction="vertical" size="large" style={{ width:"100%" }}>
    <Card title={L("เหตุการณ์ที่ต้องตรวจ", "Events requiring review")}>
      <Table rowKey="id" dataSource={boot.operations.events} columns={[
        { title:"Provider", dataIndex:"provider" }, { title:L("ออเดอร์", "Order"), dataIndex:"provider_order_id" },
        { title:L("Event", "Event"), dataIndex:"event_type" }, { title:L("สถานะ", "Status"), dataIndex:"processing_status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
        { title:L("ข้อผิดพลาด", "Error"), dataIndex:"last_error" },
        { title:"", render:(_,r) => can("restaurant.delivery.review") && <Button size="small" onClick={() => void retry("event",r.id)}>{L("ลองใหม่", "Retry")}</Button> },
      ]} />
    </Card>
    <Card title={L("คำสั่งที่ยังไม่ยืนยัน", "Unconfirmed provider commands")}>
      <Table rowKey="id" dataSource={boot.operations.commands} columns={[
        { title:"Provider", dataIndex:"provider" }, { title:L("คำสั่ง", "Command"), dataIndex:"command_type" },
        { title:L("สถานะ", "Status"), dataIndex:"status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
        { title:L("ครั้ง", "Attempts"), dataIndex:"attempts" }, { title:L("ข้อผิดพลาด", "Error"), dataIndex:"last_error" },
        { title:"", render:(_,r) => canManageIntegration && ["FAILED","MANUAL_ACTION_REQUIRED"].includes(r.status) && <Button size="small" onClick={() => void retry("command",r.id)}>{L("ลองใหม่", "Retry")}</Button> },
      ]} />
    </Card>
    <Card title={L("ออเดอร์และ timeline ล่าสุด", "Recent orders and timeline")}>
      <Table rowKey="id" dataSource={boot.operations.orders} expandable={{ expandedRowRender:(r) => <pre style={{ whiteSpace:"pre-wrap", margin:0 }}>{JSON.stringify(r.timeline ?? [], null, 2)}</pre> }} columns={[
        { title:"Provider", dataIndex:"provider" }, { title:L("เลขออเดอร์", "Order no."), render:(_,r)=>r.provider_display_number || r.provider_order_id },
        { title:L("สาขา", "Location"), dataIndex:"location_name" }, { title:L("Local", "Local"), dataIndex:"local_status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
        { title:L("Provider", "Provider"), dataIndex:"provider_status" }, { title:L("หมดเวลารับ", "Accept by"), dataIndex:"acceptance_deadline", render:(v)=>v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—" },
      ]} />
    </Card>
  </Space>;

  const finance = !canViewFinance ? <Alert closable type="warning" showIcon message={L("ไม่มีสิทธิ์ delivery.settlement.view", "Missing delivery.settlement.view permission")} /> : <Space direction="vertical" size="large" style={{ width:"100%" }}>
    <Alert closable type="info" showIcon message={L("Settlement ไม่แก้ payment หรือยอดขายย้อนหลัง", "Settlement never rewrites payment or historical sales")}
      description={L("การนำเข้า manual จะจับคู่ provider order, สร้างรายการ missing/mismatch และ adjustment แยกเป็น ledger ใหม่", "Manual import matches provider orders, records missing/mismatch lines, and keeps adjustments in an append-only ledger.")} />
    <Card title={L("Settlement", "Settlements")} extra={canManageFinance && <Button type="primary" icon={<PlusOutlined />} onClick={() => { settlementForm.resetFields(); settlementForm.setFieldsValue({ currency:"THB", discountAmount:0, commissionAmount:0, linesJson:'[\n  {"providerOrderId":"","grossAmount":0,"feeAmount":0,"refundAmount":0,"adjustmentAmount":0,"actualNetAmount":0}\n]' }); setSettlementOpen(true); }}>{L("นำเข้า manual", "Manual import")}</Button>}>
      <Table rowKey="id" dataSource={boot.finance.settlements} expandable={{ expandedRowRender:(r) => <Table size="small" pagination={false} rowKey="id" dataSource={boot.finance.lines.filter((l)=>l.settlement_id===r.id)} columns={[
        { title:L("Provider order", "Provider order"), dataIndex:"provider_order_id" }, { title:L("ยอดจริง", "Actual net"), dataIndex:"actual_net_amount" },
        { title:L("ผลกระทบยอด", "Reconciliation"), dataIndex:"reconciliation_status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
      ]} /> }} columns={[
        { title:"Provider", dataIndex:"provider" }, { title:L("Statement", "Statement"), dataIndex:"statement_reference" },
        { title:L("ช่วง", "Period"), render:(_,r)=>`${dayjs(r.period_start).format("YYYY-MM-DD")} – ${dayjs(r.period_end).format("YYYY-MM-DD")}` },
        { title:L("คาดการณ์", "Expected"), dataIndex:"expected_net_amount" }, { title:L("รับจริง", "Actual"), dataIndex:"actual_net_amount" },
        { title:L("สถานะ", "Status"), dataIndex:"status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
      ]} />
    </Card>
    <Row gutter={16}><Col xs={24} xl={12}><Card title={L("Adjustment ledger", "Adjustment ledger")} extra={canManageFinance ? <Button size="small" icon={<PlusOutlined />} onClick={() => {
      adjustmentForm.resetFields(); adjustmentForm.setFieldsValue({ currency:"THB", effectiveAt:dayjs(), adjustmentType:"PROVIDER_CORRECTION" }); setAdjustmentOpen(true);
    }}>{L("บันทึก", "Record")}</Button> : null}><Table size="small" rowKey="id" dataSource={boot.finance.adjustments} columns={[
      { title:L("ชนิด", "Type"), dataIndex:"adjustment_type" }, { title:L("จำนวน", "Amount"), render:(_,r)=>`${r.currency} ${r.amount}` }, { title:L("ออเดอร์", "Order"), dataIndex:"provider_order_id" }, { title:L("เหตุผล", "Reason"), dataIndex:"reason" },
    ]} /></Card></Col><Col xs={24} xl={12}><Card title={L("Disputes", "Disputes")} extra={canManageDispute ? <Button size="small" icon={<PlusOutlined />} onClick={() => {
      disputeForm.resetFields(); disputeForm.setFieldsValue({ currency:"THB", claimedAmount:0 }); setDisputeOpen(true);
    }}>{L("สร้าง", "Create")}</Button> : null}><Table size="small" rowKey="id" dataSource={boot.finance.disputes} columns={[
      { title:L("ออเดอร์", "Order"), dataIndex:"provider_order_id" }, { title:L("จำนวน", "Claim"), render:(_,r)=>`${r.currency} ${r.claimed_amount}` }, { title:L("สถานะ", "Status"), dataIndex:"status", render:(v)=><Tag color={statusColor(v)}>{v}</Tag> },
      { title:"", render:(_,r) => canManageDispute && !["WON","LOST","CANCELLED"].includes(r.status) ? <Select size="small" style={{width:145}} placeholder={L("เปลี่ยนสถานะ", "Transition")} onChange={(status)=>void transitionDispute(r,status)} options={(r.status === "DRAFT" ? ["SUBMITTED","CANCELLED"] : r.status === "SUBMITTED" ? ["UNDER_REVIEW","WON","LOST","CANCELLED"] : ["WON","LOST","CANCELLED"]).map(value=>({value,label:value}))} /> : null },
    ]} /></Card></Col></Row>
  </Space>;

  return <Space direction="vertical" size="large" style={{ width:"100%" }}>
    <AdminPageHeader title={L("แพลตฟอร์มเดลิเวอรี", "Delivery platforms")}><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{L("รีเฟรช", "Refresh")}</Button></AdminPageHeader>
    <Tabs activeKey={activeTab} onChange={(key) => { setActiveTab(key); history.replaceState(null,"",`?tab=${key}`); }} items={[
      { key:"integrations", label:L("การเชื่อมต่อ", "Integrations"), children:integrations },
      { key:"mappings", label:L("Mapping", "Mappings"), children:mappings },
      { key:"operations", label:L("ปฏิบัติการ", "Operations"), children:operations },
      { key:"finance", label:L("การเงิน", "Finance"), children:finance },
    ]} />

    <Modal open={integrationOpen} title={L("ตั้งค่าการเชื่อมต่อ", "Configure integration")} onCancel={()=>setIntegrationOpen(false)} onOk={()=>void saveIntegration()} width={760} okText={L("บันทึก", "Save")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={integrationForm} layout="vertical"><Form.Item name="id" hidden><Input /></Form.Item><Row gutter={12}>
        <Col span={8}><Form.Item name="provider" label="Provider" rules={[{required:true}]}><Select options={["FOODPANDA","GRABFOOD","LINEMAN"].map(value=>({value}))} disabled={Boolean(integrationForm.getFieldValue("id"))} /></Form.Item></Col>
        <Col span={8}><Form.Item name="environment" label={L("สภาพแวดล้อม", "Environment")} rules={[{required:true}]}><Select options={["SANDBOX","LIVE"].map(value=>({value}))} disabled={Boolean(integrationForm.getFieldValue("id"))} /></Form.Item></Col>
        <Col span={8}><Form.Item name="rolloutMode" label="Rollout" rules={[{required:true}]}><Select options={["OFF","SHADOW","LIVE"].map(value=>({value}))} /></Form.Item></Col>
      </Row><Row gutter={12}><Col span={12}><Form.Item name="active" label={L("เปิด integration", "Integration enabled")} valuePropName="checked"><Switch /></Form.Item></Col><Col span={12}><Form.Item name="outboundCommandsEnabled" label={L("เปิด outbound command", "Outbound commands enabled")} valuePropName="checked"><Switch /></Form.Item></Col></Row>
      <Form.Item name="clientId" label="Client ID"><Input /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="clientSecret" label={L("Client secret (เว้นว่างเพื่อคงเดิม)", "Client secret (blank keeps current)")}><Input.Password /></Form.Item></Col><Col span={12}><Form.Item name="accessToken" label={L("Access token (เว้นว่างเพื่อคงเดิม)", "Access token (blank keeps current)")}><Input.Password /></Form.Item></Col></Row>
      <Row gutter={12}><Col span={12}><Form.Item name="refreshToken" label={L("Refresh token (เว้นว่างเพื่อคงเดิม)", "Refresh token (blank keeps current)")}><Input.Password /></Form.Item></Col><Col span={12}><Form.Item name="webhookSecret" label={L("Webhook secret (เว้นว่างเพื่อคงเดิม)", "Webhook secret (blank keeps current)")}><Input.Password /></Form.Item></Col></Row>
      <Row gutter={12}><Col span={12}><Form.Item name="apiVersion" label="API version"><Input /></Form.Item></Col><Col span={12}><Form.Item name="credentialExpiresAt" label={L("Credential หมดอายุ", "Credential expires at")}><Input placeholder="2027-01-31T00:00:00+07:00" /></Form.Item></Col></Row>
      <Form.Item name="configJson" label={L("Config ที่ไม่ใช่ secret (JSON)", "Non-secret config (JSON)")}><Input.TextArea rows={6} /></Form.Item></Form>
    </Modal>

    <Modal open={locationOpen} title={L("จับคู่สาขา", "Map provider store")} onCancel={()=>setLocationOpen(false)} onOk={()=>void saveLocationMapping()} okText={L("บันทึก", "Save")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={locationForm} layout="vertical"><Form.Item name="integrationId" label="Integration" rules={[{required:true}]}><Select options={integrationOptions} /></Form.Item>
      <Form.Item name="providerStoreId" label="Provider store ID" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="providerStoreName" label="Provider store name"><Input /></Form.Item>
      <Form.Item name="locationId" label={L("สาขา BMS", "BMS location")} rules={[{required:true}]}><Select options={boot.mappings.availableLocations.map(l=>({value:l.id,label:`${l.name} · ${l.code}`}))} /></Form.Item>
      <Form.Item name="timezone" label="Timezone" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="active" label={L("ใช้งาน", "Active")} valuePropName="checked"><Switch /></Form.Item></Form>
    </Modal>

    <Modal open={menuOpen} title={L("จับคู่เมนู", "Map menu item")} onCancel={()=>setMenuOpen(false)} onOk={()=>void saveMenuMapping()} okText={L("บันทึก", "Save")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={menuForm} layout="vertical"><Form.Item name="integrationId" label="Integration" rules={[{required:true}]}><Select options={integrationOptions} /></Form.Item>
      <Form.Item name="locationMappingId" label={L("Provider store mapping", "Provider store mapping")} rules={[{required:true}]}><Select options={boot.mappings.locations.map(l=>({value:l.id,label:`${l.provider} · ${l.provider_store_name || l.provider_store_id} → ${l.location_name}`}))} /></Form.Item>
      <Row gutter={12}><Col span={12}><Form.Item name="mappingKind" label={L("ชนิด", "Kind")} rules={[{required:true}]}><Select options={["ITEM","VARIANT","MODIFIER"].map(value=>({value}))} /></Form.Item></Col><Col span={12}><Form.Item name="mappingStatus" label={L("สถานะ", "Status")} rules={[{required:true}]}><Select options={["UNMAPPED","SUGGESTED","VERIFIED","STALE","DISABLED"].map(value=>({value}))} /></Form.Item></Col></Row>
      <Form.Item name="providerName" label={L("ชื่อบน provider", "Provider name")} rules={[{required:true}]}><Input /></Form.Item><Form.Item name="providerItemId" label="Provider item ID" rules={[{required:true}]}><Input /></Form.Item>
      <Row gutter={12}><Col span={12}><Form.Item name="providerVariantId" label="Provider variant ID"><Input /></Form.Item></Col><Col span={12}><Form.Item name="providerModifierId" label="Provider modifier ID"><Input /></Form.Item></Col></Row>
      <Form.Item name="catalogTarget" label={L("สินค้าและ variant ใน BMS", "BMS product and variant")}><Select showSearch optionFilterProp="label" options={catalogOptions} /></Form.Item>
      <Form.Item name="modifierCode" label={L("Modifier code ใน BMS", "BMS modifier code")}><Input /></Form.Item><Form.Item name="providerPrice" label={L("ราคา snapshot", "Price snapshot")}><InputNumber min={0} precision={2} style={{width:"100%"}} /></Form.Item>
      <Typography.Text type="secondary">{L("สถานะ VERIFIED จะผ่านได้ต่อเมื่อ product/variant เปิดขายบน ONLINE_ORDER และ modifier code มีจริง", "VERIFIED requires an active ONLINE_ORDER product/variant and an existing modifier code.")}</Typography.Text></Form>
    </Modal>

    <Modal open={settlementOpen} title={L("นำเข้า settlement แบบ manual", "Import manual settlement")} onCancel={()=>setSettlementOpen(false)} onOk={()=>void importSettlement()} width={760} okText={L("นำเข้า", "Import")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={settlementForm} layout="vertical"><Form.Item name="integrationId" label="Integration" rules={[{required:true}]}><Select options={integrationOptions} /></Form.Item>
      <Form.Item name="statementReference" label={L("เลขอ้างอิง statement", "Statement reference")} rules={[{required:true}]}><Input /></Form.Item><Form.Item name="period" label={L("ช่วง settlement", "Settlement period")} rules={[{required:true}]}><DatePicker.RangePicker showTime style={{width:"100%"}} /></Form.Item>
      <Row gutter={12}><Col span={8}><Form.Item name="currency" label={L("สกุลเงิน", "Currency")} rules={[{required:true}]}><Input maxLength={3} /></Form.Item></Col><Col span={8}><Form.Item name="discountAmount" label={L("ส่วนลดรวม", "Discounts")}><InputNumber min={0} precision={2} style={{width:"100%"}} /></Form.Item></Col><Col span={8}><Form.Item name="commissionAmount" label={L("Commission", "Commission")}><InputNumber min={0} precision={2} style={{width:"100%"}} /></Form.Item></Col></Row>
      <Form.Item name="linesJson" label={L("รายการ (JSON สูงสุด 500 บรรทัด)", "Lines (JSON, max 500)")} rules={[{required:true}]}><Input.TextArea rows={10} /></Form.Item></Form>
    </Modal>

    <Modal open={adjustmentOpen} title={L("บันทึก adjustment", "Record adjustment")} onCancel={()=>setAdjustmentOpen(false)} onOk={()=>void saveAdjustment()} okText={L("บันทึก", "Record")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={adjustmentForm} layout="vertical"><Form.Item name="integrationId" label="Integration" rules={[{required:true}]}><Select options={integrationOptions} /></Form.Item>
      <Form.Item name="deliveryOrderId" label={L("Delivery order (ไม่บังคับ)", "Delivery order (optional)")}><Select allowClear showSearch optionFilterProp="label" options={boot.operations.orders.map(o=>({value:o.id,label:`${o.provider} · ${o.provider_display_number || o.provider_order_id}`}))} /></Form.Item>
      <Form.Item name="settlementLineId" label={L("Settlement line (ไม่บังคับ)", "Settlement line (optional)")}><Select allowClear showSearch optionFilterProp="label" options={boot.finance.lines.map(l=>({value:l.id,label:`${l.statement_reference} · ${l.provider_order_id}`}))} /></Form.Item>
      <Row gutter={12}><Col span={12}><Form.Item name="adjustmentType" label={L("ชนิด", "Type")} rules={[{required:true}]}><Select options={["CHARGEBACK","PENALTY","REFUND","PROVIDER_CORRECTION","APPEAL_RESULT"].map(value=>({value}))} /></Form.Item></Col><Col span={12}><Form.Item name="effectiveAt" label={L("วันที่มีผล", "Effective at")} rules={[{required:true}]}><DatePicker showTime style={{width:"100%"}} /></Form.Item></Col></Row>
      <Row gutter={12}><Col span={16}><Form.Item name="amount" label={L("จำนวน (ติดลบได้)", "Amount (negative allowed)")} rules={[{required:true}]}><InputNumber precision={2} style={{width:"100%"}} /></Form.Item></Col><Col span={8}><Form.Item name="currency" label={L("สกุลเงิน", "Currency")} rules={[{required:true}]}><Input maxLength={3} /></Form.Item></Col></Row>
      <Form.Item name="providerReference" label={L("Provider reference", "Provider reference")}><Input /></Form.Item><Form.Item name="reason" label={L("เหตุผล", "Reason")} rules={[{required:true}]}><Input.TextArea rows={3} /></Form.Item></Form>
    </Modal>

    <Modal open={disputeOpen} title={L("สร้าง dispute", "Create dispute")} onCancel={()=>setDisputeOpen(false)} onOk={()=>void saveDispute()} okText={L("สร้าง", "Create")} cancelText={L("ยกเลิก", "Cancel")}>
      <Form form={disputeForm} layout="vertical"><Form.Item name="integrationId" label="Integration" rules={[{required:true}]}><Select options={integrationOptions} /></Form.Item>
      <Form.Item name="deliveryOrderId" label={L("Delivery order (ไม่บังคับ)", "Delivery order (optional)")}><Select allowClear showSearch optionFilterProp="label" options={boot.operations.orders.map(o=>({value:o.id,label:`${o.provider} · ${o.provider_display_number || o.provider_order_id}`}))} /></Form.Item>
      <Form.Item name="providerCaseId" label={L("Provider case ID (ไม่บังคับ)", "Provider case ID (optional)")}><Input /></Form.Item>
      <Row gutter={12}><Col span={16}><Form.Item name="claimedAmount" label={L("ยอดเรียกร้อง", "Claimed amount")} rules={[{required:true}]}><InputNumber min={0} precision={2} style={{width:"100%"}} /></Form.Item></Col><Col span={8}><Form.Item name="currency" label={L("สกุลเงิน", "Currency")} rules={[{required:true}]}><Input maxLength={3} /></Form.Item></Col></Row>
      <Form.Item name="reason" label={L("เหตุผลและหลักฐานอ้างอิง", "Reason and evidence references")} rules={[{required:true}]}><Input.TextArea rows={4} /></Form.Item></Form>
    </Modal>
  </Space>;
}
