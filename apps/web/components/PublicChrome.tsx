"use client";

import dynamic from "next/dynamic";

export const PublicHeaderBar = dynamic(() => import("./HeaderBar"), {
  ssr: false,
  loading: () => <div style={{ height: 64, background: "var(--app-surface)" }} />,
});

export const PublicBreadcrumbs = dynamic(() => import("./Breadcrumbs"), {
  ssr: false,
  loading: () => null,
});
