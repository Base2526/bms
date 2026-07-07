import 'antd/dist/reset.css';
import "./globals.css";
import { cookies } from "next/headers";
import type { Metadata } from "next";

import type { Lang } from "@/i18n";
import type { ThemeMode } from "@/lib/theme";
import ClientProviders from "./ClientProviders";  // เราจะสร้างไฟล์นี้ใหม่
import { getBuildInfo } from "@/lib/buildInfo";

const { buildId, buildTime } = getBuildInfo();
export const metadata: Metadata = {
  metadataBase: new URL(`${process.env.NEXT_PUBLIC_BASE_URL || 'https://jachoei.com'}`),
  icons: {
    icon: `/favicon.ico?v=${buildId}-${buildTime}`
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const langCookie = cookieStore.get("lang")?.value as Lang | undefined;
  const lang: Lang = langCookie === "en" ? "en" : "th";

  const themeCookie = cookieStore.get("theme")?.value as ThemeMode | undefined;
  const themeMode: ThemeMode = themeCookie === "light" || themeCookie === "dark" || themeCookie === "system" ? themeCookie : "system";
  const themeClassName = themeMode === "dark" ? "dark" : undefined;

  const themeInitScript = `(() => {
    try {
      const el = document.documentElement;

      const readCookie = (name) => {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
      };

      let mode = readCookie('theme');
      if (!mode) {
        try { mode = localStorage.getItem('theme'); } catch (e) {}
      }
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'system';

      const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const sys = mq && mq.matches ? 'dark' : 'light';
      const resolved = mode === 'system' ? sys : mode;

      el.dataset.themeMode = mode;
      el.dataset.theme = resolved;
      if (resolved === 'dark') el.classList.add('dark'); else el.classList.remove('dark');
      el.style.colorScheme = resolved;

      const onChange = () => {
        try {
          if (el.dataset.themeMode !== 'system') return;
          const nextResolved = mq && mq.matches ? 'dark' : 'light';
          el.dataset.theme = nextResolved;
          if (nextResolved === 'dark') el.classList.add('dark'); else el.classList.remove('dark');
          el.style.colorScheme = nextResolved;
        } catch (e) {}
      };

      if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) {}
  })();`;

  return (
    <html lang={lang} className={themeClassName} data-theme-mode={themeMode} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {/* ส่ง lang ให้ ClientProviders */}
        <ClientProviders lang={lang}>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
