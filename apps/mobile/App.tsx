/**
 * BMS POS — mobile client
 * โครงกลุ่ม A เท่านั้น: navigation + design system + หน้าจอ mock data
 * ยังไม่ต่อ GraphQL/WS จริง — รอ schema/auth ฝั่ง backend นิ่งก่อนตามแผนที่ตกลงกันไว้
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { DeviceProvider } from './src/state/DeviceContext';
import { SessionProvider } from './src/state/SessionContext';
import { StoreModeProvider } from './src/state/StoreModeContext';
import { RootNavigator } from './src/navigation/RootNavigator';

function ThemedStatusBar() {
  const { scheme } = useTheme();
  // ⚠️ `backgroundColor` ไม่มีใน StatusBar type ของ RN รุ่นนี้แล้ว (คุมสีพื้นหลังผ่านหน้าจอเองแทน)
  return (
    <StatusBar
      barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {/* DeviceProvider อยู่นอก navigator — "เครื่องนี้เป็นของร้านไหน" เป็นของทั้งแอป
            ไม่ใช่ของหน้าจอใดหน้าจอหนึ่ง และหน้า Login ต้องอ่านได้ก่อนเข้าแท็บ */}
        <StoreModeProvider>
          <DeviceProvider>
            {/* SessionProvider อยู่นอก navigator — หน้า Login เป็นคนเขียน ส่วนแท็บข้างในเป็นคนอ่าน
                ถ้าอยู่ข้างใน MainTabs ค่าที่เลือกตอนล็อกอินจะไปไม่ถึง */}
            <SessionProvider>
              <ThemedStatusBar />
              <RootNavigator />
            </SessionProvider>
          </DeviceProvider>
        </StoreModeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
