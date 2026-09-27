'use client';
import { Card, Form, Input, Button, message, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { gql, useMutation } from '@apollo/client';
import type { CredentialResponse } from "@react-oauth/google";
import type { FailResponse, SuccessResponse } from "@greatsumini/react-facebook-login";
import { useI18n } from "@/lib/i18nContext";
import SocialLogin from "@/components/auth/SocialLogin";

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginAdmin(input: $input) {
      ok
      message
      user { id name email role }
    }
  }
`;

const LOGIN_SOCIAL = gql`
  mutation LoginAdminWithSocial($input: SocialLoginInput!) {
    loginAdminWithSocial(input: $input) {
      ok
      message
      user { id name email role }
    }
  }
`;

export default function AdminLoginPage(){
  const { t } = useI18n();
  const [redirecting, setRedirecting] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin";

  const [login, { loading: loadingLogin }] = useMutation(LOGIN);
  const [loginSocial, { loading: loadingSocial }] = useMutation(LOGIN_SOCIAL);
  const busy = loadingLogin || redirecting;
  const socialBusy = loadingSocial || redirecting;

  const handleLoginResult = useCallback((res: any) => {
    if (!res?.ok) {
      message.error(res?.message || t("admin_login.invalid_credentials"));
      return;
    }

    message.success(t("admin_login.welcome", { name: res.user?.name || '' }));
    setRedirecting(true);
    router.replace(next);
  }, [next, router, t]);

  const onFinish = async (values: { identifier: string; password: string }) => {
      if (submitting.current) return;
      submitting.current = true;
      const { identifier, password } = values;

      // เดาว่าเป็น email ถ้ามี '@' ไม่งั้นใช้ username
      const input = identifier.includes('@')
        ? { email: identifier.trim(), password }
        : { username: identifier.trim(), password };

      try {
        const { data } = await login({ variables: { input } });
        const res = data?.loginAdmin
        handleLoginResult(res);
      } catch (err: any) {
        message.error(err?.message || t("admin_login.login_failed"));
      } finally {
        submitting.current = false;
      }
  };

  const onGoogleSuccess = useCallback(async (credentialResponse: CredentialResponse) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const accessToken = credentialResponse?.credential;
      if (!accessToken) {
        message.error(t("login.google_missing_credential"));
        return;
      }
      const { data } = await loginSocial({
        variables: { input: { provider: "google", accessToken } },
      });
      handleLoginResult(data?.loginAdminWithSocial);
    } catch (err: any) {
      message.error(err?.message || t("login.google_failed"));
    } finally {
      submitting.current = false;
    }
  }, [handleLoginResult, loginSocial, t]);

  const onGoogleError = useCallback(() => {
    message.error(t("login.google_failed"));
  }, [t]);

  const onFacebookSuccess = useCallback(async (response: SuccessResponse) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const accessToken = response?.accessToken;
      if (!accessToken) {
        message.error(t("login.facebook_missing_access_token"));
        return;
      }
      const { data } = await loginSocial({
        variables: { input: { provider: "facebook", accessToken } },
      });
      handleLoginResult(data?.loginAdminWithSocial);
    } catch (err: any) {
      message.error(err?.message || t("login.facebook_failed"));
    } finally {
      submitting.current = false;
    }
  }, [handleLoginResult, loginSocial, t]);

  const onFacebookFail = useCallback((_error: FailResponse) => {
    message.error(t("login.facebook_failed"));
  }, [t]);

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
          <SocialLogin
            surface="ADMIN_LOGIN"
            dividerLabel={t("admin_login.or_login_with_email")}
            facebookLabel={t("login.continue_with_facebook")}
            dividerPosition="after"
            disabled={busy || socialBusy}
            onGoogleSuccess={onGoogleSuccess}
            onGoogleError={onGoogleError}
            onFacebookSuccess={onFacebookSuccess}
            onFacebookFail={onFacebookFail}
          />
          <Form layout="vertical" onFinish={onFinish} disabled={busy} aria-busy={busy}>
            <Form.Item name="identifier" label={t("admin_login.identifier_label")} rules={[{required:true, message: t("admin_login.identifier_required")}]}>
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="password" label={t("admin_login.password_label")} rules={[{required:true, message: t("admin_login.password_required")}]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {busy ? t("admin_login.submitting") : t("admin_login.submit")}
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
