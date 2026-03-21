"use client";

import React, { memo, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button, Space } from "antd";

const LeftOutlinedIcon = dynamic(() => import("@ant-design/icons").then((m) => m.LeftOutlined), {
  ssr: false,
  loading: () => <span style={{ display: "inline-block", width: 14 }} />,
});

type Props = {
  backLabel: string;
  homeLabel: string;
  homeHref?: string;
};

function AuthHeaderInner({ backLabel, homeLabel, homeHref = "/" }: Props) {
  const router = useRouter();

  const onBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.replace(homeHref);
  }, [router, homeHref]);

  const extra = useMemo(
    () => (
      <Space className="auth-card-actions" size="small">
        <Button type="text" icon={<LeftOutlinedIcon />} onClick={onBack} aria-label={backLabel}>
          {backLabel}
        </Button>
        <Button type="link" href={homeHref} aria-label={homeLabel}>
          {homeLabel}
        </Button>
      </Space>
    ),
    [backLabel, homeHref, homeLabel, onBack]
  );

  return extra;
}

export default memo(AuthHeaderInner);
