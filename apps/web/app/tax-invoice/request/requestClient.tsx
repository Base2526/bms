"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import TaxInvoiceCopy from "@/components/pos/TaxInvoiceCopy";
import { useI18n } from "@/lib/i18nContext";
import { TAX_BUYER_TYPES, THAI_PROVINCES } from "@/lib/taxRequestFields";

const labels: Record<string, string> = {
  PENDING: "รอร้านตรวจสอบ",
  NEEDS_INFO: "กรุณาแก้ไข/เพิ่มข้อมูล",
  REJECTED: "ร้านไม่อนุมัติคำขอ",
  ISSUED: "ออกใบกำกับภาษีแล้ว",
  DOCUMENT_CANCELLED: "เอกสารถูกยกเลิก กรุณาติดต่อร้าน",
};
async function call(body: object) {
  const res = await fetch("/api/bms/tax-invoice-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const value = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(value.error || "ดำเนินการไม่สำเร็จ"), {
      status: res.status,
    });
  return value;
}
export default function TaxInvoiceRequestClient() {
  const { t } = useI18n();
  // Scanners/back navigation can open another fragment in the same tab without remounting.
  useEffect(() => {
    const reopen = () => window.location.reload();
    window.addEventListener("hashchange", reopen);
    return () => window.removeEventListener("hashchange", reopen);
  }, []);
  const [form] = Form.useForm();
  const buyerType = Form.useWatch("buyerType", form);
  const [choosingType, setChoosingType] = useState(true);
  const [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [access, setAccess] = useState("");
  const [receipt, setReceipt] = useState<any>(null),
    [request, setRequest] = useState<any>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  async function loadTracking(key: string, fill = false) {
    const r = await call({ action: "track", access: key });
    setRequest(r);
    if (fill) {
      form.setFieldsValue({
        ...r.buyer,
        buyerType: r.buyer.buyerType ?? "COMPANY",
        addressLine1: r.buyer.addressLine1 ?? r.buyer.address,
        addressLine2: r.buyer.addressLine2 ?? "",
        province: r.buyer.province ?? undefined,
        postcode: r.buyer.postcode ?? "",
        email: r.buyer.email ?? "",
      });
      setChoosingType(false);
      setFormVersion(r.version);
    }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fragment = location.hash.slice(1);
        if (fragment.startsWith("track=")) {
          const key = fragment.slice(6);
          if (alive) {
            setAccess(key);
            await loadTracking(key, true);
          }
          return;
        }
        if (!fragment) throw new Error("กรุณาสแกน QR บนใบเสร็จของร้าน");
        const storageKey = `bms-tax-request:${fragment}`;
        let key = sessionStorage.getItem(storageKey);
        if (!key) {
          key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
            v.toString(16).padStart(2, "0")
          ).join("");
          sessionStorage.setItem(storageKey, key);
        }
        if (alive) {
          setToken(fragment);
          setSecret(key);
        }
        const recovered = await call({
          action: "recover",
          token: fragment,
          accessSecret: key,
        });
        if (recovered.access) {
          if (alive) {
            setAccess(recovered.access);
            history.replaceState(null, "", `#track=${recovered.access}`);
            await loadTracking(recovered.access, true);
          }
          return;
        }
        const info = await call({ action: "inspect", token: fragment });
        if (alive) setReceipt(info);
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!access) return;
    const timer = setInterval(() => {
      void loadTracking(access).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [access]);
  const submit = async (buyer: any) => {
    setSaving(true);
    setError("");
    try {
      if (access) {
        await call({ action: "revise", access, version: formVersion, buyer });
        await loadTracking(access, true);
      } else {
        const result = await call({
          action: "submit",
          token,
          buyer,
          accessSecret: secret,
        });
        setAccess(result.access);
        history.replaceState(null, "", `#track=${result.access}`);
        await loadTracking(result.access, true);
      }
      message.success("ส่งคำขอให้ร้านแล้ว");
    } catch (e: any) {
      setError(e.message);
      if (access) await loadTracking(access).catch(() => {});
      else if (e.status === 410) setReceipt(null);
    } finally {
      setSaving(false);
    }
  };
  const policy = request?.policy ?? receipt?.policy;
  return (
    <main style={{ maxWidth: 850, margin: "24px auto", padding: 16 }}>
      <div className="tax-request-controls">
        <Typography.Title level={2}>ขอใบกำกับภาษีเต็มรูป</Typography.Title>
        <Alert
          showIcon
          type="info"
          message="ร้านจะตรวจข้อมูลก่อนออกเอกสาร กรุณาเก็บใบเสร็จไว้ การส่งคำขอนี้ยังไม่ใช่การออก e-Tax"
        />
        {error && (
          <Alert
            showIcon
            type="error"
            message={error}
            style={{ marginTop: 12 }}
          />
        )}
        <section aria-busy={loading} style={{ marginTop: 24 }}>
          {loading && <p role="status">กำลังโหลดข้อมูลใบเสร็จ…</p>}
          <p>{t("tax_requests.online_policy")}</p>
          {policy && (
            <>
              <p>
                {t("tax_requests.deadline")}:{" "}
                {new Date(policy.expiresAt).toLocaleString("th-TH", {
                  timeZone: "Asia/Bangkok",
                })}{" "}
                (UTC+7)
                <br />
                {t("tax_requests.usage")}: {policy.submissions}/
                {policy.maxSubmissions} · {t("tax_requests.remaining")}:{" "}
                {policy.remaining}
              </p>
              {["PENDING", "NEEDS_INFO"].includes(request?.status) &&
                !policy.canSubmit && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t(
                      policy.expired
                        ? "tax_requests.expired"
                        : "tax_requests.exhausted"
                    )}
                  />
                )}
            </>
          )}
          {receipt && !access && (
            <p>
              {receipt.storeName} · ใบเสร็จ {receipt.documentNo} ·{" "}
              {Number(receipt.total).toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })}{" "}
              บาท
            </p>
          )}
          {request && (
            <>
              <Typography.Title level={4}>
                {labels[request.status] ?? request.status}
              </Typography.Title>
              {request.feedback && (
                <Alert showIcon type="warning" message={request.feedback} />
              )}
            </>
          )}
          {access && (
            <Space
              direction="vertical"
              style={{ width: "100%", marginBottom: 16 }}
            >
              <Alert
                type="warning"
                showIcon
                message="บันทึกลิงก์ติดตามส่วนตัวไว้ ผู้ที่มีลิงก์นี้สามารถดูข้อมูลผู้เสียภาษีของคุณได้ ห้ามส่งต่อสาธารณะ"
              />
              <Button
                onClick={() =>
                  navigator.clipboard
                    .writeText(location.href)
                    .then(() => message.success("คัดลอกลิงก์แล้ว"))
                    .catch(() =>
                      message.error("คัดลอกไม่สำเร็จ กรุณาคัดลอกจากแถบที่อยู่")
                    )
                }
              >
                คัดลอกลิงก์ติดตามส่วนตัว
              </Button>
              <Button
                onClick={() =>
                  loadTracking(access, true).catch((e) => setError(e.message))
                }
              >
                โหลดสถานะและข้อมูลล่าสุด
              </Button>
            </Space>
          )}
          {request?.buyer &&
            ["PENDING", "NEEDS_INFO"].includes(request.status) &&
            !policy?.canSubmit && (
              <p>
                {request.buyer.name}
                <br />
                {request.buyer.taxId} · {request.buyer.branchCode}
                <br />
                {request.buyer.address}
              </p>
            )}
          {policy?.canSubmit &&
            ((receipt && !access) ||
              ["PENDING", "NEEDS_INFO"].includes(request?.status)) && (
              <Form
                form={form}
                layout="vertical"
                onFinish={submit}
                initialValues={{ branchCode: "00000" }}
                disabled={saving}
                size="large"
              >
                <Form.Item name="buyerType" label="ออกใบกำกับภาษีในนาม" rules={[{ required: true, message: "กรุณาเลือกประเภทผู้ขอ" }]}>
                  <Radio.Group className="tax-buyer-types" onChange={() => setChoosingType(false)}>
                    {TAX_BUYER_TYPES.map((item) => <Radio.Button key={item.value} value={item.value}>{item.label}</Radio.Button>)}
                  </Radio.Group>
                </Form.Item>
                {!choosingType && <>
                <Typography.Title level={4}>ข้อมูล{TAX_BUYER_TYPES.find((item) => item.value === buyerType)?.label}</Typography.Title>
                {buyerType === "FOREIGNER" && <Alert type="info" showIcon style={{ marginBottom: 20 }} message="ช่องทางออนไลน์รองรับผู้มีเลขประจำตัวผู้เสียภาษีไทย 13 หลักและที่อยู่ในประเทศไทย หากไม่มี กรุณาติดต่อร้านเพื่อขอเอกสาร" />}
                <Form.Item
                  name="taxId"
                  label={buyerType === "INDIVIDUAL" ? "เลขประจำตัวผู้เสียภาษี / เลขประจำตัวประชาชน" : "เลขประจำตัวผู้เสียภาษีไทย 13 หลัก"}
                  rules={[{ required: true, pattern: /^\d{13}$/, message: "กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก" }]}
                >
                  <Input inputMode="numeric" maxLength={13} />
                </Form.Item>
                <Form.Item
                  name="name"
                  label={buyerType === "COMPANY" ? "ชื่อบริษัท / นิติบุคคล" : "ชื่อ-นามสกุล"}
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input maxLength={200} />
                </Form.Item>
                {buyerType === "COMPANY" &&
                <Form.Item
                  name="branchCode"
                  label="รหัสสาขา 5 หลัก (สำนักงานใหญ่ 00000)"
                  rules={[{ required: true, pattern: /^\d{5}$/ }]}
                >
                  <Input inputMode="numeric" maxLength={5} />
                </Form.Item>}
                <Form.Item
                  name="addressLine1"
                  label="ที่อยู่ในการออกใบกำกับภาษี (บรรทัดที่ 1)"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input maxLength={500} autoComplete="address-line1" />
                </Form.Item>
                <Form.Item name="addressLine2" label="ที่อยู่ในการออกใบกำกับภาษี (บรรทัดที่ 2)">
                  <Input maxLength={300} autoComplete="address-line2" />
                </Form.Item>
                <Form.Item name="province" label="จังหวัด" rules={[{ required: true, message: "กรุณาเลือกจังหวัด" }]}>
                  <Select showSearch optionFilterProp="label" placeholder="เลือกจังหวัด" options={THAI_PROVINCES.map((province) => ({ value: province, label: province }))} />
                </Form.Item>
                <Form.Item name="postcode" label="รหัสไปรษณีย์" rules={[{ pattern: /^\d{5}$/, message: "กรุณากรอกรหัสไปรษณีย์ 5 หลัก" }]}>
                  <Input inputMode="numeric" maxLength={5} autoComplete="postal-code" />
                </Form.Item>
                <Form.Item name="phone" label="เบอร์โทรศัพท์">
                  <Input type="tel" maxLength={30} autoComplete="tel" />
                </Form.Item>
                <Form.Item name="email" label="อีเมล (สำหรับติดต่อเรื่องการจัดส่งเอกสาร)" rules={[{ required: true, whitespace: true, message: "กรุณากรอกอีเมลสำหรับติดต่อเรื่องการจัดส่งเอกสาร" }, { type: "email", message: "กรุณากรอกอีเมลให้ถูกต้อง" }]}>
                  <Input type="email" maxLength={254} autoComplete="email" />
                </Form.Item>
                <p>
                  ข้อมูลนี้ใช้ตรวจสอบและจัดทำเอกสารภาษีของการซื้อครั้งนี้เท่านั้น
                  กรุณาตรวจสอบให้ถูกต้องก่อนส่ง
                </p>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={saving}>ยืนยันข้อมูลและส่งคำขอ</Button>
                  <Button onClick={() => { form.setFieldValue("buyerType", undefined); setChoosingType(true); }}>ยกเลิก</Button>
                </Space>
                </>}
              </Form>
            )}
          {request?.status === "ISSUED" && (
            <>
              <p>
                ติดต่อร้านเพื่อรับต้นฉบับ สำเนาที่แสดงด้านล่างไม่ใช่ e-Tax
                Invoice
              </p>
              <Button onClick={() => window.print()}>พิมพ์สำเนา</Button>
            </>
          )}
        </section>
      </div>
      {request?.invoice && <TaxInvoiceCopy invoice={request.invoice} />}
      <style jsx global>{`
        .tax-buyer-types { display: flex; flex-wrap: wrap; gap: 8px; }
        .tax-buyer-types .ant-radio-button-wrapper { height: auto; min-height: 40px; white-space: normal; border: 1px solid #d9d9d9; border-radius: 6px; }
        .tax-buyer-types .ant-radio-button-wrapper::before { display: none; }
        @media (max-width: 480px) {
          .tax-buyer-types { flex-direction: column; width: 100%; }
        }
        @media print {
          .tax-request-controls {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}
