// app/(main)/layout.tsx
import { cookies } from "next/headers";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

const HeaderBar = dynamic(() => import("@/components/HeaderBar"), {
  ssr: false,
  loading: () => <div style={{ height: 64, background: "#fff" }} />,
});

const Breadcrumbs = dynamic(() => import("@/components/Breadcrumbs"), {
  ssr: false,
  loading: () => null,
});

const AppFooter = dynamic(() => import("@/components/footer/AppFooter"), {
  ssr: false,
  loading: () => <div style={{ height: 220 }} />,
});

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

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  return (
    <>
      <HeaderBar isMobile={false} />

      <main
        style={{
          minHeight: "100vh",
          background: "#ffffff",
        }}
      >
        <div className="jachoei-main-shell">
          <div className="jachoei-breadcrumb-wrap">
            <Breadcrumbs />
          </div>

          <div className="jachoei-main-content">{children}</div>
        </div>
      </main>

      <AppFooter lang={lang} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .jachoei-main-shell {
              width: 100%;
              max-width: 1400px;
              margin: 16px auto 0;
              padding: 0 16px;
            }

            .jachoei-breadcrumb-wrap {
              display: block;
              margin-bottom: 12px;
            }

            .jachoei-main-content {
              min-height: 360px;
              background: #ffffff;
              border-radius: 16px;
              padding: 16px;
            }

            @media (max-width: 767px) {
              .jachoei-main-shell {
                max-width: 100%;
                margin: 0 auto;
                padding: 0;
              }

              .jachoei-breadcrumb-wrap {
                display: none;
              }

              .jachoei-main-content {
                min-height: auto;
                border-radius: 0;
                padding: 0;
                box-shadow: 0 0 4px rgba(0,0,0,0.06);
              }
            }
          `,
        }}
      />
    </>
  );
}