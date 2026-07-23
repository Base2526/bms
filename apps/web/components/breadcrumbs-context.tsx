"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type BreadcrumbItem = {
  href?: string;
  isClickable?: boolean;
  isLast?: boolean;
  label: string;
};

type BreadcrumbOverrideState = {
  items: BreadcrumbItem[] | null;
  pathname: string | null;
};

type BreadcrumbContextValue = BreadcrumbOverrideState & {
  clearOverride: (pathname?: string) => void;
  setOverride: (pathname: string, items: BreadcrumbItem[]) => void;
};

const BreadcrumbsContext = createContext<BreadcrumbContextValue>({
  pathname: null,
  items: null,
  setOverride: () => {},
  clearOverride: () => {},
});

function sameItems(a: BreadcrumbItem[] | null, b: BreadcrumbItem[] | null) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return item.href === other.href
      && item.isClickable === other.isClickable
      && item.isLast === other.isLast
      && item.label === other.label;
  });
}

export function BreadcrumbsProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverrideState] = useState<BreadcrumbOverrideState>({
    pathname: null,
    items: null,
  });

  const setOverride = useCallback((pathname: string, items: BreadcrumbItem[]) => {
    setOverrideState((current) => {
      if (current.pathname === pathname && sameItems(current.items, items)) return current;
      return { pathname, items };
    });
  }, []);

  const clearOverride = useCallback((pathname?: string) => {
    setOverrideState((current) => {
      if (pathname && current.pathname !== pathname) return current;
      if (current.pathname === null && current.items === null) return current;
      return { pathname: null, items: null };
    });
  }, []);

  const value = useMemo<BreadcrumbContextValue>(() => ({
    ...override,
    setOverride,
    clearOverride,
  }), [clearOverride, override, setOverride]);

  return <BreadcrumbsContext.Provider value={value}>{children}</BreadcrumbsContext.Provider>;
}

export function useBreadcrumbsOverride() {
  return useContext(BreadcrumbsContext);
}
