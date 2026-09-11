import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { PreviewStoreMode } from '../lib/storeMode';

interface StoreModeContextValue {
  mode: PreviewStoreMode;
  setMode: (mode: PreviewStoreMode) => void;
}

const StoreModeContext = createContext<StoreModeContextValue | null>(null);

export function StoreModeProvider({ children }: { children: React.ReactNode }) {
  // ค่า preview อยู่ในหน่วยความจำเท่านั้นโดยตั้งใจ: ไม่ใช่ config จริงและต้องไม่พึ่ง native
  // storage จนทำให้ tester เลือกโหมดไม่ได้เมื่อกำลังรัน JS ใหม่บน binary เก่า
  const [mode, setModeState] = useState<PreviewStoreMode>('restaurant');

  const setMode = useCallback((next: PreviewStoreMode) => {
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
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
