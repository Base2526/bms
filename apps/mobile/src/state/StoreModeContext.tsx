import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import type { PreviewStoreMode } from '../lib/storeMode';
import { PosBootstrapDocument } from '../graphql/generated';
import { useDevice } from './DeviceContext';

interface StoreModeContextValue {
  mode: PreviewStoreMode;
}

const StoreModeContext = createContext<StoreModeContextValue | null>(null);

function serverMode(value: string | null | undefined): PreviewStoreMode {
  if (value === 'restaurant') return 'restaurant';
  if (value === 'pharmacy') return 'pharmacy';
  return 'general';
}

export function StoreModeProvider({ children }: { children: React.ReactNode }) {
  const { status, verify } = useDevice();
  const bootstrap = useQuery(PosBootstrapDocument, {
    skip: status !== 'PAIRED',
  });
  const verifiedArchetype =
    verify.kind === 'OK' ? verify.info.businessArchetype : null;
  const mode = serverMode(
    bootstrap.data?.bmsPosSession.businessArchetype ?? verifiedArchetype,
  );
  const value = useMemo(() => ({ mode }), [mode]);
  return (
    <StoreModeContext.Provider value={value}>
      {children}
    </StoreModeContext.Provider>
  );
}

export function useStoreMode(): StoreModeContextValue {
  const value = useContext(StoreModeContext);
  if (!value) throw new Error('useStoreMode ต้องอยู่ใต้ <StoreModeProvider>');
  return value;
}
