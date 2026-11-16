import React, { useCallback, useEffect, useRef } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { LinkingOptions } from '@react-navigation/native';
import LoginScreen from '../screens/LoginScreen';
import DeviceSettingsScreen from '../screens/settings/DeviceSettingsScreen';
import PrinterSettingsScreen from '../screens/settings/PrinterSettingsScreen';
import { AppNavigator } from './AppNavigator';
import { useTheme } from '../theme/ThemeProvider';
import { useDevice } from '../state/DeviceContext';
import { useSession } from '../state/SessionContext';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// ลิงก์จับคู่ที่แตะจากอีเมล/แชทบนไอแพดเครื่องนั้นเลย — ทางที่ไม่ต้องพิมพ์ token 43 ตัวด้วยนิ้ว
// และไม่ต้องใช้กล้อง (Simulator ไม่มีกล้อง จึงต้องมีทางที่ทดสอบได้จริงเสมอ)
// `initialRouteName: "Login"` บังคับให้ Login อยู่ใต้ Settings เสมอ — ไม่งั้นเปิดจากลิงก์แล้ว
// หน้าตั้งค่าไม่มีปุ่มย้อนกลับ กลายเป็นทางตัน
// ⚠️ scheme ต้องตรงกับที่ประกาศใน ios/BmsPos/Info.plist และ AndroidManifest.xml
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['bmspos://'],
  config: {
    initialRouteName: 'Login',
    screens: { Settings: 'pair' },
  },
};

export function RootNavigator() {
  const { scheme, colors } = useTheme();
  const { verify, target } = useDevice();
  const { signOut } = useSession();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const rejectionHandled = useRef(false);
  // A rejected first-pair candidate has no authenticated register to sign out.
  // Keep Settings mounted so the scan error is shown and the operator can retry.
  const authenticationRejected = target !== null && verify.kind === 'REJECTED';

  const handleAuthenticationRejected = useCallback(() => {
    if (!authenticationRejected || rejectionHandled.current || !navigationRef.isReady()) return;
    rejectionHandled.current = true;
    signOut();
    const state = navigationRef.getRootState();
    const activeRoute = state?.routes[state.index];
    // Keep the visible verification result, but remove Main from the back stack.
    // Reusing the Settings route key also preserves its unsaved pairing input.
    navigationRef.resetRoot(activeRoute?.name === 'Settings'
      ? {
          index: 1,
          routes: [
            { name: 'Login' },
            { name: 'Settings', key: activeRoute.key, params: activeRoute.params },
          ],
        }
      : { index: 0, routes: [{ name: 'Login' }] });
  }, [authenticationRejected, navigationRef, signOut]);

  useEffect(() => {
    if (!authenticationRejected) rejectionHandled.current = false;
    else handleAuthenticationRejected();
  }, [authenticationRejected, handleAuthenticationRejected]);

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      onReady={handleAuthenticationRejected}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={AppNavigator} />
        <Stack.Screen name="Settings" component={DeviceSettingsScreen} />
        <Stack.Screen
          name="PrinterSettings"
          component={PrinterSettingsScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
