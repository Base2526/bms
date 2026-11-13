"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
import { Form, Input, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18nContext";

type Row = { code: string; provinceCode?: string | null; districtCode?: string | null; nameTh: string; nameEn: string; postcode?: string | null };
type Props = {
  form: any;
  required?: boolean;
  provinceName?: string;
  districtName?: string;
  subdistrictName?: string;
  postcodeName?: string;
};

async function load(params: URLSearchParams, uiText: UiTranslator = thaiUiText): Promise<Row[]> {
  const response = await fetch(`/api/public/thai-addresses?${params}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(uiText("admin_ui.could_not_load_address_data_9fcbe"));
  return (await response.json()).rows ?? [];
}

export default function ThaiAddressFields({
  form, required = false, provinceName = "provinceCode", districtName = "districtCode",
  subdistrictName = "subdistrictCode", postcodeName = "postcode",
}: Props) {
  const uiText = useUiText();
  const { t, lang } = useI18n();
  const provinceCode = Form.useWatch(provinceName, form);
  const districtCode = Form.useWatch(districtName, form);
  const [provinces, setProvinces] = useState<Row[]>([]);
  const [districts, setDistricts] = useState<Row[]>([]);
  const [subdistricts, setSubdistricts] = useState<Row[]>([]);
  useEffect(() => { void load(new URLSearchParams({ level: "PROVINCE" }), uiText).then(setProvinces).catch(() => setProvinces([])); }, []);
  useEffect(() => {
    if (!provinceCode) return void setDistricts([]);
    void load(new URLSearchParams({ level: "DISTRICT", provinceCode }), uiText).then(setDistricts).catch(() => setDistricts([]));
  }, [provinceCode]);
  useEffect(() => {
    if (!districtCode) return void setSubdistricts([]);
    void load(new URLSearchParams({ level: "SUBDISTRICT", districtCode }), uiText).then(setSubdistricts).catch(() => setSubdistricts([]));
  }, [districtCode]);
  const rules = required ? [{ required: true, message: t("admin_master_data.address_required") }] : undefined;
  return <Space wrap align="start">
    <Form.Item name={provinceName} label={t("admin_master_data.province")} rules={rules}>
      <Select allowClear showSearch optionFilterProp="label" style={{ width: 180 }}
        options={provinces.map(row => ({ value: row.code, label: lang === "en" ? row.nameEn : row.nameTh }))}
        onChange={() => form.setFieldsValue({ [districtName]: null, [subdistrictName]: null, [postcodeName]: null })} />
    </Form.Item>
    <Form.Item name={districtName} label={t("admin_master_data.district")} rules={rules}>
      <Select allowClear showSearch optionFilterProp="label" disabled={!provinceCode} style={{ width: 180 }}
        options={districts.map(row => ({ value: row.code, label: lang === "en" ? row.nameEn : row.nameTh }))}
        onChange={() => form.setFieldsValue({ [subdistrictName]: null, [postcodeName]: null })} />
    </Form.Item>
    <Form.Item name={subdistrictName} label={t("admin_master_data.subdistrict")} rules={rules}>
      <Select allowClear showSearch optionFilterProp="label" disabled={!districtCode} style={{ width: 180 }}
        options={subdistricts.map(row => ({ value: row.code, label: lang === "en" ? row.nameEn : row.nameTh }))}
        onChange={(code) => form.setFieldValue(postcodeName, subdistricts.find(row => row.code === code)?.postcode ?? null)} />
    </Form.Item>
    <Form.Item name={postcodeName} label={t("admin_master_data.postcode")} rules={rules}>
      <Input readOnly style={{ width: 130 }} />
    </Form.Item>
  </Space>;
}
