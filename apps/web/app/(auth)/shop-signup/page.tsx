'use client';
import { gql, useMutation } from "@apollo/client";
import { Card, Form, Input, Button, message, Alert, Typography, Result, Select } from "antd";
import { useState } from "react";
import Link from "next/link";
import { ShopOutlined } from "@ant-design/icons";
import styles from "./page.module.css";
import { localizedShopArchetypeOptions } from "@/lib/bms/shopArchetypes";
import { useI18n } from "@/lib/i18nContext";

const { Paragraph } = Typography;

const M_SIGNUP = gql`
  mutation ($shopName: String!, $name: String, $email: String!, $password: String!, $businessArchetype: String) {
    bmsSignup(shopName: $shopName, name: $name, email: $email, password: $password, businessArchetype: $businessArchetype) {
      status tenantId slug
    }
  }
`;

export default function Page() {
  const { t } = useI18n();
  const archetypeOptions = localizedShopArchetypeOptions(t);
  const [form] = Form.useForm();
  const [done, setDone] = useState(false);

  const [signup, { loading }] = useMutation(M_SIGNUP, {
    onCompleted: (d) => {
      const r = d?.bmsSignup;
      if (r?.status === "PENDING_VERIFICATION") setDone(true);
      else if (r?.status === "EMAIL_TAKEN") message.error(t("shopSignup.email_taken"));
      else message.error(t("shopSignup.invalid_data"));
    },
    onError: (e) => message.error(e?.message || t("shopSignup.signup_failed")),
  });

  const submit = async () => {
    const v = await form.validateFields();
    await signup({
      variables: {
        shopName: v.shopName,
        name: v.name || null,
        email: v.email,
        password: v.password,
        businessArchetype: v.businessArchetype || null,
      },
    });
  };

  if (done) {
    return (
      <div className={styles.page} data-shop-signup-page>
        <div className={styles.successPanel}>
          <Result
            status="success"
            title={t("shopSignup.done_title")}
            subTitle={t("shopSignup.done_subtitle")}
            extra={[<Link key="login" href="/admin/login"><Button>{t("shopSignup.back_to_login")}</Button></Link>]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-shop-signup-page>
      <div className={styles.formPanel}>
        <Card className={styles.card} title={<><ShopOutlined /> {t("shopSignup.heading")}</>}>
          <Paragraph type="secondary">
            {t("shopSignup.tagline")}
          </Paragraph>
          <Form form={form} layout="vertical" autoComplete="off">
            <Form.Item label={t("shopSignup.shop_name")} name="shopName" rules={[{ required: true, message: t("shopSignup.shop_name_required") }]}>
              <Input placeholder={t("shopSignup.shop_name_placeholder")} size="large" />
            </Form.Item>
            <Form.Item
              label={t("shopSignup.shop_type")}
              name="businessArchetype"
              extra={t("shopSignup.shop_type_hint")}
            >
              <Select
                allowClear
                placeholder={t("shopSignup.shop_type_placeholder")}
                options={archetypeOptions}
              />
            </Form.Item>
            <Form.Item label={t("shopSignup.owner_name")} name="name">
              <Input placeholder={t("shopSignup.owner_name_placeholder")} />
            </Form.Item>
            <Form.Item label={t("shopSignup.email")} name="email" rules={[{ required: true, type: "email", message: t("shopSignup.email_invalid") }]}>
              <Input placeholder={t("shopSignup.email_placeholder")} />
            </Form.Item>
            <Form.Item label={t("shopSignup.password")} name="password" rules={[{ required: true, min: 6, message: t("shopSignup.password_min") }]}>
              <Input.Password placeholder={t("shopSignup.password_placeholder")} />
            </Form.Item>
            <Button type="primary" size="large" block loading={loading} onClick={submit}>{t("shopSignup.submit")}</Button>
          </Form>
          <Alert closable className={styles.loginAlert} type="info" showIcon
            message={t("shopSignup.has_account")} description={<Link href="/admin/login">{t("shopSignup.login_link")}</Link>} />
        </Card>
      </div>
    </div>
  );
}
