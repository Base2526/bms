"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";

export default function MissingShopBreadcrumb({ lang }: { lang: "th" | "en" }) {
  const pathname = usePathname() || "/shop";
  const { clearOverride, setOverride } = useBreadcrumbsOverride();

  useEffect(() => {
    setOverride(pathname, [
      { href: "/", isClickable: true, label: lang === "en" ? "Home" : "หน้าแรก" },
      { href: "/shop", isClickable: true, label: "Shop" },
      { isClickable: false, isLast: true, label: lang === "en" ? "Page not found" : "ไม่พบหน้านี้" },
    ]);
    return () => clearOverride(pathname);
  }, [clearOverride, lang, pathname, setOverride]);

  return null;
}
