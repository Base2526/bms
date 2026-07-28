'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, InputNumber, Button, Space, Tag, message, Form, Divider, Typography, Select, Row, Col, Switch } from "antd";
import { ShopOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";

const { Text } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsStoreProfile {
      businessType aiLanguage aiOrderingStyle aiRequiredFields aiInterpretShortReplies aiHandoffAfterFailedTurns
      about address phone contactEmail website logoUrl taxId timezone country currency
      businessHours shippingPolicy returnPolicy
      paymentAccounts { type bankName accountName accountNo promptpayId note }
      shippingFlatRate shippingFreeThreshold shippingEstDaysMin shippingEstDaysMax
      emailThemeColor emailFooterText
    }
  }
`;

const M_TENANT = gql`
  mutation ($name: String, $slug: String) {
    bmsUpdateMyTenant(name: $name, slug: $slug) { id name slug }
  }
`;
const M_PROFILE = gql`
  mutation ($input: BmsStoreProfileInput!) {
    bmsUpsertStoreProfile(input: $input) { about }
  }
`;

const PROFILE_KEYS = [
  "businessType", "aiLanguage", "aiOrderingStyle", "aiRequiredFields", "aiInterpretShortReplies",
  "aiHandoffAfterFailedTurns", "about", "address", "phone", "contactEmail", "website", "logoUrl", "taxId",
  "timezone", "country", "currency", "businessHours", "shippingPolicy", "returnPolicy",
  "shippingFlatRate", "shippingFreeThreshold", "shippingEstDaysMin", "shippingEstDaysMax",
  "emailThemeColor", "emailFooterText",
] as const;

const DEFAULT_EMAIL_THEME_COLOR = "#1677ff";

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "20px 0 12px" }}>
      <span style={{ width: 4, height: 16, background: "#52c41a", borderRadius: 2, display: "inline-block" }} />
      <span style={{ fontWeight: 600, fontSize: 14 }}>{children}</span>
      {note && <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>}
    </div>
  );
}

export default function StoreProfileCard() {
  const [form] = Form.useForm();
  const { data, loading, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [saveTenant, { loading: savingT }] = useMutation(M_TENANT);
  const [saveProfile, { loading: savingP }] = useMutation(M_PROFILE);

  useEffect(() => {
    const t = data?.bmsMyTenant;
    const p = data?.bmsStoreProfile;
    if (t || p) {
      form.setFieldsValue({
        name: t?.name || "",
        slug: t?.slug || "",
        businessType: p?.businessType || undefined,
        aiLanguage: p?.aiLanguage || "th",
        aiOrderingStyle: p?.aiOrderingStyle || "catalog_variant",
        aiRequiredFields: p?.aiRequiredFields || ["product", "size", "qty"],
        aiInterpretShortReplies: p?.aiInterpretShortReplies !== false,
        aiHandoffAfterFailedTurns: p?.aiHandoffAfterFailedTurns || 3,
        about: p?.about, address: p?.address, phone: p?.phone,
        contactEmail: p?.contactEmail, website: p?.website, logoUrl: p?.logoUrl, taxId: p?.taxId,
        timezone: p?.timezone, country: p?.country || undefined, currency: p?.currency || undefined,
        businessHours: p?.businessHours, shippingPolicy: p?.shippingPolicy, returnPolicy: p?.returnPolicy,
        paymentAccounts: (p?.paymentAccounts || []).map((a: any) => ({ ...a })),
        shippingFlatRate: p?.shippingFlatRate, shippingFreeThreshold: p?.shippingFreeThreshold,
        shippingEstDaysMin: p?.shippingEstDaysMin, shippingEstDaysMax: p?.shippingEstDaysMax,
        emailThemeColor: p?.emailThemeColor || DEFAULT_EMAIL_THEME_COLOR, emailFooterText: p?.emailFooterText,
      });
    }
  }, [data, form]);

  const onFinish = async (v: any) => {
    try {
      // 1) ชื่อร้าน → bms_tenants (slug ปิดไม่ให้แก้ ส่ง null = คงค่าเดิม)
      await saveTenant({ variables: { name: v.name?.trim() || null, slug: null } });
      // 2) ข้อมูลร้านที่เหลือ → bms_store_profile
      const input: any = {};
      for (const k of PROFILE_KEYS) input[k] = v[k] ?? null;
      input.paymentAccounts = (v.paymentAccounts || []).map((a: any) => ({
        type: a.type || "BANK", bankName: a.bankName ?? null, accountName: a.accountName ?? null,
        accountNo: a.accountNo ?? null, promptpayId: a.promptpayId ?? null, note: a.note ?? null,
      }));
      await saveProfile({ variables: { input } });
      message.success("บันทึกข้อมูลร้านแล้ว");
      refetch();
    } catch (e: any) {
      message.error(e?.message || "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <Card
      title={<Space><Tag color="green"><ShopOutlined /> ข้อมูลร้าน</Tag><Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>ใช้แสดงในระบบ + ให้ผู้ช่วย AI ตอบลูกค้า</Text></Space>}
      loading={loading}
      style={{ marginBottom: 16 }}
    >
      <div style={{ maxWidth: 920 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
          กรอกให้ครบเพื่อให้ AI ตอบคำถามลูกค้าได้ถูกต้อง เช่น “ร้านเปิดกี่โมง” “โอนเข้าบัญชีไหน” “ค่าส่งเท่าไหร่”
        </Text>
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark="optional">
          <SectionTitle>ชื่อร้าน</SectionTitle>
          <Row gutter={16}>
            <Col xs={24} md={14}>
              <Form.Item name="name" label="ชื่อร้าน" rules={[{ required: true, message: "ระบุชื่อร้าน" }]}>
                <Input placeholder="เช่น ร้านรองเท้า ABC" />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="slug" label="Slug" tooltip="ตัวระบุร้านภายในระบบ สร้างอัตโนมัติตอนสมัคร · ยังไม่เปิดให้แก้">
                <Input disabled addonBefore="/" />
              </Form.Item>
            </Col>
          </Row>

          <SectionTitle note="ใช้สร้าง tenant summary และควบคุมการถามข้อมูลก่อนรับออร์เดอร์">บริบทสำหรับ AI</SectionTitle>
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="businessType" label="Business type">
                <Select
                  allowClear
                  placeholder="เลือกประเภทร้าน"
                  options={[
                    { value: "fashion", label: "แฟชั่น / เสื้อผ้า" },
                    { value: "beauty", label: "ความงาม / สกินแคร์" },
                    { value: "food", label: "อาหาร / เครื่องดื่ม" },
                    { value: "electronics", label: "อิเล็กทรอนิกส์ / แก็ดเจ็ต" },
                    { value: "home", label: "ของใช้ในบ้าน" },
                    { value: "general", label: "ทั่วไป" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="aiLanguage" label="ภาษาหลัก">
                <Select options={[
                  { value: "th", label: "ไทย" },
                  { value: "en", label: "English" },
                  { value: "th-en", label: "ไทย / English" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="aiOrderingStyle" label="รูปแบบการรับออร์เดอร์">
                <Select options={[
                  { value: "catalog_variant", label: "สินค้า + ตัวเลือก/ไซซ์" },
                  { value: "simple_catalog", label: "สินค้าแบบไม่มีตัวเลือก" },
                  { value: "inquiry_first", label: "สอบถามก่อนเสนอสินค้า" },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="aiRequiredFields"
                label="ข้อมูลที่ต้องครบก่อนสร้างออร์เดอร์"
                rules={[{ required: true, message: "เลือกข้อมูลที่ต้องถาม" }]}
              >
                <Select mode="multiple" options={[
                  { value: "product", label: "สินค้า" },
                  { value: "size", label: "ไซซ์ / ตัวเลือก" },
                  { value: "qty", label: "จำนวน" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="aiHandoffAfterFailedTurns" label="ส่งต่อแอดมินหลังถามไม่คืบหน้า">
                <InputNumber min={1} max={10} addonAfter="รอบ" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="aiInterpretShortReplies" label="ตีความคำตอบสั้น" valuePropName="checked">
                <Switch checkedChildren="เปิด" unCheckedChildren="ปิด" />
              </Form.Item>
            </Col>
          </Row>

          <SectionTitle>ติดต่อ / แบรนด์</SectionTitle>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}><Form.Item name="phone" label="เบอร์โทร"><Input placeholder="08x-xxx-xxxx" /></Form.Item></Col>
            <Col xs={24} sm={12} md={8}><Form.Item name="contactEmail" label="อีเมลติดต่อ"><Input type="email" placeholder="shop@example.com" /></Form.Item></Col>
            <Col xs={24} sm={12} md={8}><Form.Item name="website" label="เว็บไซต์ / โซเชียล"><Input placeholder="https://..." /></Form.Item></Col>
            <Col xs={24} sm={12} md={12}><Form.Item name="logoUrl" label="โลโก้ร้าน (URL)"><Input placeholder="https://.../logo.png" /></Form.Item></Col>
            <Col xs={24} sm={12} md={12}><Form.Item name="taxId" label="เลขผู้เสียภาษี / ทะเบียนพาณิชย์"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Item name="about" label="เกี่ยวกับร้าน / คำอธิบายสั้น" style={{ marginBottom: 12 }}><Input.TextArea rows={3} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="address" label="ที่อยู่ร้าน" style={{ marginBottom: 12 }}><Input.TextArea rows={3} /></Form.Item></Col>
          </Row>

          <SectionTitle>ภูมิภาค / เวลาทำการ</SectionTitle>
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item name="country" label="ประเทศ/ภูมิภาค">
                <Select allowClear placeholder="เลือก" options={[
                  { value: "TH", label: "ไทย (TH)" },
                  { value: "AU", label: "ออสเตรเลีย (AU)" },
                  { value: "UK", label: "สหราชอาณาจักร (UK)" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="currency" label="สกุลเงิน">
                <Select allowClear placeholder="เลือก" options={[
                  { value: "THB", label: "บาท (THB)" },
                  { value: "AUD", label: "AUD" },
                  { value: "GBP", label: "GBP" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}><Form.Item name="timezone" label="Timezone"><Input placeholder="Asia/Bangkok" /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="businessHours" label="เวลาเปิด-ปิด"><Input placeholder="จ-ศ 9:00-18:00, ส-อา หยุด" /></Form.Item></Col>
          </Row>

          <SectionTitle>นโยบาย</SectionTitle>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Item name="shippingPolicy" label="นโยบายจัดส่ง" style={{ marginBottom: 12 }}><Input.TextArea rows={2} placeholder="เช่น ส่งภายใน 1-2 วันทำการหลังชำระเงิน" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="returnPolicy" label="นโยบายคืนสินค้า" style={{ marginBottom: 12 }}><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>

          <SectionTitle note="ยังไม่ผูก carrier API — เป็นค่าประเมิน">ค่าส่ง</SectionTitle>
          <Row gutter={16}>
            <Col xs={12} md={6}><Form.Item name="shippingFlatRate" label="ค่าส่งเหมา (บาท)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="shippingFreeThreshold" label="ส่งฟรีเมื่อยอด ≥ (บาท)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="shippingEstDaysMin" label="ส่งถึงขั้นต่ำ (วัน)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="shippingEstDaysMax" label="ส่งถึงสูงสุด (วัน)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>

          <SectionTitle note="ให้ลูกค้าจำได้ง่ายว่าอีเมลมาจากร้านคุณ">อีเมลแจ้งสถานะออร์เดอร์</SectionTitle>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="emailThemeColor" label="สีธีมหลัก" tooltip="ใช้กับแถบหัวอีเมล + ชื่อร้าน">
                <Input type="color" style={{ width: 64, height: 32, padding: 2, cursor: "pointer" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="emailFooterText" label="ข้อความท้ายอีเมล (ไม่บังคับ)">
                <Input placeholder="เช่น ติดตามเราได้ที่ Facebook: /myshop" maxLength={300} />
              </Form.Item>
            </Col>
          </Row>

          <SectionTitle note="ลูกค้าจะเห็นเมื่อถามวิธีชำระเงิน">บัญชีรับเงิน</SectionTitle>
          <Form.List name="paymentAccounts">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row key={field.key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                    <Col xs={24} sm={5}>
                      <Form.Item name={[field.name, "type"]} noStyle initialValue="BANK">
                        <Select style={{ width: "100%" }} options={[
                          { value: "BANK", label: "โอนธนาคาร" },
                          { value: "PROMPTPAY", label: "พร้อมเพย์" },
                          { value: "OTHER", label: "อื่นๆ" },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}><Form.Item name={[field.name, "bankName"]} noStyle><Input placeholder="ธนาคาร" /></Form.Item></Col>
                    <Col xs={12} sm={5}><Form.Item name={[field.name, "accountName"]} noStyle><Input placeholder="ชื่อบัญชี" /></Form.Item></Col>
                    <Col xs={12} sm={5}><Form.Item name={[field.name, "accountNo"]} noStyle><Input placeholder="เลขบัญชี" /></Form.Item></Col>
                    <Col xs={10} sm={4}><Form.Item name={[field.name, "promptpayId"]} noStyle><Input placeholder="พร้อมเพย์" /></Form.Item></Col>
                    <Col xs={2} sm={1} style={{ textAlign: "center" }}>
                      <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" onClick={() => add({ type: "BANK" })} icon={<PlusOutlined />} block style={{ marginTop: 4 }}>
                  เพิ่มบัญชี
                </Button>
              </>
            )}
          </Form.List>

          <Divider style={{ margin: "20px 0 16px" }} />
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} size="large" loading={savingT || savingP}>
            บันทึกข้อมูลร้าน
          </Button>
        </Form>
      </div>
    </Card>
  );
}
