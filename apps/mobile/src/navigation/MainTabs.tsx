import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import { useIncomingOrders } from '../state/IncomingOrdersContext';
import { useRestaurantOperations } from '../state/RestaurantOperationsContext';
import { useStoreMode } from '../state/StoreModeContext';
import { useResponsive } from '../theme/useResponsive';
import {
  FloorIcon,
  InventoryIcon,
  KitchenIcon,
  MoreIcon,
  OrdersIcon,
  SellIcon,
  ShiftIcon,
} from '../components/icons/TabIcons';

import MenuScreen from '../screens/sell/MenuScreen';
import FloorScreen from '../screens/floor/FloorScreen';
import IncomingOrdersScreen from '../screens/orders/IncomingOrdersScreen';
import KitchenBoardScreen from '../screens/kitchen/KitchenBoardScreen';
import ShiftScreen from '../screens/shift/ShiftScreen';
import OperationsScreen from '../screens/operations/OperationsScreen';
import BoardGameScreen from '../screens/boardGame/BoardGameScreen';
import InventoryScreen from '../screens/inventory/InventoryScreen';

import type {
  MainTabParamList,
  OrdersStackParamList,
  SellStackParamList,
  FloorStackParamList,
  KitchenStackParamList,
  InventoryStackParamList,
  OperationsStackParamList,
  ShiftStackParamList,
  BoardGameStackParamList,
} from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const SellStack = createNativeStackNavigator<SellStackParamList>();
const FloorStack = createNativeStackNavigator<FloorStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const KitchenStack = createNativeStackNavigator<KitchenStackParamList>();
const ShiftStack = createNativeStackNavigator<ShiftStackParamList>();
const InventoryStack = createNativeStackNavigator<InventoryStackParamList>();
const OperationsStack = createNativeStackNavigator<OperationsStackParamList>();
const BoardGameStack = createNativeStackNavigator<BoardGameStackParamList>();

function SellNavigator() {
  return (
    <SellStack.Navigator screenOptions={{ headerShown: false }}>
      <SellStack.Screen name="Menu" component={MenuScreen} />
    </SellStack.Navigator>
  );
}

