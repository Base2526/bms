import React, { createContext, useContext, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { AppColors, ColorScheme, colorsFor } from './colors';
import { spacing, radius, minTouchTarget } from './spacing';
import { typography } from './typography';

export interface Theme {
  scheme: ColorScheme;
  colors: AppColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  minTouchTarget: number;
}

interface ThemeContextValue extends Theme {
  setScheme: (scheme: ColorScheme) => void;
}

function resolveScheme(
  preference: ColorSchemeName | null | undefined,
): ColorScheme {
  return preference === 'dark' ? 'dark' : 'light';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ไม่มี "system" เป็นตัวเลือกที่สาม (ต่างจากเว็บ) เพราะจอ POS หน้าร้านตั้งใจให้พนักงาน
// เลือกเองแบบตายตัวต่อเครื่อง ไม่อยากให้ธีมสลับเองตอนแดดเปลี่ยนกลางกะขาย
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    resolveScheme(Appearance.getColorScheme()),
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: colorsFor(scheme),
      spacing,
      radius,
      typography,
      minTouchTarget,
      setScheme,
    }),
    [scheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme ต้องถูกเรียกใต้ <ThemeProvider>');
  return ctx;
}
