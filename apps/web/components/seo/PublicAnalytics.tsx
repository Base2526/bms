"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { analyticsCta, analyticsPage, analyticsSource, validMeasurementId } from "@/lib/publicAnalytics";
import { ANALYTICS_CONSENT_EVENT, analyticsConsentDeadline, readAnalyticsConsent, syncAnalyticsConsent } from "@/lib/analyticsConsent";

type AnalyticsWindow = Window & {
  bmsAnalyticsLayer?: IArguments[];
  [key: `ga-disable-${string}`]: boolean;
};

/** Basic opt-in: no Google script/request until permission; no events queued while it loads. */
export default function PublicAnalytics({ measurementId, learningPaths }: { measurementId: string | null; learningPaths: string[] }) {
  const pathname = usePathname();
  const sourceRef = useRef<string | null>(null);
  const lastPageRef = useRef("");
  useEffect(() => {
    const id = validMeasurementId(measurementId || undefined);
    if (!id) return;
    const win = window as unknown as AnalyticsWindow;
    let disposed = false;
    const source = sourceRef.current ??= analyticsSource(window.location.href, document.referrer);
    const allowed = () => !disposed && readAnalyticsConsent() === "allow" &&
      !!analyticsPage(window.location.pathname, learningPaths) && navigator.doNotTrack !== "1" &&
      !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
    function gtag(..._args: unknown[]) { (win.bmsAnalyticsLayer ||= []).push(arguments); }
    const disable = () => { win[`ga-disable-${id}`] = true; };
    const forgetCookies = () => {
      // Only this integration's cookies, across GA's automatic parent-domain choices.
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (!/^bms_analytics_/.test(name)) continue;
        const parts = location.hostname.split(".");
        document.cookie = `${name}=; Max-Age=0; Path=/`;
        for (let i = 0; i < parts.length - 1; i++) {
          document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${parts.slice(i).join(".")}`;
        }
      }
    };
    const send = (event: string, extra: Record<string, string> = {}) => {
      const page = analyticsPage(window.location.pathname, learningPaths);
      if (!allowed() || !page) return;
      gtag("event", event, {
        send_to: id, page_location: `${location.origin}${page.path}`,
        page_title: `BMS ${page.path}`, page_referrer: "", language: page.locale,
        discovery_source: source, ...extra,
      });
    };
    const pageView = () => {
      if (!allowed() || lastPageRef.current === location.pathname) return;
      win[`ga-disable-${id}`] = false;
      send("page_view");
      lastPageRef.current = location.pathname;
    };
    let script: HTMLScriptElement | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const ready = () => {
      if (!allowed()) return;
      win[`ga-disable-${id}`] = false;
      if (script?.dataset.configured !== "true") {
        gtag("consent", "default", {
          analytics_storage: "granted", ad_storage: "denied",
          ad_user_data: "denied", ad_personalization: "denied",
        });
        gtag("js", new Date());
        gtag("config", id, {
          send_page_view: false, allow_google_signals: false,
          allow_ad_personalization_signals: false, cookie_prefix: "bms_analytics",
          cookie_expires: 180 * 24 * 60 * 60, cookie_flags: "SameSite=Lax;Secure",
          page_location: `${location.origin}${location.pathname}`,
          page_title: "BMS", page_referrer: "", ignore_referrer: true,
        });
        if (script) script.dataset.configured = "true";
      }
      pageView();
    };
    const update = () => {
      clearTimeout(expiryTimer);
      if (!allowed()) {
        disable();
        lastPageRef.current = "";
        if (readAnalyticsConsent() !== "allow") forgetCookies();
        return;
      }
      const deadline = analyticsConsentDeadline();
      // Browser timers are signed 32-bit milliseconds; re-arm long-lived tabs until expiry.
      if (deadline) expiryTimer = setTimeout(update, Math.min(2_147_483_647, Math.max(1, deadline - Date.now() + 1)));
      script = document.querySelector<HTMLScriptElement>("script[data-bms-analytics]");
      if (script?.dataset.loaded === "true") { ready(); return; }
      if (script) { script.addEventListener("load", ready, { once: true }); return; }
      script = document.createElement("script");
      script.async = true;
      script.dataset.bmsAnalytics = "true";
      script.referrerPolicy = "no-referrer";
      script.src = `https://www.googletagmanager.com/gtag/js?id=${id}&l=bmsAnalyticsLayer`;
      script.onload = () => { if (script) script.dataset.loaded = "true"; ready(); };
      script.onerror = () => { script?.remove(); script = null; };
      document.head.appendChild(script);
    };
    const storage = (event: StorageEvent) => { syncAnalyticsConsent(event); update(); };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || script?.dataset.loaded !== "true") return;
      const href = link.getAttribute("href") || "";
      const action = analyticsCta(href, location.origin);
      if (action) send("public_cta_click", { cta_action: action });
      // Disable before a client navigation reaches account/POS/tenant routes.
      try { const url = new URL(href, location.origin); if (url.origin === location.origin && !analyticsPage(url.pathname, learningPaths)) disable(); }
      catch { /* Invalid links do not become telemetry. */ }
    };
    disable();
    update();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, update);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("click", click, true);
    return () => {
      disposed = true;
      disable();
      clearTimeout(expiryTimer);
      script?.removeEventListener("load", ready);
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, update);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("click", click, true);
    };
  }, [measurementId, pathname, learningPaths]);
  return null;
}
