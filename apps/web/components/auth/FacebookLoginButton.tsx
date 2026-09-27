"use client";

import React, { memo, useMemo } from "react";
import dynamic from "next/dynamic";
import { Button, Skeleton } from "antd";
import { FacebookFilled } from "@ant-design/icons";
import type { FailResponse, SuccessResponse } from "@greatsumini/react-facebook-login";

const FacebookLogin = dynamic(() => import("@greatsumini/react-facebook-login"), {
  ssr: false,
  loading: () => <Skeleton.Button active block style={{ width: "100%", height: 40 }} />,
});

type Props = {
  disabled?: boolean;
  onSuccess: (response: SuccessResponse) => void;
  onFail: (error: FailResponse) => void;
  label?: string;
};

function FacebookLoginButtonInner({ disabled, onSuccess, onFail, label = "Continue with Facebook" }: Props) {
  const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ?? "";
  const buttonStyle = useMemo(
    () => ({
      width: "100%",
      height: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 4,
      boxSizing: "border-box" as const,
      fontWeight: 500,
    }),
    []
  );

  if (!appId) {
    return (
      <Button block disabled style={buttonStyle}>
        <FacebookFilled /> {label}
      </Button>
    );
  }

  return (
    <FacebookLogin
      appId={appId}
      scope="public_profile,email"
      fields="name,email,picture"
      onSuccess={onSuccess}
      onFail={onFail}
      render={({ onClick }) => (
        <Button block disabled={disabled} onClick={onClick} style={buttonStyle}>
          <FacebookFilled /> {label}
        </Button>
      )}
    />
  );
}

export default memo(FacebookLoginButtonInner);
