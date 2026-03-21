"use client";

import React, { memo, useCallback, useMemo, useState } from "react";
import { gql, useMutation } from "@apollo/client";
import { Card, Checkbox, Form, Input, Button, Typography, message, Progress, Space } from "antd";

import { useI18n } from "@/lib/i18nContext";

const { Title, Text } = Typography;

const OUTER_STYLE = { display: "flex", justifyContent: "center", padding: "40px 16px" } as const;
const CARD_STYLE = { width: 520, maxWidth: "100%" } as const;
const TITLE_STYLE = { marginBottom: 8 } as const;
const FORM_STYLE = { marginTop: 24 } as const;
const STRENGTH_WRAP_STYLE = { marginTop: -8, marginBottom: 16 } as const;
const STRENGTH_LABEL_STYLE = { display: "block", marginBottom: 4 } as const;

const REGISTER_MUTATION = gql`
  mutation RegisterUser($input: RegisterInput!) {
    registerUser(input: $input)
  }
`;

function calcStrength(pw: string) {
  let score = 0;
  if (!pw) return 0;
  if (pw.length >= 8) score += 25;
  if (/[A-Z]/.test(pw)) score += 20;
  if (/[a-z]/.test(pw)) score += 20;
  if (/\d/.test(pw)) score += 20;
  if (/[^A-Za-z0-9]/.test(pw)) score += 15;
  return Math.min(score, 100);
}

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

function normalizeUsername(input: string) {
  return (input || "").trim().toLowerCase();
}

function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

type RegisterStrings = {
  title: string;
  subtitle: string;
  usernameLabel: string;
  usernameHint: string;
  usernameRequired: string;
  usernameNoSpaces: string;
  usernameMin: string; // supports `{min}`
  usernameMax: string; // supports `{max}`
  usernameAllowed: string;
  usernameStartEnd: string;
  usernameConsecutive: string;
  emailLabel: string;
  emailRequired: string;
  emailInvalid: string;
  phoneLabel: string;
  phoneInvalid: string;
  phonePlaceholder: string;
  passwordLabel: string;
  passwordRequired: string;
  passwordMin: string; // supports `{min}`
  passwordStrength: string;
  passwordPlaceholder: string;
  confirmPasswordLabel: string;
  confirmRequired: string;
  confirmMismatch: string;
  agreeRequired: string;
  agreePrefix: string;
  terms: string;
  privacy: string;
  and: string;
  alreadyHave: string;
  signIn: string;
  submit: string;
  success: string;
  failed: string;
  error: string;
  usernamePlaceholder: string;
  emailPlaceholder: string;
};

function validateUsername(usernameRaw: string, s: RegisterStrings) {
  const u = (usernameRaw || "").trim();

  if (!u) return { ok: false as const, message: s.usernameRequired };
  if (/\s/.test(u)) return { ok: false as const, message: s.usernameNoSpaces };

  if (u.length < USERNAME_MIN) return { ok: false as const, message: format(s.usernameMin, { min: USERNAME_MIN }) };
  if (u.length > USERNAME_MAX) return { ok: false as const, message: format(s.usernameMax, { max: USERNAME_MAX }) };

  if (!/^[A-Za-z0-9._-]+$/.test(u)) return { ok: false as const, message: s.usernameAllowed };
  if (/^[._-]/.test(u) || /[._-]$/.test(u)) return { ok: false as const, message: s.usernameStartEnd };
  if (/[._-]{2,}/.test(u)) return { ok: false as const, message: s.usernameConsecutive };

  return { ok: true as const };
}

