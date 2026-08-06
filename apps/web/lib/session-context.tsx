// apps/web/lib/session-context.tsx
'use client';
import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from '@/lib/useSession';

type SessionValue = {
  user: { id:number; email:string; role:string; themePreference?: string | null; language?: string | null } | null;
  admin: { id:number; email:string; role:string; themePreference?: string | null; language?: string | null } | null;
  isAuthenticated: boolean;
  loading: boolean;
  refreshSession: () => void;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { user: rawUser, admin, isAuthenticated, loading, refreshSession } = useSession();
  const user = rawUser ?? admin ?? null;
  const value = useMemo(
    () => ({ user, admin, isAuthenticated, loading, refreshSession }),
    [user, admin, isAuthenticated, loading, refreshSession]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessionCtx must be used within <SessionProvider>');
  return v;
}
