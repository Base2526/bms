"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

import { SessionProvider, useSessionCtx } from "@/lib/session-context";
import { GlobalChatListener } from "@/components/GlobalChatListener";
import { GlobalInboxNotifier } from "@/components/GlobalInboxNotifier";
import { GlobalMentionNotifier } from "@/components/GlobalMentionNotifier";
import { GlobalFailureNotifier } from "@/components/GlobalFailureNotifier";
import { SupportActivityRecorder } from "@/components/SupportActivityRecorder";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import { getLangCookie, setLangCookie, isLang } from "@/lib/lang";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

// Keep these global wires out of the auth routes.
function GlobalWiresWrapper() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { user, admin } = useSessionCtx();
  const meId = user?.id || admin?.id;
  const isAdminRoute = pathname.startsWith("/admin");
  const sessionThemePreference = admin?.themePreference ?? user?.themePreference;
  // Admin takes precedence over user, same reasoning as themePreference above (and the
  // "user = rawUser ?? admin" precedence already used elsewhere in session-context.tsx).
  const sessionLanguage = admin?.language ?? user?.language;
  const supportScope = admin?.id && !admin.is_platform_admin
    ? `admin-${admin.tenant_id ?? "default"}-${admin.id}`
    : null;

  React.useEffect(() => {
    const frontendLogout = () => (window.location.href = "/admin/login");
    const backendLogout = () => (window.location.href = "/admin/login");

    window.addEventListener("frontend-logout", frontendLogout);
    window.addEventListener("backend-logout", backendLogout);

    return () => {
      window.removeEventListener("frontend-logout", frontendLogout);
      window.removeEventListener("backend-logout", backendLogout);
    };
  }, []);

  React.useEffect(() => {
    if (!isThemeMode(sessionThemePreference)) return;
    if (getThemeMode() === sessionThemePreference) return;
    setThemeMode(sessionThemePreference);
  }, [sessionThemePreference]);

  React.useEffect(() => {
    if (!isLang(sessionLanguage)) return;
    if (getLangCookie() === sessionLanguage) return;
    // Unlike theme (pure client-side DOM/class toggle), the `lang` cookie is read
    // server-side in app/layout.tsx to pick the dictionary — a fresh server render is
    // required for already-mounted pages to actually pick up the new language, same as
    // HeaderBar.tsx's own changeLang(). Note: on first login this refresh can briefly
    // race with whatever language the previous session/device had cached in the cookie.
    setLangCookie(sessionLanguage);
    router.refresh();
  }, [sessionLanguage, router]);

  return (
    <>
      {meId && !isAdminRoute ? <GlobalChatListener /> : null}
      {admin?.id ? <GlobalInboxNotifier /> : null}
      {admin?.id ? <GlobalMentionNotifier /> : null}
      {admin?.id ? <GlobalFailureNotifier /> : null}
      {supportScope ? <SupportActivityRecorder scopeKey={supportScope} /> : null}
    </>
  );
}

export default function SessionLayer({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GlobalWiresWrapper />
      {children}
    </SessionProvider>
  );
}
