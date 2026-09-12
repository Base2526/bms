import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import { CartProvider } from '../state/CartContext';
import { CatalogProvider } from '../state/CatalogContext';
import {
  IncomingOrdersProvider,
  useIncomingOrders,
} from '../state/IncomingOrdersContext';
import { KitchenProvider } from '../state/KitchenContext';
import { SalesProvider } from '../state/SalesContext';
import { sessionCashierName, useSession } from '../state/SessionContext';
import { ShiftProvider } from '../state/ShiftContext';
import { useStoreMode } from '../state/StoreModeContext';
import { OrderAlertWatcher } from '../components/OrderAlertWatcher';
import {
  FloorIcon,
  KitchenIcon,
  OrdersIcon,
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
import IncomingOrdersScreen from '../screens/orders/IncomingOrdersScreen';
import KitchenBoardScreen from '../screens/kitchen/KitchenBoardScreen';
import ShiftScreen from '../screens/shift/ShiftScreen';

import type {
  MainTabParamList,
  OrdersStackParamList,
  SellStackParamList,
  FloorStackParamList,
  KitchenStackParamList,
  ShiftStackParamList,
} from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const SellStack = createNativeStackNavigator<SellStackParamList>();
const FloorStack = createNativeStackNavigator<FloorStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
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

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator screenOptions={{ headerShown: false }}>
      <OrdersStack.Screen
        name="IncomingOrders"
        component={IncomingOrdersScreen}
      />
    </OrdersStack.Navigator>
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

// แท็บล่าง: ขาย · ออร์เดอร์เข้า · (ร้านอาหารได้ ผังโต๊ะ + ครัว เพิ่ม) · กะ/ลิ้นชัก
//
// "ออร์เดอร์เข้า" มีให้ทุกโหมดโดยตั้งใจ — การสั่งออนไลน์/แชทไม่ใช่เรื่องของร้านอาหารอย่างเดียว
// ส่วนผังโต๊ะ/ครัวขึ้นเฉพาะร้านอาหาร · ตอนต่อ backend จริงค่อยซ่อนตามประเภทร้านจาก server
export function MainTabs() {
  const { session } = useSession();

  // ⚠️ ลำดับของ provider มีความหมาย: ShiftProvider อ่านบิลจาก SalesProvider เพื่อคิดเงินสด
  // ในลิ้นชัก จึงต้องอยู่ข้างใน · KitchenProvider/IncomingOrdersProvider อยู่นอก Tab.Navigator
  // เพราะตั๋วครัวและออร์เดอร์เข้าต้องข้ามแท็บได้ (รับที่แท็บออร์เดอร์ แล้วไปเห็นที่แท็บครัว)
  return (
    <SalesProvider>
      <ShiftProvider openedByName={sessionCashierName(session)}>
        <CatalogProvider>
          <CartProvider>
            <KitchenProvider>
              <IncomingOrdersProvider>
                {/* เฝ้าดูของใหม่ทั้งแอป — ไม่ผูกกับแท็บที่เปิดอยู่ (ดูคอมเมนต์ในไฟล์) */}
                <OrderAlertWatcher />
                <TabsShell />
              </IncomingOrdersProvider>
            </KitchenProvider>
          </CartProvider>
        </CatalogProvider>
      </ShiftProvider>
    </SalesProvider>
  );
}

function TabsShell() {
  const { colors } = useTheme();
  const { mode } = useStoreMode();
  const { pendingCount } = useIncomingOrders();
  const sellTitle =
    mode === 'restaurant'
      ? 'เมนูอาหาร'
      : mode === 'pharmacy'
      ? 'ขายยา/สินค้า'
      : 'ขายสินค้า';

  return (
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
            name="OrdersTab"
            component={OrdersNavigator}
            options={{
              title: 'ออร์เดอร์เข้า',
              tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
              tabBarIcon: ({ color, size }) => (
                <OrdersIcon color={color} size={size} />
              ),
            }}
          />
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
  );
}
