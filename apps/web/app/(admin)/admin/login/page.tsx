'use client';
import { Form, Input, Button, message } from "antd";
import { ArrowRightOutlined, InfoCircleOutlined, LockOutlined } from "@ant-design/icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { gql, useMutation } from '@apollo/client';
import type { CredentialResponse } from "@react-oauth/google";
import type { FailResponse, SuccessResponse } from "@greatsumini/react-facebook-login";
import { useI18n } from "@/lib/i18nContext";
import { safeInternalRedirectPath } from "@/lib/safeRedirect";
import SocialLogin from "@/components/auth/SocialLogin";
import GuideLinks from "@/components/learning/GuideLinks";
import styles from "./page.module.css";

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
  const sp = useSearchParams()!;
  // ?next= comes from the URL: only a same-origin path may follow a successful login.
  const next = safeInternalRedirectPath(sp.get("next"));

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

  const flow = [
    t("admin_login.flow_customer"),
    "AI",
    "CRM",
    t("admin_login.flow_order"),
    t("admin_login.flow_inventory"),
    t("admin_login.flow_payment"),
  ];

  return (
    <div className={styles.page}>
      <section className={styles.brandPanel} aria-label={t("admin_login.brand_name")}>
        <div className={styles.brand}>
          <Image className={styles.brandMark} src="/icons/app-icon.svg" alt="" width={44} height={44} priority />
          <div>
            <span className={styles.brandName}>{t("admin_login.brand_name")}</span>
            <span className={styles.brandCaption}>{t("admin_login.brand_caption")}</span>
          </div>
        </div>

        <div className={styles.brandCopy}>
          <span className={styles.eyebrow}>{t("admin_login.brand_eyebrow")}</span>
          <h1 className={styles.brandTitle}>
            {t("admin_login.brand_heading_first")}<br />
            <span>{t("admin_login.brand_heading_second")}</span>
          </h1>
          <p>{t("admin_login.brand_description")}</p>
          <div className={styles.flowCard}>
            <span className={styles.flowTitle}>{t("admin_login.flow_title")}</span>
            <div className={styles.flow}>
              {flow.map((item, index) => (
                <span className={styles.flowStep} key={`${index}-${item}`}>
                  {index > 0 && <span className={styles.flowArrow} aria-hidden="true">→</span>}
                  <span className={styles.flowLabel}>{item}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className={styles.brandFoot}>{t("admin_login.brand_footer")}</p>
      </section>

      <section className={styles.entryPanel} aria-labelledby="admin-login-title">
        <div className={styles.entry}>
          <header className={styles.entryHead}>
            <span className={styles.areaBadge}><LockOutlined aria-hidden="true" />{t("admin_login.area_badge")}</span>
            <h2 id="admin-login-title">{t("admin_login.title")}</h2>
            <p>{t("admin_login.intro")}</p>
          </header>

          <div className={styles.formCard}>
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
                <Input autoFocus size="large" autoComplete="username" placeholder={t("admin_login.identifier_placeholder")} />
              </Form.Item>
              <Form.Item name="password" label={t("admin_login.password_label")} rules={[{required:true, message: t("admin_login.password_required")}]}>
                <Input.Password size="large" autoComplete="current-password" placeholder={t("admin_login.password_placeholder")} />
              </Form.Item>
              <div className={styles.forgotLink}><Link href="/forgot">{t("admin_login.forgot_password")}</Link></div>
              <Button className={styles.submitButton} type="primary" htmlType="submit" block loading={busy}>
                {busy ? t("admin_login.submitting") : t("admin_login.submit")}
                {!busy && <ArrowRightOutlined aria-hidden="true" />}
              </Button>
            </Form>
            <p className={styles.adminNotice}><InfoCircleOutlined aria-hidden="true" />{t("admin_login.admin_only_notice")}</p>
          </div>

          <div className={styles.guide}><GuideLinks slugs={["sign-in-account"]} start /></div>
        </div>
      </section>
    </div>
  );
}
