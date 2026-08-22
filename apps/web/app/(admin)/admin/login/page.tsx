'use client';
import { Card, Form, Input, Button, message, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { gql, useMutation } from '@apollo/client';
import { useI18n } from "@/lib/i18nContext";

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginAdmin(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;

export default function AdminLoginPage(){
  const { t } = useI18n();
  const [loading,setLoading] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin";

  const [login, { loading: loadingLogin }] = useMutation(LOGIN);

  const onFinish = async (values: { identifier: string; password: string }) => {
      const { identifier, password } = values;

      // เดาว่าเป็น email ถ้ามี '@' ไม่งั้นใช้ username
      const input = identifier.includes('@')
        ? { email: identifier.trim(), password }
        : { username: identifier.trim(), password };

      try {
        const { data } = await login({ variables: { input } });
        const res = data?.loginAdmin
        console.log("[login]", res, res.user?.name );

        if (!res?.ok) {
          message.error(res?.message || t("admin_login.invalid_credentials"));
          return;
        }

        // เก็บ token แบบง่าย (แนะนำทำ httpOnly cookie ที่ฝั่ง server ในงานจริง)
        // if (res.token) {
        //   localStorage.setItem("user", JSON.stringify(res.user));
        //   localStorage.setItem('token', res.token);
        //   document.cookie = `token=${res.token}; path=/; samesite=lax`;
        // }

        message.success(t("admin_login.welcome", { name: res.user?.name || '' }));
        router.replace(next);
      } catch (err: any) {
        message.error(err?.message || t("admin_login.login_failed"));
      }
  };

  return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 16,
        paddingTop: 'clamp(24px, 12vh, 140px)',
        boxSizing: 'border-box',
      }}>
        <Card title={t("admin_login.title")} style={{width: '100%', maxWidth: 420}}>
          <Form layout="vertical" onFinish={onFinish}>
            <Form.Item name="identifier" label={t("admin_login.identifier_label")} rules={[{required:true, message: t("admin_login.identifier_required")}]}>
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="password" label={t("admin_login.password_label")} rules={[{required:true, message: t("admin_login.password_required")}]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              {t("admin_login.submit")}
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" style={{marginTop:8,fontSize:12}}>
            {t("admin_login.admin_only_notice")}
          </Typography.Paragraph>
          <Typography.Paragraph style={{marginBottom:0}}>
            <a href="/forgot">{t("admin_login.forgot_password")}</a>
          </Typography.Paragraph>
        </Card>
      </div>
  );
}
