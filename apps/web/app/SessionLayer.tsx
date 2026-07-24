"use client";

import React from "react";

import { SessionProvider, useSessionCtx } from "@/lib/session-context";
import { GlobalChatListener } from "@/components/GlobalChatListener";
import { GlobalInboxNotifier } from "@/components/GlobalInboxNotifier";
import { GlobalMentionNotifier } from "@/components/GlobalMentionNotifier";

// Keep these global wires out of the auth routes.
function GlobalWiresWrapper() {
  const { user, admin } = useSessionCtx();
  const meId = user?.id || admin?.id;

  React.useEffect(() => {
    const frontendLogout = () => (window.location.href = "/login");
    const backendLogout = () => (window.location.href = "/admin/login");

    window.addEventListener("frontend-logout", frontendLogout);
    window.addEventListener("backend-logout", backendLogout);

    return () => {
      window.removeEventListener("frontend-logout", frontendLogout);
      window.removeEventListener("backend-logout", backendLogout);
    };
  }, []);

  return (
    <>
      {meId ? <GlobalChatListener /> : null}
      {admin?.id ? <GlobalInboxNotifier /> : null}
      {admin?.id ? <GlobalMentionNotifier /> : null}
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
