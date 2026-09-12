/**
 * BMS POS — mobile client
 * GraphQL HTTP เป็นทางอ่าน/สั่งงาน และ GraphQL WS เป็น invalidation hint ระดับแอป
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
import { RealtimeProvider } from './src/state/RealtimeContext';
import { BmsGraphqlProvider } from './src/graphql/BmsGraphqlProvider';
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
        <DeviceProvider>
          <BmsGraphqlProvider>
            <StoreModeProvider>
              {/* SessionProvider อยู่นอก navigator — หน้า Login เป็นคนเขียน ส่วนแท็บข้างในเป็นคนอ่าน */}
              <SessionProvider>
                <RealtimeProvider>
                  <ThemedStatusBar />
                  <RootNavigator />
                </RealtimeProvider>
              </SessionProvider>
            </StoreModeProvider>
          </BmsGraphqlProvider>
        </DeviceProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
