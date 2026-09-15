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
import {
  RestaurantOperationsProvider,
  useRestaurantOperations,
} from '../state/RestaurantOperationsContext';
import { sessionCashierName, useSession } from '../state/SessionContext';
import { ShiftProvider } from '../state/ShiftContext';
import { useStoreMode } from '../state/StoreModeContext';
import { useResponsive } from '../theme/useResponsive';
import { OrderAlertWatcher } from '../components/OrderAlertWatcher';
import {
  CounterIcon,
  FloorIcon,
  InventoryIcon,
  KitchenIcon,
  MoreIcon,
  OrdersIcon,
  SellIcon,
  ShiftIcon,
  SupportIcon,
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
import OperationsScreen from '../screens/operations/OperationsScreen';
import BoardGameScreen from '../screens/boardGame/BoardGameScreen';
import InventoryScreen from '../screens/inventory/InventoryScreen';

import type {
  MainTabParamList,
  OrdersStackParamList,
  SellStackParamList,
  FloorStackParamList,
  KitchenStackParamList,
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
const OperationsStack = createNativeStackNavigator<OperationsStackParamList>();
const BoardGameStack = createNativeStackNavigator<BoardGameStackParamList>();

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
      {/* คิว/QR/เรียก/คำขอ — จอเดียวกับ "เพิ่มเติม" แต่ล็อกไว้ที่ส่วนร้านอาหาร
          เพื่อไม่ให้แท็บนี้พาไปเจองานหลังร้านที่ไม่มีใครรออยู่ */}
      <OrdersStack.Screen name="RestaurantOps">
        {() => <OperationsScreen section="RESTAURANT" locked />}
      </OrdersStack.Screen>
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

// ปลายทางของรางบนแท็บเล็ต — จอเดียวกับที่มือถือเข้าผ่าน "เพิ่มเติม" แค่ไม่ต้องผ่านชั้นกลาง
function InventoryTabNavigator() {
  return (
    <OperationsStack.Navigator screenOptions={{ headerShown: false }}>
      <OperationsStack.Screen name="Inventory">
        {(props) => <InventoryScreen {...props} asTabRoot />}
      </OperationsStack.Screen>
    </OperationsStack.Navigator>
  );
}

function CounterNavigator() {
  return (
    <OperationsStack.Navigator screenOptions={{ headerShown: false }}>
      <OperationsStack.Screen name="Operations">
        {() => <OperationsScreen section="REGISTER" locked />}
      </OperationsStack.Screen>
    </OperationsStack.Navigator>
  );
}

function SupportNavigator() {
  return (
    <OperationsStack.Navigator screenOptions={{ headerShown: false }}>
      <OperationsStack.Screen name="Operations">
        {() => <OperationsScreen section="SUPPORT" locked />}
      </OperationsStack.Screen>
    </OperationsStack.Navigator>
  );
}

function OperationsNavigator() {
  return (
    <OperationsStack.Navigator screenOptions={{ headerShown: false }}>
      <OperationsStack.Screen name="Operations" component={OperationsScreen} />
      <OperationsStack.Screen name="Inventory" component={InventoryScreen} />
      <OperationsStack.Screen name="Shift" component={ShiftScreen} />
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
                <RestaurantOperationsProvider>
                  {/* เฝ้าดูของใหม่ทั้งแอป — ไม่ผูกกับแท็บที่เปิดอยู่ (ดูคอมเมนต์ในไฟล์) */}
                  <OrderAlertWatcher />
                  <TabsShell />
                </RestaurantOperationsProvider>
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
  const { isTablet } = useResponsive();
  const { mode } = useStoreMode();
  const { pendingCount } = useIncomingOrders();
  const { totalPendingCount: restaurantPendingCount } =
    useRestaurantOperations();
  const sellTitle =
    mode === 'restaurant'
      ? 'เมนู'
      : mode === 'pharmacy'
      ? 'ขายยา'
      : 'ขาย';
  // badge เดียวต้องเป็นผลรวมจริงของทุกถังที่กดเข้าไปถึงได้จากแท็บนี้ —
  // นับไม่ครบคือบอกว่าไม่มีงานทั้งที่มี · นับเกินคือส่งคนไปหาของที่ไม่มีอยู่
  const inboxCount = pendingCount + restaurantPendingCount;

  return (
    <Tab.Navigator
      key={mode}
      screenOptions={{
        headerShown: false,
        // ⚠️ แถบล่างเต็มความกว้างบนไอแพด 13" ยืดแท็บละ ~340pt จนไอคอนลอยอยู่กลางช่องว่าง
        // — อ่านออกมาเป็น "แอปมือถือที่ถูกยืดใส่จอใหญ่" ซึ่งเป็นคำที่ `useResponsive.ts`
        // จดไว้เองว่าโดนทักมาแล้วสองรอบ · เครื่องขายบนแท็บเล็ตวางแนวตั้งตลอดเวลา แถบซ้ายจึง
        // อยู่ในระยะนิ้วโป้งและคืนความสูงให้เนื้อหาไปด้วย
        tabBarPosition: isTablet ? 'left' : 'bottom',
        // ราง (material) ไม่ยืดเป็นช่องเท่า ๆ กันแบบ uikit — จำเป็นเมื่อวางแนวตั้ง
        tabBarVariant: isTablet ? 'material' : 'uikit',
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          ...(isTablet
            ? { borderRightColor: colors.border, borderRightWidth: 1 }
            : { borderTopColor: colors.border }),
        },
      }}
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
      {/* ⚠️ "เพิ่มเติม" มีอยู่เพราะแถบล่างมี 5 ช่อง — รางแนวตั้งไม่มีข้อจำกัดนั้น
          บนแท็บเล็ตจึงกางของที่ถูกยุบออกมาเป็นปลายทางของตัวเองแทนที่จะซ่อนต่อ */}
      {!isTablet && (
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
      )}
      {isTablet && (
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
      {isTablet && (
        <Tab.Screen
          name="CounterTab"
          component={CounterNavigator}
          options={{
            title: 'เคาน์เตอร์',
            tabBarIcon: ({ color, size }) => (
              <CounterIcon color={color} size={size} />
            ),
          }}
        />
      )}
      {/* ⚠️ กะยุบเข้า "เพิ่มเติม" เฉพาะโหมดร้านอาหาร ซึ่งเป็นโหมดเดียวที่แถบแน่นจนป้ายถูกตัด
          · โหมดอื่นมีแค่ 3 แท็บอยู่แล้ว การยุบไม่ได้แก้ปัญหาอะไร มีแต่ทำให้เหลือ 2 แท็บ
          ลอยอยู่บนแถบกว้าง ๆ ของไอแพด */}
      {(isTablet || mode !== 'restaurant') && (
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
      {isTablet && (
        <Tab.Screen
          name="SupportTab"
          component={SupportNavigator}
          options={{
            title: 'สถานะ',
            tabBarIcon: ({ color, size }) => (
              <SupportIcon color={color} size={size} />
            ),
          }}
        />
      )}
    </Tab.Navigator>
  );
}