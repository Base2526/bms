"use client";

import React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ApolloProvider } from "@apollo/client";
import { client } from "@/lib/apollo";

import { I18nProvider } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";
import AntdThemeProvider from "@/app/AntdThemeProvider";
import RouteProgress from "@/components/RouteProgress";

const SessionLayer = dynamic(() => import("@/app/SessionLayer"), {
  ssr: false,
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
