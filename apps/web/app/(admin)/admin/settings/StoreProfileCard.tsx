'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, InputNumber, Button, Space, Tag, message, Form, Divider, Typography, Select } from "antd";
import { ShopOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";

const { Text } = Typography;

const Q = gql`
  query {
    bmsStoreProfile {
      storeName about address phone businessHours shippingPolicy returnPolicy
      paymentAccounts { type bankName accountName accountNo promptpayId note }
      shippingFlatRate shippingFreeThreshold shippingEstDaysMin shippingEstDaysMax
    }
  }
`;

const M = gql`
  mutation ($input: BmsStoreProfileInput!) {
    bmsUpsertStoreProfile(input: $input) { storeName }
  }
`;

export default function StoreProfileCard() {
  const [form] = Form.useForm();
  const { data, loading, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M);

  useEffect(() => {
    if (data?.bmsStoreProfile) {
      const p = data.bmsStoreProfile;
      form.setFieldsValue({
        storeName: p.storeName, about: p.about, address: p.address, phone: p.phone,
        businessHours: p.businessHours, shippingPolicy: p.shippingPolicy, returnPolicy: p.returnPolicy,
        paymentAccounts: (p.paymentAccounts || []).map((a: any) => ({ ...a })),
        shippingFlatRate: p.shippingFlatRate, shippingFreeThreshold: p.shippingFreeThreshold,
        shippingEstDaysMin: p.shippingEstDaysMin, shippingEstDaysMax: p.shippingEstDaysMax,
      });
    }
  }, [data, form]);

  const onFinish = async (v: any) => {
    // strip __typename ออกจาก paymentAccounts ก่อนส่ง
    const paymentAccounts = (v.paymentAccounts || []).map((a: any) => ({
      type: a.type || "BANK", bankName: a.bankName ?? null, accountName: a.accountName ?? null,
      accountNo: a.accountNo ?? null, promptpayId: a.promptpayId ?? null, note: a.note ?? null,
    }));
    try {
      await save({ variables: { input: { ...v, paymentAccounts } } });
      message.success("บันทึกข้อมูลร้านแล้ว");
      refetch();
    } catch (e: any) {
      message.error(e?.message || "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <Card
      title={<Space><Tag color="green"><ShopOutlined /> ข้อมูลร้าน (ให้ AI ใช้ตอบลูกค้า)</Tag></Space>}
      loading={loading}
      style={{ marginBottom: 16 }}
    >
      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        ข้อมูลนี้จะถูกใช้โดยผู้ช่วย AI ตอบลูกค้า (เวลาเปิด-ปิด, ที่อยู่, บัญชีรับเงิน, ค่าส่ง) — กรอกให้ครบเพื่อให้ AI ตอบได้ถูกต้อง
      </Text>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="storeName" label="ชื่อร้าน"><Input placeholder="เช่น ร้านรองเท้า ABC" /></Form.Item>
        <Form.Item name="about" label="เกี่ยวกับร้าน / คำอธิบายสั้น"><Input.TextArea rows={2} /></Form.Item>
        <Space style={{ width: "100%" }} align="start" wrap>
          <Form.Item name="phone" label="เบอร์โทร"><Input style={{ width: 200 }} /></Form.Item>
          <Form.Item name="businessHours" label="เวลาเปิด-ปิด"><Input style={{ width: 320 }} placeholder="จ-ศ 9:00-18:00, ส-อา หยุด" /></Form.Item>
        </Space>
        <Form.Item name="address" label="ที่อยู่ร้าน"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="shippingPolicy" label="นโยบายจัดส่ง"><Input.TextArea rows={2} placeholder="เช่น ส่งภายใน 1-2 วันทำการหลังชำระเงิน" /></Form.Item>
        <Form.Item name="returnPolicy" label="นโยบายคืนสินค้า"><Input.TextArea rows={2} /></Form.Item>

        <Divider orientation="left" style={{ fontSize: 13 }}>ค่าส่ง (ประเมินโดยประมาณ)</Divider>
        <Space wrap>
          <Form.Item name="shippingFlatRate" label="ค่าส่งเหมา (บาท)"><InputNumber min={0} style={{ width: 150 }} /></Form.Item>
          <Form.Item name="shippingFreeThreshold" label="ส่งฟรีเมื่อยอด ≥ (บาท)"><InputNumber min={0} style={{ width: 180 }} /></Form.Item>
          <Form.Item name="shippingEstDaysMin" label="ส่งถึงขั้นต่ำ (วัน)"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
          <Form.Item name="shippingEstDaysMax" label="ส่งถึงสูงสุด (วัน)"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
        </Space>

        <Divider orientation="left" style={{ fontSize: 13 }}>บัญชีรับเงิน (ลูกค้าจะเห็นเมื่อถาม)</Divider>
        <Form.List name="paymentAccounts">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="baseline" wrap style={{ marginBottom: 8 }}>
                  <Form.Item name={[field.name, "type"]} initialValue="BANK">
                    <Select style={{ width: 130 }} options={[
                      { value: "BANK", label: "โอนธนาคาร" },
                      { value: "PROMPTPAY", label: "พร้อมเพย์" },
                      { value: "OTHER", label: "อื่นๆ" },
                    ]} />
                  </Form.Item>
                  <Form.Item name={[field.name, "bankName"]}><Input placeholder="ธนาคาร" style={{ width: 130 }} /></Form.Item>
                  <Form.Item name={[field.name, "accountName"]}><Input placeholder="ชื่อบัญชี" style={{ width: 160 }} /></Form.Item>
                  <Form.Item name={[field.name, "accountNo"]}><Input placeholder="เลขบัญชี" style={{ width: 150 }} /></Form.Item>
                  <Form.Item name={[field.name, "promptpayId"]}><Input placeholder="พร้อมเพย์" style={{ width: 140 }} /></Form.Item>
                  <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ type: "BANK" })} icon={<PlusOutlined />} block>
                เพิ่มบัญชี
              </Button>
            </>
          )}
        </Form.List>

        <Divider style={{ margin: "16px 0" }} />
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>บันทึกข้อมูลร้าน</Button>
      </Form>
    </Card>
  );
}
