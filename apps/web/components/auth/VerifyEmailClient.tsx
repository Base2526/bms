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

  const [status, setStatus] = useState(() => strings.verifying);

  useEffect(() => {
    if (!token) {
      setStatus(strings.invalidLink);
      return;
    }

    let cancelled = false;

    verifyEmail({ variables: { token } })
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.verifyEmail?.ok) {
          setStatus(strings.success);
        } else {
          setStatus(data?.verifyEmail?.message || strings.failed);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(strings.failed);
      });

    return () => {
      cancelled = true;
    };
  }, [token, verifyEmail, strings.failed, strings.invalidLink, strings.success, strings.verifying]);

  const style = useMemo(() => ({ padding: 40, textAlign: "center" as const }), []);

  return (
    <div style={style}>
      <h1>{status}</h1>
    </div>
  );
}

export default memo(VerifyEmailClientInner);
