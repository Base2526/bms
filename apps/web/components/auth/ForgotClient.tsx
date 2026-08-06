"use client";

import React, { memo, useCallback, useMemo } from "react";
import { Card, Form, Input, Button, message } from "antd";
import { gql, useMutation } from "@apollo/client";

import { useI18n } from "@/lib/i18nContext";

type ForgotStrings = {
  title: string;
  emailLabel: string;
  emailPlaceholder: string;
  submit: string;
  success: string;
  error: string;
};

const MUT_REQ = gql`
  mutation RequestPasswordReset($email: String!) {
    requestPasswordReset(email: $email)
  }
`;

function ForgotClientInner() {
  const { t } = useI18n();
  const strings: ForgotStrings = useMemo(
    () => ({
      title: t("forgot.title"),
      emailLabel: t("forgot.email"),
      emailPlaceholder: t("forgot.email_placeholder"),
      submit: t("forgot.submit"),
      success: t("forgot.success"),
      error: t("register.error"),
    }),
    [t]
  );
  const [mut, { loading }] = useMutation(MUT_REQ);

  const outerStyle = useMemo(
    () => ({
      minHeight: "100dvh",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: 16,
      paddingTop: "clamp(24px, 12vh, 140px)",
      boxSizing: "border-box" as const,
    }),
    []
  );
  const cardStyle = useMemo(() => ({ width: 400, maxWidth: "100%" as const }), []);

  const onFinish = useCallback(
    async (values: { email: string }) => {
      try {
        await mut({ variables: { email: values.email } });
        message.success(strings.success);
      } catch (e: any) {
        message.error(e?.message || strings.error);
      }
    },
    [mut, strings.error, strings.success]
  );

  return (
    <div style={outerStyle}>
      <Card title={strings.title} style={cardStyle}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label={strings.emailLabel} rules={[{ required: true, type: "email" }]}>
            <Input placeholder={strings.emailPlaceholder} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} size="large">
            {strings.submit}
          </Button>
        </Form>
      </Card>
    </div>
  );
}

export default memo(ForgotClientInner);
