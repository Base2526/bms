import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { MenuGrid } from '../../components/MenuGrid';
import {
  MobileRestaurantAddCheckItemDocument,
  MobileRestaurantCheckDocument,
  MobileRestaurantFloorDocument,
  MobileRestaurantOpenCheckDocument,
  MobileRestaurantRemoveCheckItemDocument,
  MobileRestaurantSendCheckDocument,
} from '../../graphql/generated';
import { useCatalog } from '../../state/CatalogContext';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { PosMenuItem } from '../../types/pos';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'CheckDetail'>;

export default function CheckDetailScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const { catalog } = useCatalog();
  const { session } = useSession();
  const [working, setWorking] = useState(false);
  const floor = useQuery(MobileRestaurantFloorDocument);
  const table = floor.data?.bmsPosRestaurantFloor.tables.find(
    item => item.id === route.params.tableId,
  );
  const checkId = table?.check?.id ?? null;
  const check = useQuery(MobileRestaurantCheckDocument, {
    variables: { id: checkId ?? '' },
    skip: !checkId,
    notifyOnNetworkStatusChange: true,
  });
  const [openCheck] = useMutation(MobileRestaurantOpenCheckDocument);
  const [addItem] = useMutation(MobileRestaurantAddCheckItemDocument);
  const [removeItem] = useMutation(MobileRestaurantRemoveCheckItemDocument);
  const [sendCheck] = useMutation(MobileRestaurantSendCheckDocument);
  const current = check.data?.bmsPosRestaurantCheck;

  const qtyBySku = useMemo(() => {
    const quantities: Record<string, number> = {};
    for (const line of current?.items ?? []) {
      quantities[line.sku] = (quantities[line.sku] ?? 0) + line.packQty;
    }
    return quantities;
  }, [current?.items]);

  const credentials = session?.credentials;
  const refresh = async (id?: string) => {
    await floor.refetch();
    if (id ?? checkId) {
      await check.refetch({ id: id ?? checkId ?? '' });
    }
  };

  const ensureCheck = async (): Promise<string> => {
    if (checkId) return checkId;
    if (!credentials) throw new Error('กรุณาเข้าใช้งานใหม่');
    const response = await openCheck({
      variables: {
        input: {
          tableId: route.params.tableId,
          cashierUserId: credentials.cashierUserId,
          pin: credentials.pin,
          guestCount: 1,
          note: null,
        },
      },
    });
    const opened = response.data?.bmsPosRestaurantOpenCheck.check;
    if (!opened) throw new Error('เปิดบิลโต๊ะไม่สำเร็จ');
    await refresh(opened.id);
    return opened.id;
  };

  const onAdd = async (item: PosMenuItem) => {
    if (!credentials || working) return;
    setWorking(true);
    try {
      const id = await ensureCheck();
      const response = await addItem({
        variables: {
          checkId: id,
          input: {
            cashierUserId: credentials.cashierUserId,
            pin: credentials.pin,
            sku: item.sku,
            size: item.size || null,
            packCode: item.packCode || null,
            packQty: 1,
            modifierCodes: null,
            kitchenNote: null,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantAddCheckItem;
      if (!result?.check) {
        throw new Error(result?.reason ?? result?.status ?? 'เพิ่มรายการไม่สำเร็จ');
      }
      await refresh(id);
    } catch (error) {
      Alert.alert(
        'เพิ่มรายการไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const onRemove = async (sku: string) => {
    if (!credentials || !current || working) return;
    const line = [...current.items]
      .reverse()
      .find(item => item.sku === sku && item.status === 'NEW');
    if (!line) {
      Alert.alert('ลบไม่ได้', 'รายการที่ส่งครัวแล้วต้องจัดการผ่านขั้นตอนยกเลิก');
      return;
    }
    setWorking(true);
    try {
      const response = await removeItem({
        variables: {
          checkId: current.id,
          itemId: line.id,
          credentials,
        },
      });
      const result = response.data?.bmsPosRestaurantRemoveCheckItem;
      if (!result?.check) {
        throw new Error(result?.reason ?? result?.status ?? 'ลบรายการไม่สำเร็จ');
      }
      await refresh(current.id);
    } catch (error) {
      Alert.alert(
        'ลบรายการไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const onSend = async () => {
    if (!credentials || !current || working) return;
    setWorking(true);
    try {
      const response = await sendCheck({
        variables: { checkId: current.id, credentials },
      });
      const result = response.data?.bmsPosRestaurantSendCheckToKitchen;
      if (result?.status !== 'SENT') {
        throw new Error(result?.reason ?? result?.status ?? 'ส่งครัวไม่สำเร็จ');
      }
      await refresh(current.id);
      Alert.alert('ส่งครัวแล้ว', `${result.kitchenTickets ?? 0} ตั๋ว`);
    } catch (error) {
      Alert.alert(
        'ส่งครัวไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const orderPanel = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.subtitle, { color: colors.text }]}>
        {table?.code ?? 'โต๊ะ'} · ฿{(current?.amountDue ?? 0).toFixed(2)}
      </Text>
      <FlatList
        data={current?.items ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ยังไม่มีรายการ
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text }]}>
                {item.productName} × {item.packQty}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {item.kitchenStatus ?? item.status}
              </Text>
            </View>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ฿{(item.lineAmount ?? (item.packPrice ?? 0) * item.packQty).toFixed(2)}
            </Text>
          </View>
        )}
      />
      <Button
        label={working ? 'กำลังทำรายการ…' : 'ส่งรายการใหม่เข้าครัว'}
        fullWidth
        disabled={
          working || !current?.items.some(item => item.status === 'NEW')
        }
        onPress={onSend}
      />
      <Button
        label="ไปชำระเงิน"
        variant="secondary"
        fullWidth
        disabled={
          !current ||
          current.items.length === 0 ||
          current.items.some(item => item.status === 'NEW')
        }
        onPress={() =>
          navigation
            .getParent()
            ?.getParent<any>()
            ?.navigate('SellTab', {
              screen: 'Checkout',
              params: { source: 'restaurant', tableId: route.params.tableId },
            })
        }
      />
    </Card>
  );

  return (
    <ScreenContainer padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <ScreenHeader
          title={table ? `บิลโต๊ะ ${table.code}` : 'บิลโต๊ะ'}
          subtitle={current ? `${current.items.length} รายการ` : 'พร้อมเปิดบิลใหม่'}
          onBack={() => navigation.goBack()}
        />
      </View>
      {isTablet ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <MenuGrid
            qtyBySku={qtyBySku}
            onAdd={item => {
              onAdd(item).catch(() => undefined);
            }}
            onDecrement={sku => {
              onRemove(sku).catch(() => undefined);
            }}
            areaWidth={width - 360}
            artHeight={92}
            catalog={catalog}
          />
          <View style={{ width: 360, padding: spacing.lg }}>{orderPanel}</View>
        </View>
      ) : (
        <View style={{ flex: 1, padding: spacing.lg }}>{orderPanel}</View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
