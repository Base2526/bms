"use client";

import React, { memo, useMemo } from "react";
import dynamic from "next/dynamic";
import { Divider, Skeleton } from "antd";
import type { CredentialResponse } from "@react-oauth/google";

const GoogleLoginButton = dynamic(() => import("@/components/auth/GoogleLoginButton"), {
  ssr: false,
  loading: () => <Skeleton.Button active block style={{ width: "100%", height: 40 }} />,
});

type Props = {
  dividerLabel: string;
  disabled?: boolean;
  onGoogleSuccess: (credentialResponse: CredentialResponse) => void;
  onGoogleError: () => void;
};

function SocialLoginInner({ dividerLabel, disabled, onGoogleSuccess, onGoogleError }: Props) {
  const divider = useMemo(() => <Divider>{dividerLabel}</Divider>, [dividerLabel]);

  return (
    <>
      {divider}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
        <GoogleLoginButton disabled={disabled} onSuccess={onGoogleSuccess} onError={onGoogleError} />
      </div>
    </>
  );
}

export default memo(SocialLoginInner);
