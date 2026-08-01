"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Spin } from "antd";

const SAFETY_TIMEOUT_MS = 8000;
const SPINNER_DELAY_MS = 200;

// Next.js App Router navigations (router.push/replace, <Link>, back/forward) all go through
// history.pushState/replaceState. Most nav buttons in this codebase are plain
// `<Button onClick={() => router.push(...)}>`, not <Link>, so a click listener on <a> tags alone
// misses them. Patching history is the only signal that covers every navigation path.
let historyPatched = false;
const navigationStartListeners = new Set<() => void>();

function notifyNavigationStart() {
  navigationStartListeners.forEach((fn) => fn());
}

function ensureHistoryPatched() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  const rawPush = window.history.pushState.bind(window.history);
  const rawReplace = window.history.replaceState.bind(window.history);

  // Next's internal router calls pushState/replaceState from inside a useInsertionEffect
  // (HistoryUpdater in app-router.js). Triggering a React state update synchronously from there
  // throws "useInsertionEffect must not schedule updates" — defer with setTimeout so our listener
  // runs in its own task, after that effect has finished.
  window.history.pushState = function patchedPushState(...args: Parameters<History["pushState"]>) {
    setTimeout(notifyNavigationStart, 0);
    return rawPush(...args);
  };
  window.history.replaceState = function patchedReplaceState(...args: Parameters<History["replaceState"]>) {
    setTimeout(notifyNavigationStart, 0);
    return rawReplace(...args);
  };
}

export default function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const [showSpinner, setShowSpinner] = React.useState(false);
  const safetyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinnerTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const growTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = React.useCallback(() => {
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
    if (growTimer.current) clearTimeout(growTimer.current);
    setShowSpinner(false);
    setWidth(100);
    setTimeout(() => {
      setActive(false);
      setWidth(0);
    }, 200);
  }, []);

  const start = React.useCallback(() => {
    setActive(true);
    setWidth(15);
    if (growTimer.current) clearTimeout(growTimer.current);
    growTimer.current = setTimeout(() => setWidth(70), 30);
    if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
    spinnerTimer.current = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    safetyTimer.current = setTimeout(stop, SAFETY_TIMEOUT_MS);
  }, [stop]);

  // Route committed (pathname or query changed) -> the destination is ready, hide the indicator.
  React.useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  React.useEffect(() => {
    ensureHistoryPatched();
    navigationStartListeners.add(start);
    return () => {
      navigationStartListeners.delete(start);
    };
  }, [start]);

  if (!active) return null;

  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          cursor: "wait",
          background: "transparent",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: 3,
          width: `${width}%`,
          background: "#1677ff",
          zIndex: 2001,
          transition: width >= 100 ? "width 150ms ease-out" : "width 3.5s cubic-bezier(0.1, 0.8, 0.9, 1)",
        }}
      />
      {showSpinner && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 2002,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: 999,
            fontSize: 13,
          }}
        >
          <Spin size="small" />
          <span>กำลังโหลด...</span>
        </div>
      )}
    </>
  );
}