function FloorNavigator() {
  return (
    <FloorStack.Navigator screenOptions={{ headerShown: false }}>
      <FloorStack.Screen name="Floor" component={FloorScreen} />
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

// ปลายทางตรงบนแท็บเล็ต — จอเดียวกับที่มือถือเข้าผ่าน "เพิ่มเติม" แค่ไม่ต้องผ่านชั้นกลาง
function InventoryTabNavigator() {
  return (
    <InventoryStack.Navigator screenOptions={{ headerShown: false }}>
      <InventoryStack.Screen name="Inventory">
        {() => <InventoryScreen asTabRoot />}
      </InventoryStack.Screen>
    </InventoryStack.Navigator>
  );
}

function OperationsNavigator() {
  return (
    <OperationsStack.Navigator screenOptions={{ headerShown: false }}>
      <OperationsStack.Screen name="Operations" component={OperationsScreen} />
    </OperationsStack.Navigator>
  );
}

function BoardGameNavigator() {
  return (
    <BoardGameStack.Navigator screenOptions={{ headerShown: false }}>
      <BoardGameStack.Screen name="BoardGame" component={BoardGameScreen} />
    </BoardGameStack.Navigator>
  );
}

// แถบล่าง 5 แท็บ: ผังโต๊ะ · เมนู · งานเข้า · ครัว · เพิ่มเติม
//
// ⚠️ จำนวนแท็บเป็นข้อจำกัดของจอ ไม่ใช่รสนิยม — 402pt หาร 6 เหลือ 67pt ต่อแท็บ ซึ่งสั้นกว่า
// ป้ายไทยอย่าง "ออร์เดอร์เข้า" · 5 แท็บได้ 80pt ซึ่งพอดี
//
// สิ่งที่อยู่บนแถบตัดสินจาก "แตะบ่อยแค่ไหนระหว่างเปิดร้าน" ไม่ใช่จากความสำคัญของฟีเจอร์:
// กะสำคัญมากแต่ใช้วันละ 2 ครั้ง จึงไปอยู่ใต้ "เพิ่มเติม" ส่วนผังโต๊ะเปิดทั้งวันจึงมาก่อน
//
// "งานเข้า" รวมทุกอย่างที่มีคนรออยู่ปลายทาง (ออร์เดอร์จากแชท · คิว · QR ที่โต๊ะ · เรียกพนักงาน)
// ไว้ใน badge เดียว — ก่อนหน้านี้เป็นสองแท็บที่ **ใช้ไอคอนเดียวกัน** และมี badge ทั้งคู่
// จึงแยกด้วยตาไม่ออกว่าอันไหนคืออะไร
export function MainTabs() {
  return <TabsShell />;
}

function TabsShell() {
  const { colors } = useTheme();
  const { isTablet } = useResponsive();
  const { mode } = useStoreMode();
  const { pendingCount } = useIncomingOrders();
  const { totalPendingCount: restaurantPendingCount } =
    useRestaurantOperations();
  const sellTitle =
    mode === 'restaurant' ? 'เมนู' : mode === 'pharmacy' ? 'ขายยา' : 'ขาย';
  // badge เดียวต้องเป็นผลรวมจริงของทุกถังที่กดเข้าไปถึงได้จากแท็บนี้ —
  // นับไม่ครบคือบอกว่าไม่มีงานทั้งที่มี · นับเกินคือส่งคนไปหาของที่ไม่มีอยู่
  const inboxCount = pendingCount + restaurantPendingCount;

  return (
    <Tab.Navigator
      key={mode}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarPosition: 'bottom',
        tabBarVariant: 'uikit',
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          // ผัง Board Game, สต็อก, งาน และกะบน iPad มี sidebar ที่พาไปทุกส่วนหลักอยู่แล้ว
          // จึงใช้พื้นที่เต็มสูงเหมือน mockup; เมื่อออกไปแท็บอื่น bottom bar จะกลับมาเอง
          display:
            isTablet &&
            (['BoardGameTab', 'InventoryTab', 'ShiftTab'].includes(
              route.name,
            ) ||
              (route.name === 'OperationsTab' && mode !== 'restaurant'))
              ? 'none'
              : 'flex',
        },
      })}
    >
      {mode === 'restaurant' && (
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
      )}
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
        <Tab.Screen
          name="OrdersTab"
          component={OrdersNavigator}
          options={{
            title: 'งานเข้า',
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
            tabBarIcon: ({ color, size }) => (
              <OrdersIcon color={color} size={size} />
            ),
          }}
        />
      )}
      {mode === 'restaurant' && (
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
      )}
      {mode === 'board_game_cafe' && (
        <Tab.Screen
          name="BoardGameTab"
          component={BoardGameNavigator}
          options={{
            title: 'โต๊ะ/เวลา',
            tabBarIcon: ({ color, size }) => (
              <FloorIcon color={color} size={size} />
            ),
          }}
        />
      )}
      {/* Board Game ใช้ 5 ช่องตาม mockup ทั้ง iPhone/iPad; ร้านค้าทั่วไปยังคงแยกสต็อกเป็น
          ทางตรงเฉพาะแท็บเล็ตเพื่อไม่ให้แถบมือถือแน่นเกินไป */}
      {(mode === 'board_game_cafe' || (isTablet && mode !== 'restaurant')) && (
        <Tab.Screen
          name="InventoryTab"
          component={InventoryTabNavigator}
          options={{
            title: 'สต็อก',
            tabBarIcon: ({ color, size }) => (
              <InventoryIcon color={color} size={size} />
            ),
          }}
        />
      )}
      <Tab.Screen
        name="OperationsTab"
        component={OperationsNavigator}
        options={{
          title: mode === 'restaurant' ? 'เพิ่มเติม' : 'งาน',
          tabBarIcon: ({ color, size }) => (
            <MoreIcon color={color} size={size} />
          ),
        }}
      />
      {/* ร้านอาหารใช้ครบ 5 ช่องกับงานหน้าร้านที่แตะทั้งวันแล้ว กะจึงอยู่ใต้ "เพิ่มเติม"
          ส่วนโหมดอื่นยังมีที่และคงทางเข้ากะโดยตรงไว้ */}
      {mode !== 'restaurant' && (
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
      )}
    </Tab.Navigator>
  );
}
