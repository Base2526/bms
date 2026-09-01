"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordSupportActivity } from "@/lib/supportActivity";

export function SupportActivityRecorder({ scopeKey }: { scopeKey: string }) {
  const pathname = usePathname() || "/";
  const previous = useRef<string | null>(null);

  useEffect(() => {
    recordSupportActivity(scopeKey, {
      category: "navigation",
      action: "ui.route_view",
      status: "success",
      context: { route: pathname, previousRoute: previous.current },
    });
    previous.current = pathname;
  }, [pathname, scopeKey]);

  useEffect(() => {
    const online = () => recordSupportActivity(scopeKey, { category: "network", action: "network.online", status: "success", context: { route: window.location.pathname, online: true } });
    const offline = () => recordSupportActivity(scopeKey, { category: "network", action: "network.offline", status: "error", context: { route: window.location.pathname, online: false } });
    const error = (event: ErrorEvent) => recordSupportActivity(scopeKey, { category: "ui", action: "ui.window_error", status: "error", context: { route: window.location.pathname, errorName: event.error?.name ?? "Error" } });
    const rejection = (event: PromiseRejectionEvent) => recordSupportActivity(scopeKey, { category: "ui", action: "ui.unhandled_rejection", status: "error", context: { route: window.location.pathname, errorName: event.reason?.name ?? typeof event.reason } });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, [scopeKey]);

  return null;
}
