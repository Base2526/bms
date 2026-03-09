// app/(main)/layout.tsx
import { cookies } from "next/headers";
import type { Metadata } from "next";
import AppLayout from "@/components/AppLayout";

const SITE_NAME = "จ่าเฉย (JACHOEI)";
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  const seo = {
    th: {
      title: "จ่าเฉย (Jachoei) — ตรวจสอบการโกงออนไลน์",
      desc: "ฐานข้อมูลการโกงออนไลน์ ตรวจสอบเบอร์โทร บัญชีธนาคาร ลิงก์ และชื่อเพจ จากรายงานผู้ใช้งานจริง",
    },
    en: {
      title: "จ่าเฉย (Jachoei) — Online Scam Database",
      desc: "Search and report online scams. Check phone numbers, bank accounts, links, and pages from community reports.",
    },
  }[lang];

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: seo.title,
      template: `%s | ${SITE_NAME}`,
    },
    description: seo.desc,
    alternates: { canonical: SITE_URL },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: seo.title,
      description: seo.desc,
      url: SITE_URL,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.desc,
      images: ["/og.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  return <AppLayout initialLang={langCookie}>{children}</AppLayout>;
}