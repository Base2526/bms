"use client";

import React, { memo, useCallback, useMemo } from "react";
import { Button, Form, Input, Space } from "antd";

type Values = { identifier: string; password: string };

type Props = {
  usernameOrEmailLabel: string;
  usernameOrEmailPlaceholder: string;
  usernameOrEmailRequired: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  passwordRequired: string;
  submitLabel: string;
  registerLabel: string;
  forgotLabel: string;
  loading?: boolean;
  onSubmit: (values: Values) => Promise<void>;
};

function LoginFormInner({
  usernameOrEmailLabel,
  usernameOrEmailPlaceholder,
  usernameOrEmailRequired,
  passwordLabel,
  passwordPlaceholder,
  passwordRequired,
  submitLabel,
  registerLabel,
  forgotLabel,
  loading,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<Values>();

  const initialValues = useMemo(() => ({ identifier: "", password: "" }), []);

  const onFinish = useCallback(
    async (values: Values) => {
      await onSubmit(values);
    },
    [onSubmit]
  );

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={initialValues}>
      <Form.Item label={usernameOrEmailLabel} name="identifier" rules={[{ required: true, message: usernameOrEmailRequired }]}>
        <Input placeholder={usernameOrEmailPlaceholder} autoComplete="username" />
      </Form.Item>

      <Form.Item label={passwordLabel} name="password" rules={[{ required: true, message: passwordRequired }]}>
        <Input.Password placeholder={passwordPlaceholder} autoComplete="current-password" />
      </Form.Item>

      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          {submitLabel}
        </Button>

        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Button type="link" href="/register">
            {registerLabel}
          </Button>
          <Button type="link" href="/forgot">
            {forgotLabel}
          </Button>
        </Space>
      </Space>
    </Form>
  );
}

export default memo(LoginFormInner);
