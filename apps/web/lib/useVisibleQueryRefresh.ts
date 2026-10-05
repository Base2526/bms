"use client";

import { useEffect } from "react";

type RefreshableQuery = {
  startPolling: (interval: number) => void;
  stopPolling: () => void;
  refetch: () => Promise<unknown>;
};

export function useVisibleQueryRefresh({ startPolling, stopPolling, refetch }: RefreshableQuery) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refetch().catch(() => {});
    };
    const syncVisibility = () => {
      if (document.visibilityState === "visible") startPolling(15_000);
      else stopPolling();
    };
    const onVisibility = () => { syncVisibility(); refresh(); };
    syncVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [startPolling, stopPolling, refetch]);
}
