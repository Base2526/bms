"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./not-found.module.css";

export default function NotFoundActions({ lang, homePath }: { lang: "th" | "en"; homePath: string }) {
  const pathname = usePathname() || "/";
  const destination = pathname.startsWith("/admin/") || pathname === "/admin"
    ? { href: "/admin", label: lang === "en" ? "Go to workspace" : "ไปหน้าจัดการ" }
    : pathname.startsWith("/pos/") || pathname === "/pos"
      ? { href: "/pos", label: lang === "en" ? "Go to POS" : "ไปหน้าขาย" }
      : pathname.startsWith("/shop/") || pathname === "/shop"
        ? { href: "/shop", label: lang === "en" ? "Browse shops" : "ดูร้านค้าทั้งหมด" }
        : { href: homePath, label: lang === "en" ? "Back to home" : "กลับหน้าหลัก" };

  return (
    <div className={styles.actions}>
      <Link href={destination.href} className={styles.primaryAction}>{destination.label}</Link>
      {destination.href !== homePath && (
        <Link href={homePath} className={styles.secondaryAction}>
          {lang === "en" ? "Back to home" : "กลับหน้าหลัก"}
        </Link>
      )}
    </div>
  );
}
