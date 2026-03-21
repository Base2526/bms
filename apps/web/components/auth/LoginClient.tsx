"use client";

import React, { memo, useCallback, useMemo } from "react";
import { gql, useMutation } from "@apollo/client";
import { message, Typography } from "antd";
import type { CredentialResponse } from "@react-oauth/google";

import AuthCard from "@/components/auth/AuthCard";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthSection from "@/components/auth/AuthSection";
import LoginForm from "@/components/auth/LoginForm";
import SocialLogin from "@/components/auth/SocialLogin";

import { useI18n } from "@/lib/i18nContext";
type LoginStrings = {
  title: string;
  back: string;
  home: string;
  divider: string;
  usernameOrEmailLabel: string;
  usernameOrEmailPlaceholder: string;
  usernameOrEmailRequired: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  passwordRequired: string;
  submit: string;
  register: string;
  forgot: string;
  loginFailed: string;
  welcome: string; // supports `{name}`
  googleMissingCredential: string;
  googleFailed: string;

  tipPrefix: string;
  tipHttpOnlyCookie: string;
  tipMiddle: string;
  tipApiSsr: string;
  tipSuffix: string;
  tipLocalStorage: string;
  tipEnd: string;
};

type Props = {
  nextPath: string | null;
};

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginUser(input: $input) {
      ok
      message
      token
      user {
        id
        name
        email
        role
      }
    }
  }
`;

const LOGIN_SOCIAL = gql`
  mutation LoginWithSocial($input: SocialLoginInput!) {
    loginWithSocial(input: $input) {
      ok
      message
      token
      user {
        id
        name
        email
        role
      }
    }
  }
`;

type LoginOk = {
  ok: boolean;
  message?: string | null;
  token?: string | null;
  user?: { name?: string | null } | null;
};

function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

function LoginClientInner({ nextPath }: Props) {
  const { t } = useI18n();

  const strings: LoginStrings = useMemo(
    () => ({
      title: t("login.title"),
      back: t("common.back"),
      home: t("common.home"),
      divider: t("common.or_continue_with"),
      usernameOrEmailLabel: t("login.username_or_email"),
      usernameOrEmailPlaceholder: t("login.username_or_email_placeholder"),
      usernameOrEmailRequired: t("login.username_or_email_required"),
      passwordLabel: t("login.password"),
      passwordPlaceholder: t("login.password_placeholder"),
      passwordRequired: t("login.password_required"),
      submit: t("login.submit"),
      register: t("login.register"),
      forgot: t("login.forgot"),
      loginFailed: t("login.failed"),
      welcome: t("login.welcome"),
      googleMissingCredential: t("login.google_missing_credential"),
      googleFailed: t("login.google_failed"),
      tipPrefix: t("login.tip_prefix"),
      tipHttpOnlyCookie: t("login.tip_http_only_cookie"),
      tipMiddle: t("login.tip_middle"),
      tipApiSsr: t("login.tip_api_ssr"),
      tipSuffix: t("login.tip_suffix"),
      tipLocalStorage: t("login.tip_local_storage"),
      tipEnd: t("login.tip_end"),
    }),
    [t]
  );

  const [login, { loading }] = useMutation(LOGIN);
  const [loginSocial, { loading: loadingSocial }] = useMutation(LOGIN_SOCIAL);

  const handleLoginSuccess = useCallback(
    (res: LoginOk) => {
      if (!res?.ok) {
        message.error(res?.message || strings.loginFailed);
        return;
      }

      const name = res.user?.name || "";
      message.success(format(strings.welcome, { name }));
      window.location.href = nextPath || "/";
    },
    [nextPath, strings.loginFailed, strings.welcome]
  );

  const onSubmit = useCallback(
    async (values: { identifier: string; password: string }) => {
      const { identifier, password } = values;

      const input = identifier.includes("@")
        ? { email: identifier.trim(), password }
        : { username: identifier.trim(), password };

      try {
        const { data } = await login({ variables: { input } });
        const res = data?.loginUser as LoginOk | undefined;
        // eslint-disable-next-line no-console
        console.log("[login]", res);
        handleLoginSuccess(res as LoginOk);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(err);
        message.error(err?.message || strings.loginFailed);
      }
    },
    [handleLoginSuccess, login, strings.loginFailed]
  );

  const onGoogleSuccess = useCallback(
    async (credentialResponse: CredentialResponse) => {
      try {
        const accessToken = credentialResponse?.credential;
        if (!accessToken) {
          message.error(strings.googleMissingCredential);
          return;
        }

        const { data } = await loginSocial({
          variables: {
            input: {
              provider: "google",
              accessToken,
            },
          },
        });

        const res = data?.loginWithSocial as LoginOk | undefined;
        // eslint-disable-next-line no-console
        console.log("[loginWithSocial:google]", res);
        handleLoginSuccess(res as LoginOk);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(err);
        message.error(err?.message || strings.googleFailed);
      }
    },
    [handleLoginSuccess, loginSocial, strings.googleFailed, strings.googleMissingCredential]
  );

  const onGoogleError = useCallback(() => {
    message.error(strings.googleFailed);
  }, [strings.googleFailed]);

  return (
    <AuthCard
      title={strings.title}
      extra={<AuthHeader backLabel={strings.back} homeLabel={strings.home} />}
      maxWidth={420}
    >
      <AuthSection>
        <LoginForm
          usernameOrEmailLabel={strings.usernameOrEmailLabel}
          usernameOrEmailPlaceholder={strings.usernameOrEmailPlaceholder}
          usernameOrEmailRequired={strings.usernameOrEmailRequired}
          passwordLabel={strings.passwordLabel}
          passwordPlaceholder={strings.passwordPlaceholder}
          passwordRequired={strings.passwordRequired}
          submitLabel={strings.submit}
          registerLabel={strings.register}
          forgotLabel={strings.forgot}
          loading={loading}
          onSubmit={onSubmit}
        />

        <SocialLogin
          dividerLabel={strings.divider}
          disabled={loadingSocial}
          onGoogleSuccess={onGoogleSuccess}
          onGoogleError={onGoogleError}
        />

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {strings.tipPrefix}
          <code>{strings.tipHttpOnlyCookie}</code>
          {strings.tipMiddle}
          <code>{strings.tipApiSsr}</code>
          {strings.tipSuffix}
          <code>{strings.tipLocalStorage}</code>
          {strings.tipEnd}
        </Typography.Paragraph>
      </AuthSection>
    </AuthCard>
  );
}

export default memo(LoginClientInner);
