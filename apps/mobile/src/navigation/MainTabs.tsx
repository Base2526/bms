import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import { CartProvider } from '../state/CartContext';
import { ChecksProvider } from '../state/ChecksContext';
import { SalesProvider } from '../state/SalesContext';
import { useStoreMode } from '../state/StoreModeContext';
import {
  FloorIcon,
  KitchenIcon,
  SellIcon,
  ShiftIcon,
} from '../components/icons/TabIcons';

import MenuScreen from '../screens/sell/MenuScreen';
import CheckoutScreen from '../screens/sell/CheckoutScreen';
import ReceiptScreen from '../screens/sell/ReceiptScreen';
import SaleDetailScreen from '../screens/sell/SaleDetailScreen';
import SalesHistoryScreen from '../screens/sell/SalesHistoryScreen';
import FloorScreen from '../screens/floor/FloorScreen';
import CheckDetailScreen from '../screens/floor/CheckDetailScreen';
import TableMenuScreen from '../screens/floor/TableMenuScreen';
import KitchenBoardScreen from '../screens/kitchen/KitchenBoardScreen';
import ShiftScreen from '../screens/shift/ShiftScreen';

import type {
  MainTabParamList,
  SellStackParamList,
  FloorStackParamList,
  KitchenStackParamList,
  ShiftStackParamList,
} from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const SellStack = createNativeStackNavigator<SellStackParamList>();
const FloorStack = createNativeStackNavigator<FloorStackParamList>();
const KitchenStack = createNativeStackNavigator<KitchenStackParamList>();
const ShiftStack = createNativeStackNavigator<ShiftStackParamList>();

function SellNavigator() {
  return (
    <SellStack.Navigator screenOptions={{ headerShown: false }}>
      <SellStack.Screen name="Menu" component={MenuScreen} />
      <SellStack.Screen name="Checkout" component={CheckoutScreen} />
      <SellStack.Screen name="Receipt" component={ReceiptScreen} />
      <SellStack.Screen name="SalesHistory" component={SalesHistoryScreen} />
      <SellStack.Screen name="SaleDetail" component={SaleDetailScreen} />
    </SellStack.Navigator>
  );
}

function FloorNavigator() {
  return (
    <FloorStack.Navigator screenOptions={{ headerShown: false }}>
      <FloorStack.Screen name="Floor" component={FloorScreen} />
      <FloorStack.Screen name="CheckDetail" component={CheckDetailScreen} />
      <FloorStack.Screen name="TableMenu" component={TableMenuScreen} />
    </FloorStack.Navigator>
  );
}

function KitchenNavigator() {
  return (
    <KitchenStack.Navigator screenOptions={{ headerShown: false }}>
      <KitchenStack.Screen name="KitchenBoard" component={KitchenBoardScreen} />
    </KitchenStack.Navigator>
  );
}

function ShiftNavigator() {
  return (
    <ShiftStack.Navigator screenOptions={{ headerShown: false }}>
      <ShiftStack.Screen name="Shift" component={ShiftScreen} />
    </ShiftStack.Navigator>
  );
}

// แท็บล่าง 4 อัน ตรงกับ 4 หน้าจอหลักของกลุ่ม A ที่คุยกันไว้:
// ขาย(retail) · ผังโต๊ะ(restaurant) · จอครัว · กะ/ลิ้นชัก
// เมนู "ผังโต๊ะ" ไว้ให้ทุก build ก่อน — ตอนต่อ backend จริงค่อยซ่อนตามประเภทร้าน (retail vs restaurant)
export function MainTabs() {
  const { colors } = useTheme();
  const { mode } = useStoreMode();
  const sellTitle =
    mode === 'restaurant'
      ? 'เมนูอาหาร'
      : mode === 'pharmacy'
      ? 'ขายยา/สินค้า'
      : 'ขายสินค้า';

  return (
    // ChecksProvider ครอบทั้งแท็บ — บิลของโต๊ะถูกอ่านจากผังโต๊ะ หน้าบิล และจอสั่งอาหารของโต๊ะ
    // (ต่างจาก CartProvider ที่ผูกอยู่กับ stack ขายกลับบ้านอย่างเดียว)
    <SalesProvider>
      <CartProvider>
        <ChecksProvider>
      <Tab.Navigator
        key={mode}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        }}
      >
        <Tab.Screen
          name="SellTab"
          component={SellNavigator}
          options={{
            title: sellTitle,
            tabBarIcon: ({ color, size }) => (
              <SellIcon color={color} size={size} />
            ),
          }}
        />
        {mode === 'restaurant' && (
          <>
            <Tab.Screen
              name="FloorTab"
              component={FloorNavigator}
              options={{
                title: 'ผังโต๊ะ',
                tabBarIcon: ({ color, size }) => (
                  <FloorIcon color={color} size={size} />
                ),
              }}
            />
            <Tab.Screen
              name="KitchenTab"
              component={KitchenNavigator}
              options={{
                title: 'ครัว',
                tabBarIcon: ({ color, size }) => (
                  <KitchenIcon color={color} size={size} />
                ),
              }}
            />
          </>
        )}
        <Tab.Screen
          name="ShiftTab"
          component={ShiftNavigator}
          options={{
            title: 'กะ',
            tabBarIcon: ({ color, size }) => (
              <ShiftIcon color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
        </ChecksProvider>
      </CartProvider>
    </SalesProvider>
  );
}
