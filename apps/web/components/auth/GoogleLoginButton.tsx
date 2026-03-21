"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "antd";
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from "@react-oauth/google";

type Props = {
  disabled?: boolean;
  onSuccess: (credentialResponse: CredentialResponse) => void;
  onError: () => void;
};

function GoogleLoginButtonInner({ disabled, onSuccess, onError }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect?.width ?? 0);
      if (w > 0) setWidth(w);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const skeletonStyle = useMemo(() => ({ width: "100%", height: 40 }), []);

  const wrapperStyle = useMemo(
    () => ({
      width: "100%",
      minHeight: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: disabled ? 0.65 : 1,
      pointerEvents: disabled ? ("none" as const) : ("auto" as const),
    }),
    [disabled]
  );

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  return (
    <div ref={ref} style={wrapperStyle}>
      {width ? (
        <GoogleOAuthProvider clientId={clientId}>
          <GoogleLogin
            onSuccess={onSuccess}
            onError={onError}
            useOneTap={false}
            width={width}
            size="large"
            text="continue_with"
            shape="rectangular"
            logo_alignment="left"
            theme="outline"
          />
        </GoogleOAuthProvider>
      ) : (
        <Skeleton.Button active block style={skeletonStyle} />
      )}
    </div>
  );
}

export default memo(GoogleLoginButtonInner);
