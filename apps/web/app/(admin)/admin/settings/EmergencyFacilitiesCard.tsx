"use client";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, message } from "antd";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";

const Q = gql`query EmergencyFacilitiesSettings {
  bmsEmergencyFacilities { id locationId name emergencyPhone address mapUrl has24hEmergency distanceKm sortOrder active }
  bmsEmergencyFacilityLocations { id name }
}`;
const SAVE = gql`mutation SaveEmergencyFacility($input: BmsEmergencyFacilityInput!) {
  bmsUpsertEmergencyFacility(input: $input) { id }
}`;
const DEACTIVATE = gql`mutation DeactivateEmergencyFacility($id: ID!, $confirmed: Boolean!) {
  bmsDeactivateEmergencyFacility(id: $id, confirmed: $confirmed)
}`;
type Row = { id: string; locationId: string | null; name: string; emergencyPhone: string;
  address: string | null; mapUrl: string | null; has24hEmergency: boolean; distanceKm: number | null; sortOrder: number };

export default function EmergencyFacilitiesCard() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(SAVE);
  const [deactivate, { loading: deactivating }] = useMutation(DEACTIVATE);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form] = Form.useForm();
  const locations: Array<{ id: string; name: string }> = data?.bmsEmergencyFacilityLocations ?? [];
  const edit = (row?: Row) => {
    setEditing(row?.id ?? null);
    form.resetFields();
    form.setFieldsValue(row ? { locationId: row.locationId, name: row.name, emergencyPhone: row.emergencyPhone,
      address: row.address, mapUrl: row.mapUrl, has24hEmergency: row.has24hEmergency,
      distanceKm: row.distanceKm, sortOrder: row.sortOrder }
      : { locationId: null, has24hEmergency: false, sortOrder: 0 });
    setOpen(true);
  };
  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    try {
      await save({ variables: { input: { ...values, id: editing, locationId: values.locationId || null,
        address: values.address || null, mapUrl: values.mapUrl || null, distanceKm: values.distanceKm ?? null } } });
      message.success(t("emergency_facilities.saved"));
      setOpen(false);
      await refetch();
    } catch { message.error(t("emergency_facilities.save_error")); }
  };
  return <Card title={t("emergency_facilities.title")}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert closable showIcon type="info" message={t("emergency_facilities.notice")} />
      {error && <Alert closable showIcon type="error" message={t("emergency_facilities.load_error")} />}
      <Space wrap>
        <Button type="primary" onClick={() => edit()}>{t("emergency_facilities.add")}</Button>
        <Button onClick={() => void refetch()} loading={loading}>{t("emergency_facilities.refresh")}</Button>
      </Space>
      <Table<Row> rowKey="id" loading={loading} dataSource={data?.bmsEmergencyFacilities ?? []} scroll={{ x: 700 }} pagination={{ pageSize: 10 }} columns={[
        { title: t("emergency_facilities.name"), dataIndex: "name" },
        { title: t("emergency_facilities.branch"), render: (_, row) => row.locationId
          ? locations.find((l) => l.id === row.locationId)?.name ?? t("emergency_facilities.branch") : t("emergency_facilities.all_branches") },
        { title: t("emergency_facilities.phone"), dataIndex: "emergencyPhone" },
        { title: t("emergency_facilities.emergency24"), render: (_, row) => t(row.has24hEmergency ? "emergency_facilities.yes" : "emergency_facilities.no") },
        { title: t("emergency_facilities.actions"), render: (_, row) => <Space>
          <Button size="small" onClick={() => edit(row)}>{t("emergency_facilities.edit")}</Button>
          <Popconfirm title={t("emergency_facilities.deactivate_confirm")} onConfirm={async () => {
            try { await deactivate({ variables: { id: row.id, confirmed: true } }); await refetch(); }
            catch { message.error(t("emergency_facilities.save_error")); }
          }} okText={t("emergency_facilities.deactivate")} cancelText={t("emergency_facilities.cancel")}>
            <Button size="small" danger loading={deactivating}>{t("emergency_facilities.deactivate")}</Button>
          </Popconfirm>
        </Space> },
      ]} />
    </Space>
    <Modal open={open} title={t("emergency_facilities.title")} onCancel={() => setOpen(false)} onOk={() => void submit()}
      confirmLoading={saving} okText={t("emergency_facilities.save")} cancelText={t("emergency_facilities.cancel")}>
      <Form form={form} layout="vertical">
        <Form.Item name="locationId" label={t("emergency_facilities.branch")}>
          <Select allowClear placeholder={t("emergency_facilities.all_branches")} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        </Form.Item>
        <Form.Item name="name" label={t("emergency_facilities.name")} rules={[{ required: true, message: t("emergency_facilities.required") }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="emergencyPhone" label={t("emergency_facilities.phone")} rules={[{ required: true, pattern: /^[+\d-]{1,30}$/, message: t("emergency_facilities.phone_hint") }]}><Input maxLength={30} /></Form.Item>
        <Form.Item name="address" label={t("emergency_facilities.address")}><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        <Form.Item name="mapUrl" label={t("emergency_facilities.map")} rules={[{ pattern: /^https:\/\/\S+$/, message: t("emergency_facilities.map_hint") }]}><Input maxLength={2048} /></Form.Item>
        <Form.Item name="has24hEmergency" label={t("emergency_facilities.emergency24")} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="distanceKm" label={t("emergency_facilities.distance")}><InputNumber min={0} max={9999.99} precision={2} /></Form.Item>
        <Form.Item name="sortOrder" label={t("emergency_facilities.sort")} rules={[{ required: true, message: t("emergency_facilities.required") }]}><InputNumber precision={0} /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
