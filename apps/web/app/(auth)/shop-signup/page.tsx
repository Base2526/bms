'use client';
import { gql, useMutation } from "@apollo/client";
import { Card, Form, Input, Button, message, Alert, Typography, Result } from "antd";
import { useState } from "react";
import Link from "next/link";
import { ShopOutlined } from "@ant-design/icons";

const { Paragraph, Text } = Typography;

const M_SIGNUP = gql`
  mutation ($shopName: String!, $name: String, $email: String!, $password: String!) {
    bmsSignup(shopName: $shopName, name: $name, email: $email, password: $password) {
      status tenantId slug
    }
  }
`;

export default function Page() {
  const [form] = Form.useForm();
  const [done, setDone] = useState<{ slug: string } | null>(null);

  const [signup, { loading }] = useMutation(M_SIGNUP, {
    onCompleted: (d) => {
      const r = d?.bmsSignup;
      if (r?.status === "OK") setDone({ slug: r.slug });
      else if (r?.status === "EMAIL_TAKEN") message.error("อีเมลนี้ถูกใช้แล้ว");
      else message.error("ข้อมูลไม่ถูกต้อง (รหัสผ่านอย่างน้อย 6 ตัว)");
    },
    onError: (e) => message.error(e?.message || "สมัครไม่สำเร็จ"),
  });

  const submit = async () => {
    const v = await form.validateFields();
    await signup({ variables: { shopName: v.shopName, name: v.name || null, email: v.email, password: v.password } });
  };

  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: "48px auto" }}>
        <Result
          status="success"
          title="สร้างร้านสำเร็จ! 🎉"
          subTitle={<>ร้านของคุณ (<Text code>{done.slug}</Text>) พร้อมใช้งานแล้ว ล็อกอินเพื่อเริ่มตั้งค่าสินค้าและเชื่อม LINE/TikTok</>}
          extra={[<Link key="login" href="/admin/login"><Button type="primary">เข้าสู่ระบบ</Button></Link>]}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460, margin: "48px auto" }}>
      <Card title={<><ShopOutlined /> สมัครใช้ AI-BMS — เปิดร้านของคุณ</>}>
        <Paragraph type="secondary">
          สร้างร้านฟรี เริ่มขายผ่าน LINE/TikTok ด้วย AI ตอบลูกค้าอัตโนมัติ — เริ่มที่แพ็กเกจ Free
        </Paragraph>
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="ชื่อร้าน" name="shopName" rules={[{ required: true, message: "ระบุชื่อร้าน" }]}>
            <Input placeholder="เช่น ร้านรองเท้าพี่หมี" size="large" />
          </Form.Item>
          <Form.Item label="ชื่อผู้ใช้ (เจ้าของร้าน)" name="name">
            <Input placeholder="ชื่อคุณ" />
          </Form.Item>
          <Form.Item label="อีเมล" name="email" rules={[{ required: true, type: "email", message: "อีเมลไม่ถูกต้อง" }]}>
            <Input placeholder="you@example.com" />
          </Form.Item>
          <Form.Item label="รหัสผ่าน" name="password" rules={[{ required: true, min: 6, message: "อย่างน้อย 6 ตัว" }]}>
            <Input.Password placeholder="อย่างน้อย 6 ตัวอักษร" />
          </Form.Item>
          <Button type="primary" size="large" block loading={loading} onClick={submit}>สร้างร้านฟรี</Button>
        </Form>
        <Alert style={{ marginTop: 16 }} type="info" showIcon
          message="มีบัญชีแล้ว?" description={<Link href="/admin/login">เข้าสู่ระบบ</Link>} />
      </Card>
    </div>
  );
}