function RegisterClientInner() {
  const { t } = useI18n();
  const strings: RegisterStrings = useMemo(
    () => ({
      title: t("register.title"),
      subtitle: t("register.subtitle"),
      usernameLabel: t("register.username"),
      usernameHint: t("register.username_hint"),
      usernamePlaceholder: t("register.username_placeholder"),
      usernameRequired: t("register.username_required"),
      usernameNoSpaces: t("register.username_no_spaces"),
      usernameMin: t("register.username_min"),
      usernameMax: t("register.username_max"),
      usernameAllowed: t("register.username_allowed"),
      usernameStartEnd: t("register.username_start_end"),
      usernameConsecutive: t("register.username_consecutive"),
      emailLabel: t("register.email"),
      emailPlaceholder: t("register.email_placeholder"),
      emailRequired: t("register.email_required"),
      emailInvalid: t("register.email_invalid"),
      phoneLabel: t("register.phone_optional"),
      phonePlaceholder: t("register.phone_placeholder"),
      phoneInvalid: t("register.phone_invalid"),
      passwordLabel: t("register.password"),
      passwordPlaceholder: t("register.password_placeholder"),
      passwordRequired: t("register.password_required"),
      passwordMin: t("register.password_min"),
      passwordStrength: t("register.password_strength"),
      confirmPasswordLabel: t("register.confirm_password"),
      confirmRequired: t("register.confirm_required"),
      confirmMismatch: t("register.confirm_mismatch"),
      agreeRequired: t("register.agree_required"),
      agreePrefix: t("register.agree_prefix"),
      terms: t("register.terms"),
      privacy: t("register.privacy"),
      and: t("common.and"),
      alreadyHave: t("register.already_have"),
      signIn: t("register.sign_in"),
      submit: t("register.submit"),
      success: t("register.success"),
      failed: t("register.failed"),
      error: t("register.error"),
    }),
    [t]
  );
  const [form] = Form.useForm();

  const [password, setPassword] = useState("");
  const strength = useMemo(() => calcStrength(password), [password]);
  const strengthColor = useMemo(
    () => (strength >= 80 ? "#52c41a" : strength >= 50 ? "#faad14" : "#ff4d4f"),
    [strength]
  );

  const [mutate, { loading }] = useMutation(REGISTER_MUTATION);

  const onPasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  const normalizeUsernameCb = useCallback((v: string) => normalizeUsername(v), []);

  const usernameExtra = useMemo(
    () => (
      <Text type="secondary">
        {strings.usernameHint}
      </Text>
    ),
    [strings.usernameHint]
  );

  const onSubmit = useCallback(
    async (values: any) => {
      try {
        const username = normalizeUsername(values.username);

        const payload = {
          username,
          email: values.email.trim(),
          phone: values.phone?.trim() || null,
          password: values.password,
          agree: values.agree === true,
        };

        const res = await mutate({ variables: { input: payload } });
        if (res.data?.registerUser) {
          message.success(strings.success);
          window.location.href = "/login";
        } else {
          message.error(strings.failed);
        }
      } catch (e: any) {
        message.error(e?.message || strings.error);
      }
    },
    [mutate, strings.error, strings.failed, strings.success]
  );

  const titleNode = useMemo(
    () => (
      <>
        <Title level={3} style={TITLE_STYLE}>
          {strings.title}
        </Title>
        <Text type="secondary">{strings.subtitle}</Text>
      </>
    ),
    [strings.subtitle, strings.title]
  );

  return (
    <div style={OUTER_STYLE}>
      <Card style={CARD_STYLE}>
        {titleNode}
        <Form form={form} layout="vertical" style={FORM_STYLE} onFinish={onSubmit} initialValues={{ agree: false }}>
          <Form.Item
            name="username"
            label={strings.usernameLabel}
            normalize={normalizeUsernameCb}
            rules={[
              { required: true, message: strings.usernameRequired },
              () => ({
                validator(_, v) {
                  const r = validateUsername(String(v || ""), strings);
                  if (r.ok) return Promise.resolve();
                  return Promise.reject(new Error(r.message));
                },
              }),
            ]}
            extra={usernameExtra}
          >
            <Input placeholder={strings.usernamePlaceholder} autoCapitalize="none" autoCorrect="off" />
          </Form.Item>

          <Form.Item
            name="email"
            label={strings.emailLabel}
            rules={[
              { required: true, message: strings.emailRequired },
              { type: "email", message: strings.emailInvalid },
            ]}
          >
            <Input placeholder={strings.emailPlaceholder} autoCapitalize="none" />
          </Form.Item>

          <Form.Item
            name="phone"
            label={strings.phoneLabel}
            rules={[{ pattern: /^[0-9+\-\s()]*$/, message: strings.phoneInvalid }]}
          >
            <Input placeholder={strings.phonePlaceholder} />
          </Form.Item>

          <Form.Item
            name="password"
            label={strings.passwordLabel}
            rules={[
              { required: true, message: strings.passwordRequired },
              { min: 8, message: format(strings.passwordMin, { min: 8 }) },
            ]}
          >
            <Input.Password placeholder={strings.passwordPlaceholder} onChange={onPasswordChange} />
          </Form.Item>

          <div style={STRENGTH_WRAP_STYLE}>
            <Text type="secondary" style={STRENGTH_LABEL_STYLE}>
              {strings.passwordStrength}
            </Text>
            <Progress
              percent={strength}
              showInfo={false}
              strokeColor={strengthColor}
            />
          </div>

          <Form.Item
            name="confirm"
            label={strings.confirmPasswordLabel}
            dependencies={["password"]}
            rules={[
              { required: true, message: strings.confirmRequired },
              ({ getFieldValue }) => ({
                validator(_, v) {
                  if (!v || getFieldValue("password") === v) return Promise.resolve();
                  return Promise.reject(new Error(strings.confirmMismatch));
                },
              }),
            ]}
          >
            <Input.Password placeholder={strings.passwordPlaceholder} />
          </Form.Item>

          <Form.Item
            name="agree"
            valuePropName="checked"
            rules={[
              {
                validator: (_, v) => (v ? Promise.resolve() : Promise.reject(new Error(strings.agreeRequired))),
              },
            ]}
          >
            <Checkbox>
              {strings.agreePrefix}
              <a href="/terms" target="_blank" rel="noreferrer">
                {strings.terms}
              </a>{" "}
              {strings.and}{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                {strings.privacy}
              </a>
            </Checkbox>
          </Form.Item>

          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Text type="secondary">
              {strings.alreadyHave} <a href="/login">{strings.signIn}</a>
            </Text>
            <Button type="primary" htmlType="submit" loading={loading}>
              {strings.submit}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}

export default memo(RegisterClientInner);
