import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CartProvider } from '../state/CartContext';
import { CatalogProvider } from '../state/CatalogContext';
import { IncomingOrdersProvider } from '../state/IncomingOrdersContext';
import { KitchenProvider } from '../state/KitchenContext';
import { RestaurantOperationsProvider } from '../state/RestaurantOperationsContext';
import { BoardGameServiceProvider } from '../state/BoardGameServiceContext';
import { SalesProvider } from '../state/SalesContext';
import { sessionCashierName, useSession } from '../state/SessionContext';
import { ShiftProvider } from '../state/ShiftContext';
import { OrderAlertWatcher } from '../components/OrderAlertWatcher';
import { OfflineStatusBanner } from '../components/OfflineStatusBanner';
import { OfflineSalesProvider } from '../state/OfflineSalesContext';
import { View } from 'react-native';
import CheckoutScreen from '../screens/sell/CheckoutScreen';
import ReceiptScreen from '../screens/sell/ReceiptScreen';
import SaleDetailScreen from '../screens/sell/SaleDetailScreen';
import SalesHistoryScreen from '../screens/sell/SalesHistoryScreen';
import CheckDetailScreen from '../screens/floor/CheckDetailScreen';
import OperationsScreen from '../screens/operations/OperationsScreen';
import InventoryScreen from '../screens/inventory/InventoryScreen';
import ShiftScreen from '../screens/shift/ShiftScreen';
import {
  BoardGameDetailScreen,
  BoardGameOpenScreen,
} from '../screens/boardGame/BoardGameScreen';
import { MainTabs } from './MainTabs';
import { RootNavigationActionsProvider } from './RootNavigationActions';
import type { AppStackParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/**
 * ขอบเขตงานหลัง login: providers ต้องครอบทั้งแท็บและหน้าที่ push เหนือแท็บ
 * เพื่อให้ checkout/detail ใช้ cart, shift และ authoritative refetch ชุดเดียวกับหน้าหลัก
 */
type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function AppNavigator({ navigation: rootNavigation }: Props) {
  const { session } = useSession();

  return (
    <RootNavigationActionsProvider
      value={{
        openSettings: () => rootNavigation.navigate('Settings'),
        resetToLogin: () =>
          rootNavigation.reset({ index: 0, routes: [{ name: 'Login' }] }),
      }}
    >
      <SalesProvider>
        <ShiftProvider openedByName={sessionCashierName(session)}>
          <OfflineSalesProvider>
            <CatalogProvider>
              <CartProvider>
                <KitchenProvider>
                  <IncomingOrdersProvider>
                    <RestaurantOperationsProvider>
                      <BoardGameServiceProvider>
                        <OrderAlertWatcher />
                        <View style={{ flex: 1 }}>
                          <OfflineStatusBanner />
                          <Stack.Navigator
                            screenOptions={{ headerShown: false }}
                          >
                            <Stack.Screen name="Tabs" component={MainTabs} />
                            <Stack.Screen
                              name="Checkout"
                              component={CheckoutScreen}
                            />
                            <Stack.Screen
                              name="Receipt"
                              component={ReceiptScreen}
                            />
                            <Stack.Screen
                              name="SalesHistory"
                              component={SalesHistoryScreen}
                            />
                            <Stack.Screen
                              name="SaleDetail"
                              component={SaleDetailScreen}
                            />
                            <Stack.Screen
                              name="CheckDetail"
                              component={CheckDetailScreen}
                            />
                            <Stack.Screen name="RestaurantOps">
                              {({ navigation, route }) => (
                                <OperationsScreen
                                  section="RESTAURANT"
                                  locked
                                  initialRestaurantView={route.params?.initialView}
                                  onBack={() => navigation.goBack()}
                                />
                              )}
                            </Stack.Screen>
                            <Stack.Screen
                              name="InventoryDetail"
                              component={InventoryScreen}
                            />
                            <Stack.Screen name="ShiftDetail">
                              {({ navigation }) => (
                                <ShiftScreen onBack={() => navigation.goBack()} />
                              )}
                            </Stack.Screen>
                            <Stack.Screen
                              name="BoardGameOpen"
                              component={BoardGameOpenScreen}
                            />
                            <Stack.Screen
                              name="BoardGameDetail"
                              component={BoardGameDetailScreen}
                            />
                          </Stack.Navigator>
                        </View>
                      </BoardGameServiceProvider>
                    </RestaurantOperationsProvider>
                  </IncomingOrdersProvider>
                </KitchenProvider>
              </CartProvider>
            </CatalogProvider>
          </OfflineSalesProvider>
        </ShiftProvider>
      </SalesProvider>
    </RootNavigationActionsProvider>
  );
}
