"use client";

import dynamic from "next/dynamic";
import HeaderBar from "./HeaderBar";

export const PublicHeaderBar = HeaderBar;

export const PublicBreadcrumbs = dynamic(() => import("./Breadcrumbs"), {
  ssr: false,
  loading: () => null,
});
