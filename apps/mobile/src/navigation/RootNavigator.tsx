import React from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { LinkingOptions } from '@react-navigation/native';
import LoginScreen from '../screens/LoginScreen';
import DeviceSettingsScreen from '../screens/settings/DeviceSettingsScreen';
import { MainTabs } from './MainTabs';
import { useTheme } from '../theme/ThemeProvider';
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
    <NavigationContainer theme={navTheme} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Settings" component={DeviceSettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
