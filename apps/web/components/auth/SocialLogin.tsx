"use client";

import React, { memo, useMemo } from "react";
import dynamic from "next/dynamic";
import { gql, useQuery } from "@apollo/client";
import { Divider, Skeleton } from "antd";
import type { CredentialResponse } from "@react-oauth/google";
import type { FailResponse, SuccessResponse } from "@greatsumini/react-facebook-login";

const GoogleLoginButton = dynamic(() => import("@/components/auth/GoogleLoginButton"), {
  ssr: false,
  loading: () => <Skeleton.Button active block style={{ width: "100%", height: 40 }} />,
});
const FacebookLoginButton = dynamic(() => import("@/components/auth/FacebookLoginButton"), {
  ssr: false,
  loading: () => <Skeleton.Button active block style={{ width: "100%", height: 40 }} />,
});

const SOCIAL_AUTH_AVAILABILITY = gql`
  query SocialAuthAvailability($surface: SocialAuthSurface!) {
    socialAuthAvailability(surface: $surface) {
      google
      facebook
    }
  }
`;

type SocialAuthSurface = "PUBLIC_LOGIN" | "ADMIN_LOGIN" | "SHOP_SIGNUP";

type Props = {
  surface: SocialAuthSurface;
  dividerLabel: string;
  dividerPosition?: "before" | "after";
  facebookLabel?: string;
  disabled?: boolean;
  onGoogleSuccess: (credentialResponse: CredentialResponse) => void;
  onGoogleError: () => void;
  onFacebookSuccess?: (response: SuccessResponse) => void;
  onFacebookFail?: (error: FailResponse) => void;
};

function SocialLoginInner({
  surface,
  dividerLabel,
  dividerPosition = "before",
  facebookLabel,
  disabled,
  onGoogleSuccess,
  onGoogleError,
  onFacebookSuccess,
  onFacebookFail,
}: Props) {
  const { data } = useQuery(SOCIAL_AUTH_AVAILABILITY, {
    variables: { surface },
    fetchPolicy: "network-only",
  });
  const googleAvailable = data?.socialAuthAvailability?.google === true;
  const facebookAvailable = data?.socialAuthAvailability?.facebook === true
    && Boolean(onFacebookSuccess && onFacebookFail);
  const hasSocialProvider = googleAvailable || facebookAvailable;
  const divider = useMemo(() => <Divider>{dividerLabel}</Divider>, [dividerLabel]);

  if (!hasSocialProvider) return null;

  return (
    <>
      {dividerPosition === "before" && divider}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          margin: "0 auto",
          maxWidth: 400,
          width: "100%",
        }}
      >
        {googleAvailable && (
          <GoogleLoginButton disabled={disabled} onSuccess={onGoogleSuccess} onError={onGoogleError} />
        )}
        {facebookAvailable && onFacebookSuccess && onFacebookFail && (
          <FacebookLoginButton
            disabled={disabled}
            label={facebookLabel}
            onSuccess={onFacebookSuccess}
            onFail={onFacebookFail}
          />
        )}
      </div>

      {dividerPosition === "after" && divider}
    </>
  );
}

export default memo(SocialLoginInner);
