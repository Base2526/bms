"use client";

import React, { memo, useEffect, useMemo, useState } from "react";
import { gql, useMutation } from "@apollo/client";

import { useI18n } from "@/lib/i18nContext";

type VerifyStrings = {
  verifying: string;
  invalidLink: string;
  success: string;
  failed: string;
};

const VERIFY_EMAIL = gql`
  mutation VerifyEmail($token: String!) {
    verifyEmail(token: $token) {
      ok
      message
    }
  }
`;

const VERIFY_SHOP_SIGNUP = gql`
  mutation VerifyShopSignup($token: String!) {
    bmsVerifyShopSignup(token: $token) {
      status
      slug
    }
  }
`;

type Props = {
  token: string | null;
};

function VerifyEmailClientInner({ token }: Props) {
  const { t } = useI18n();
  const strings: VerifyStrings = useMemo(
    () => ({
      verifying: t("verify.verifying"),
      invalidLink: t("verify.invalid_link"),
      success: t("verify.success"),
      failed: t("verify.failed"),
    }),
    [t]
  );
  const [verifyEmail] = useMutation(VERIFY_EMAIL);
  const [verifyShopSignup] = useMutation(VERIFY_SHOP_SIGNUP);

  const [status, setStatus] = useState(() => strings.verifying);

  useEffect(() => {
    if (!token) {
      setStatus(strings.invalidLink);
      return;
    }

    let cancelled = false;

    verifyShopSignup({ variables: { token } })
      .then(async ({ data }) => {
        if (cancelled) return;
        const shopStatus = data?.bmsVerifyShopSignup?.status;
        if (shopStatus === "VERIFIED") {
          setStatus("ยืนยันอีเมลและเปิดร้านสำเร็จ กำลังไปหน้าเข้าสู่ระบบ...");
          window.setTimeout(() => window.location.assign("/admin/login"), 1200);
          return;
        }
        if (shopStatus === "EMAIL_TAKEN") {
          setStatus("อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือขอรีเซ็ตรหัสผ่าน");
          return;
        }
        const fallback = await verifyEmail({ variables: { token } });
        if (cancelled) return;
        setStatus(fallback.data?.verifyEmail?.ok ? strings.success : (fallback.data?.verifyEmail?.message || strings.failed));
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(strings.failed);
      });

    return () => {
      cancelled = true;
    };
  }, [token, verifyEmail, verifyShopSignup, strings.failed, strings.invalidLink, strings.success, strings.verifying]);

  const style = useMemo(() => ({ padding: 40, textAlign: "center" as const }), []);

  return (
    <div style={style}>
      <h1>{status}</h1>
    </div>
  );
}

export default memo(VerifyEmailClientInner);
