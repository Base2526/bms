"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { hasDesktopPosBridge, readDesktopAppInfo, type DesktopAppInfo } from "@/lib/pos/deviceTokenClient";
import type { DesktopUpdateResult } from "@/lib/bms/desktopReleasePolicy";
import { useI18n } from "@/lib/i18nContext";
import styles from "./DesktopUpdateMenu.module.css";

const platformLabels: Record<string, string> = {
  "windows-x64": "Windows 64-bit",
  "windows-x86-legacy": "Windows 32-bit",
  "ubuntu-x64": "Ubuntu 64-bit",
  "macos-arm64": "Mac Apple Silicon",
  "macos-x64": "Mac Intel",
};

export default function DesktopUpdateMenu({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState(false);
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [result, setResult] = useState<DesktopUpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  const request = useRef<AbortController | null>(null);
  const lastCheck = useRef(0);

  const positionMenu = useCallback(() => {
    const bounds = menu.current?.querySelector("summary")?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(336, window.innerWidth - 32);
    const left = Math.max(16, Math.min(bounds.right + 54 - width, window.innerWidth - width - 16));
    menu.current?.style.setProperty("--update-top", `${bounds.bottom + 10}px`);
    menu.current?.style.setProperty("--update-left", `${left}px`);
  }, []);

  // Every POS surface can host this menu, including those without Desktop's popup delegation.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    };
    const otherPopup = (event: Event) => {
      if (menu.current?.open && event.target instanceof HTMLDetailsElement
        && event.target !== menu.current && event.target.open
        && event.target.closest("header") === menu.current.closest("header")) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("toggle", otherPopup, true);
    document.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("toggle", otherPopup, true);
      document.removeEventListener("scroll", positionMenu, true);
    };
  }, [positionMenu]);

  const check = useCallback(async (force = false) => {
    if (request.current || (!force && Date.now() - lastCheck.current < 300_000)) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const app = await readDesktopAppInfo();
      if (request.current !== controller) return;
      if (controller.signal.aborted) throw new Error("Update check timed out");
      setInfo(app);
      if (!app) {
        setResult({ status: "unknown-version", releases: [] });
        return;
      }
      const params = new URLSearchParams({ version: app.version, platform: app.platform });
      if (app.arch) params.set("arch", app.arch);
      const response = await fetch(`/api/retail-local/desktop-update?${params}`, {
        signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) throw new Error("Update check failed");
      const next: DesktopUpdateResult = await response.json();
      if (request.current !== controller) return;
      if (controller.signal.aborted) throw new Error("Update check timed out");
      setResult(next);
      setSelectedId((previous) => app.arch
        ? next.releases[0]?.id ?? ""
        : next.releases.some((release) => release.id === previous) ? previous : "");
      lastCheck.current = Date.now();
    } catch {
      if (request.current !== controller) return;
      setResult(null);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasDesktopPosBridge()) return;
    setDesktop(true);
    void check();
    const refresh = () => { if (document.visibilityState === "visible") void check(); };
    const interval = window.setInterval(refresh, 30 * 60_000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("resize", positionMenu);
    return () => {
      request.current?.abort();
      request.current = null;
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("resize", positionMenu);
    };
  }, [check, positionMenu]);

  if (!desktop || result?.status !== "available" || result.releases.length === 0) return null;
  const release = result.releases.find((item) => item.id === selectedId);
  const title = t("pos_desktop_update.available");
  const close = () => {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
  };

  return (
    <details ref={menu} className={`${styles.menu} ${className}`} data-desktop-popup onToggle={(event) => {
      if (event.currentTarget.open) {
        positionMenu();
        void check();
      }
    }}>
      <summary className={`${styles.trigger} ${styles.available}`}
        aria-label={title} title={title}>
        <DownloadOutlined aria-hidden="true" />
        <span className={styles.dot} aria-hidden="true" />
      </summary>
      <section className={styles.popover} aria-label={t("pos_desktop_update.title")}>
        <div className={styles.heading}>
          <div><strong>{title}</strong><small>BMS POS{info ? ` · v${info.version}` : ""}</small></div>
          <button type="button" className={styles.refresh} disabled={checking}
            onClick={() => void check(true)} title={t("pos_desktop_update.check")} aria-label={t("pos_desktop_update.check")}>
            <ReloadOutlined spin={checking} />
          </button>
        </div>
        <div className={styles.body} aria-live="polite">
          {checking ? <p className={styles.muted}>{t("pos_desktop_update.checking")}</p>
            : <>
              {!info?.arch ? <label className={styles.platform}>{t("pos_desktop_update.platform")}
                <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">{t("pos_desktop_update.choose_platform")}</option>
                  {result.releases.map((item) => <option value={item.id} key={item.id}>
                    {platformLabels[item.platform]} · v{item.version}
                  </option>)}
                </select>
              </label> : null}
              {release ? <>
                <div className={styles.version}><strong>v{release.version}</strong><span>{t("pos_desktop_update.ready")}</span></div>
                {release.releaseNotes ? <p className={styles.notes}>{release.releaseNotes}</p> : null}
                <small className={styles.muted}>{platformLabels[release.platform]} · {release.minOs}</small>
              </> : null}
              <p className={styles.hint}>{t("pos_desktop_update.install_hint")}</p>
            </>}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.later} onClick={close}>{t("pos_desktop_update.later")}</button>
          {release && !checking
            ? <a className={styles.download} href={release.downloadUrl} target="_blank" rel="noopener noreferrer">
              <DownloadOutlined aria-hidden="true" /> {t("pos_desktop_update.download")}
            </a>
            : <button type="button" className={styles.download} disabled><DownloadOutlined aria-hidden="true" /> {t("pos_desktop_update.download")}</button>}
        </div>
      </section>
    </details>
  );
}
