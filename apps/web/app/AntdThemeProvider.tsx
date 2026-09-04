"use client";

import React, { useMemo } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import thTH from "antd/locale/th_TH";

import { useI18n } from "@/lib/i18nContext";
import { useTheme } from "@/lib/useTheme";

export default function AntdThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  // ปุ่ม/ข้อความในตัวของ antd (Cancel, OK, ตัวเลือกวันที่, "ไม่มีข้อมูล") มาจาก locale ของ
  // ConfigProvider — ไม่เคยตั้งไว้ ทุก Modal ทั้งแอปจึงขึ้น "Cancel" ภาษาอังกฤษ แม้แต่บนจอ
  // เครื่องขายที่เป็นไทยล้วน · ผูกกับภาษาที่ผู้ใช้เลือกไว้แล้ว ไม่ตรึงเป็นไทยตายตัว
  const { lang } = useI18n();

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

  return <ConfigProvider theme={themeConfig} locale={lang === "en" ? enUS : thTH}>{children}</ConfigProvider>;
}
