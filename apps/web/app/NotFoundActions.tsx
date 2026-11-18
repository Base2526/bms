"use client";

import { usePathname } from "next/navigation";
import { stripPublicLocale, localizedPublicPath } from "@/lib/publicSeo";
import { NotFoundLinks } from "@/components/not-found/BrandedNotFound";

export default function NotFoundActions({ lang, homePath }: { lang: "th" | "en"; homePath: string }) {
  const pathname = stripPublicLocale(usePathname() || "/");
  const destination = pathname.startsWith("/admin/") || pathname === "/admin"
    ? { href: "/admin", label: lang === "en" ? "Go to workspace" : "ไปหน้าจัดการ" }
    : pathname.startsWith("/pos/") || pathname === "/pos"
      ? { href: "/pos", label: lang === "en" ? "Go to POS" : "ไปหน้าขาย" }
      : pathname.startsWith("/shop/") || pathname === "/shop"
        ? { href: "/shop", label: lang === "en" ? "Browse shops" : "ดูร้านค้าทั้งหมด" }
        : pathname.startsWith("/learn/") || pathname === "/learn"
          ? { href: localizedPublicPath("/learn", lang), label: lang === "en" ? "Learning center" : "ศูนย์เรียนรู้" }
        : { href: homePath, label: lang === "en" ? "Back to home" : "กลับหน้าหลัก" };

  return (
    <NotFoundLinks
      primary={destination}
      secondary={destination.href === homePath ? undefined : {
        href: homePath,
        label: lang === "en" ? "Back to home" : "กลับหน้าหลัก",
      }}
    />
  );
}
