"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import {
  type ResolvedTheme,
  type ThemeMode,
  applyThemeToDom,
  getResolvedTheme,
  getThemeMode,
  setThemeMode,
  subscribeTheme,
} from "@/lib/theme";

type ThemeState = {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
};

const SERVER_SNAPSHOT: ThemeState = { theme: "system", resolvedTheme: "light" };

let lastTheme: ThemeMode | null = null;
let lastResolved: ResolvedTheme | null = null;
let lastSnapshot: ThemeState | null = null;

function getSnapshot(): ThemeState {
  const theme = getThemeMode();
  const resolvedTheme = getResolvedTheme();

  if (lastSnapshot && lastTheme === theme && lastResolved === resolvedTheme) {
    return lastSnapshot;
  }

  lastTheme = theme;
  lastResolved = resolvedTheme;
  lastSnapshot = { theme, resolvedTheme };
  return lastSnapshot;
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

export function useTheme() {
  const state = useSyncExternalStore(subscribeTheme, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
  }, []);

  // Ensure DOM matches the external-store state.
  // IMPORTANT: never mutate DOM during render (can cause infinite update loops
  // with useSyncExternalStore when getSnapshot reads from the same source).
  useLayoutEffect(() => {
    const el = document.documentElement;
    const domMode = el.dataset.themeMode as ThemeMode | undefined;
    if (domMode !== state.theme) {
      applyThemeToDom(state.theme);
    }
  }, [state.theme]);

  return {
    theme: state.theme,
    resolvedTheme: state.resolvedTheme,
    setTheme,
  };
}
