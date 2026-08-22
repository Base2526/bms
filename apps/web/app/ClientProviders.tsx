"use client";

import React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ApolloProvider } from "@apollo/client";
import { Spin } from "antd";
import { client } from "@/lib/apollo";

import { I18nProvider } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";
import AntdThemeProvider from "@/app/AntdThemeProvider";
import RouteProgress from "@/components/RouteProgress";

// ssr:false = server ส่ง placeholder เปล่าให้เสมอสำหรับทุกอย่างใต้ SessionLayer (รวม
// AdminSidebar) เพราะ session มาจาก cookie ที่รู้ได้แค่ฝั่ง client (SWR ไป /api/auth/me)
// เดิมไม่มี `loading` เลย → หน้าขาวล้วนจนกว่า client bundle จะโหลด+parse+hydrate เสร็จ
// (สาเหตุหลักของ "เมนู loading ช้ามาก" ตอนโหลดครั้งแรก/reload) — spinner นี้ server-render
// ลงไปใน HTML แรกได้ปกติเพราะเป็น component ธรรมดาไม่พึ่ง client-only API เลย ไม่กระทบ
// auth logic ใด ๆ (SessionLayer เองไม่เปลี่ยน)
const SessionLayer = dynamic(() => import("@/app/SessionLayer"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
      <Spin size="large" />
    </div>
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
  return isAuthPath(pathname) || pathname === "/checkout" || pathname === "/pos";
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
      <AntdThemeProvider>
        <I18nProvider lang={lang}>
          <RouteProgress />
          {onPublicStandaloneRoute ? children : <SessionLayer>{children}</SessionLayer>}
        </I18nProvider>
      </AntdThemeProvider>
    </ApolloProvider>
  );
}
