import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList, MainTabParamList } from './types';

type ParentAwareNavigation = {
  getParent<T>(): T | undefined;
};

export function getTabNavigation(navigation: ParentAwareNavigation) {
  const tab = navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  if (!tab) throw new Error('หน้าหลักต้องอยู่ใต้ MainTabs');
  return tab;
}

export function getAppNavigation(navigation: ParentAwareNavigation) {
  const app = getTabNavigation(navigation).getParent<
    NativeStackNavigationProp<AppStackParamList>
  >();
  if (!app) throw new Error('MainTabs ต้องอยู่ใต้ AppNavigator');
  return app;
}
