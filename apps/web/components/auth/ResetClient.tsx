"use client";

import React, { memo, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, Form, Input, Button, message } from "antd";
import { gql, useMutation } from "@apollo/client";

import { useI18n } from "@/lib/i18nContext";

type ResetStrings = {
  title: string;
  newPasswordLabel: string;
  confirmPasswordLabel: string;
  mismatch: string;
  missingToken: string;
  submit: string;
  success: string;
  error: string;
};

const MUT_RESET = gql`
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(token: $token, newPassword: $newPassword)
  }
`;

type Props = {
  token: string | null;
};

function ResetClientInner({ token }: Props) {
  const { t } = useI18n();
  const strings: ResetStrings = useMemo(
    () => ({
      title: t("reset.title"),
      newPasswordLabel: t("reset.new_password"),
      confirmPasswordLabel: t("reset.confirm_password"),
      mismatch: t("reset.mismatch"),
      missingToken: t("reset.missing_token"),
      submit: t("reset.submit"),
      success: t("reset.success"),
      error: t("register.error"),
    }),
    [t]
  );
  const router = useRouter();
  const [mut, { loading }] = useMutation(MUT_RESET);

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
  const cardStyle = useMemo(() => ({ width: 420, maxWidth: "100%" as const }), []);

  const onFinish = useCallback(
    async (values: { password: string; confirm: string }) => {
      if (values.password !== values.confirm) {
        message.error(strings.mismatch);
        return;
      }

      if (!token) {
        message.error(strings.missingToken);
        return;
      }

      try {
        const res = await mut({ variables: { token, newPassword: values.password } });
        if (res.data?.resetPassword) {
          message.success(strings.success);
          router.push("/admin/login");
        }
      } catch (e: any) {
        message.error(e?.message || strings.error);
      }
    },
    [mut, router, strings.error, strings.mismatch, strings.missingToken, strings.success, token]
  );

  if (!token) {
    return (
      <div style={{ padding: 40 }}>
        <i>{strings.missingToken}</i>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <Card title={strings.title} style={cardStyle}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="password" label={strings.newPasswordLabel} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirm"
            label={strings.confirmPasswordLabel}
            dependencies={["password"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, v) {
                  return !v || getFieldValue("password") === v
                    ? Promise.resolve()
                    : Promise.reject(new Error(strings.mismatch));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} size="large">
            {strings.submit}
          </Button>
        </Form>
      </Card>
    </div>
  );
}

export default memo(ResetClientInner);
