"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18nContext";

type Row = { code: string; nameTh: string; nameEn:string; postcode?: string | null };
async function rows(params: URLSearchParams): Promise<Row[]> {
  const response = await fetch(`/api/public/thai-addresses?${params}`);
  if (!response.ok) return [];
  return (await response.json()).rows ?? [];
}

export default function PublicThaiAddressSelects({ required = true }: { required?: boolean }) {
  const { t, lang } = useI18n();
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [subdistrict, setSubdistrict] = useState("");
  const [postcode, setPostcode] = useState("");
  const [provinces, setProvinces] = useState<Row[]>([]);
  const [districts, setDistricts] = useState<Row[]>([]);
  const [subdistricts, setSubdistricts] = useState<Row[]>([]);
  useEffect(() => { void rows(new URLSearchParams({ level: "PROVINCE" })).then(setProvinces); }, []);
  useEffect(() => { setDistrict(""); setSubdistrict(""); setSubdistricts([]); setPostcode("");
    if (province) void rows(new URLSearchParams({ level: "DISTRICT", provinceCode: province })).then(setDistricts);
    else setDistricts([]);
  }, [province]);
  useEffect(() => { setSubdistrict(""); setSubdistricts([]); setPostcode("");
    if (district) void rows(new URLSearchParams({ level: "SUBDISTRICT", districtCode: district })).then(setSubdistricts);
  }, [district]);
  return <>
    <label><span>{t("admin_master_data.province")}</span><select name="provinceCode" required={required} value={province} onChange={event => setProvince(event.target.value)}>
      <option value="">{t("admin_master_data.select_province")}</option>{provinces.map(row => <option key={row.code} value={row.code}>{lang === "en" ? row.nameEn : row.nameTh}</option>)}
    </select></label>
    <label><span>{t("admin_master_data.district")}</span><select name="districtCode" required={required} disabled={!province} value={district} onChange={event => setDistrict(event.target.value)}>
      <option value="">{t("admin_master_data.select_district")}</option>{districts.map(row => <option key={row.code} value={row.code}>{lang === "en" ? row.nameEn : row.nameTh}</option>)}
    </select></label>
    <label><span>{t("admin_master_data.subdistrict")}</span><select name="subdistrictCode" required={required} disabled={!district} value={subdistrict} onChange={event => {
      setSubdistrict(event.target.value);
      setPostcode(subdistricts.find(row => row.code === event.target.value)?.postcode ?? "");
    }}>
      <option value="">{t("admin_master_data.select_subdistrict")}</option>{subdistricts.map(row => <option key={row.code} value={row.code}>{lang === "en" ? row.nameEn : row.nameTh}</option>)}
    </select></label>
    <label><span>{t("admin_master_data.postcode")}</span><input name="postcode" readOnly required={required} value={postcode} /></label>
  </>;
}
