"use client";

import React, { useMemo } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";

import { useTheme } from "@/lib/useTheme";

export default function AntdThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();

  const themeConfig = useMemo(() => {
    const isDark = resolvedTheme === "dark";

    return {
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: "#1677ff",
        colorInfo: "#1677ff",
      },
    };
  }, [resolvedTheme]);

  return <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>;
}
