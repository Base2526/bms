"use client";

import React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ApolloProvider } from "@apollo/client";
import { client } from "@/lib/apollo";

import { I18nProvider } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";
import AntdThemeProvider from "@/app/AntdThemeProvider";

// ssr:false = server ส่ง placeholder เปล่าให้เสมอสำหรับทุกอย่างใต้ SessionLayer (รวม
// AdminSidebar) เพราะ session มาจาก cookie ที่รู้ได้แค่ฝั่ง client (SWR ไป /api/auth/me)
// Loading placeholder must stay visually empty. Rendering Ant Skeleton here can
// briefly expose its raw <ul>/<li> markers before CSS is ready during refresh.
const SessionLayer = dynamic(() => import("@/app/SessionLayer"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      style={{ minHeight: "100vh", width: "100%" }}
    />
  ),
});

function isAuthPath(pathname: string) {
  return (
    pathname === "/register" ||
    pathname === "/forgot" ||
    pathname === "/reset" ||
    pathname === "/verify-email" ||
    pathname === "/shop-signup" ||
    pathname.startsWith("/admin/login")
  );
}

function skipsSessionLayer(pathname: string) {
  return isAuthPath(pathname) || pathname === "/checkout" || pathname === "/pos" || pathname.startsWith("/pos/restaurant");
}

export default function ClientProviders({
  lang,
  children,
}: {
  lang: Lang;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const onPublicStandaloneRoute = skipsSessionLayer(pathname);

  return (
    <ApolloProvider client={client}>
      {/* I18nProvider ต้องอยู่ "นอก" AntdThemeProvider — provider ตัวนั้นอ่าน lang เพื่อเลือก
          locale ของ antd (ปุ่ม Cancel/OK ในตัว) ถ้าอยู่ข้างในจะได้ค่า default ของ context
          แทนภาษาที่ผู้ใช้เลือกไว้จริง */}
      <I18nProvider lang={lang}>
        <AntdThemeProvider>
          {onPublicStandaloneRoute ? children : <SessionLayer>{children}</SessionLayer>}
        </AntdThemeProvider>
      </I18nProvider>
    </ApolloProvider>
  );
}
