import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import {
  MobileRestaurantFloorDocument,
  MobileRestaurantOpenCheckDocument,
  type MobileRestaurantFloorQuery,
} from '../../graphql/generated';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';
import {
  columnsForWidth,
  padGrid,
  useResponsive,
} from '../../theme/useResponsive';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'Floor'>;
type FloorTable =
  MobileRestaurantFloorQuery['bmsPosRestaurantFloor']['tables'][number];

const TABLE_BASE = 96;
const TABLE_LARGE = 112;
const CANVAS_PADDING = 28;
const GRID_STEP = 40;

function hasClosingCheck(table: FloorTable) {
  return table.checks.some(check => check.status === 'CLOSING');
}

function tableTone(table: FloorTable) {
  if (table.status === 'AVAILABLE') return 'success' as const;
  if (hasClosingCheck(table)) return 'warning' as const;
  return 'neutral' as const;
}

function tableStatusLabel(table: FloorTable): string {
  if (table.blocked) return 'ปิดใช้';
  if (table.status === 'AVAILABLE') return 'ว่าง';
  if (hasClosingCheck(table)) return 'กำลังคิดเงิน';
  return 'มีลูกค้า';
}

function tableSize(table: FloorTable) {
  return table.seats >= 4 ? TABLE_LARGE : TABLE_BASE;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function FloorScreen({ navigation }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const { width, isTablet } = useResponsive();
  const { session } = useSession();
  const [areaId, setAreaId] = useState<string | null>(null);
  const [floorAreaHeight, setFloorAreaHeight] = useState(0);
  const [openingTakeaway, setOpeningTakeaway] = useState(false);
  const [billPickerTable, setBillPickerTable] = useState<FloorTable | null>(
    null,
  );
  const query = useQuery(MobileRestaurantFloorDocument, {
    notifyOnNetworkStatusChange: true,
  });
  const [openCheck] = useMutation(MobileRestaurantOpenCheckDocument);
  const areas = useMemo(
    () => query.data?.bmsPosRestaurantFloor.areas ?? [],
    [query.data?.bmsPosRestaurantFloor.areas],
  );
  const tables = useMemo(
    () => query.data?.bmsPosRestaurantFloor.tables ?? [],
    [query.data?.bmsPosRestaurantFloor.tables],
  );
  const takeawayChecks = useMemo(
    () => query.data?.bmsPosRestaurantFloor.takeawayChecks ?? [],
    [query.data?.bmsPosRestaurantFloor.takeawayChecks],
  );

  useEffect(() => {
    if (!areas.length) return;
    setAreaId(current =>
      current && areas.some(area => area.id === current)
        ? current
        : areas[0].id,
    );
  }, [areas]);

  const visibleTables = useMemo(
    () => (areaId ? tables.filter(table => table.areaId === areaId) : tables),
    [areaId, tables],
  );

  const hasFloorPositions = visibleTables.some(
    table => table.positionX > 0 || table.positionY > 0,
  );
  const useFloorPlan = isTablet && hasFloorPositions;
  const columns = columnsForWidth(width);
  const data = useMemo(
    () => padGrid(visibleTables, columns),
    [columns, visibleTables],
  );

  const contentBounds = useMemo(() => {
    if (!visibleTables.length) {
      return { minX: 0, minY: 0, width: 0, height: 0 };
    }
    const minX = visibleTables.reduce(
      (min, table) => Math.min(min, table.positionX),
      Number.POSITIVE_INFINITY,
    );
    const minY = visibleTables.reduce(
      (min, table) => Math.min(min, table.positionY),
      Number.POSITIVE_INFINITY,
    );
    const maxX = visibleTables.reduce(
      (max, table) => Math.max(max, table.positionX + tableSize(table)),
      0,
    );
    const maxY = visibleTables.reduce(
      (max, table) => Math.max(max, table.positionY + tableSize(table)),
      0,
    );
    return {
      minX: Number.isFinite(minX) ? minX : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      width: Math.max(0, maxX - (Number.isFinite(minX) ? minX : 0)),
      height: Math.max(0, maxY - (Number.isFinite(minY) ? minY : 0)),
    };
  }, [visibleTables]);

  const viewportWidth = Math.max(320, width - spacing.lg * 2);
  const viewportHeight = Math.max(320, floorAreaHeight);

  const scale = useMemo(() => {
    if (!useFloorPlan) return 1;
    const naturalWidth = contentBounds.width + CANVAS_PADDING * 2;
    const naturalHeight = contentBounds.height + CANVAS_PADDING * 2;
    const widthScale = naturalWidth > 0 ? viewportWidth / naturalWidth : 1;
    const heightScale = naturalHeight > 0 ? viewportHeight / naturalHeight : 1;
    return clamp(Math.min(widthScale, heightScale, 1.08), 0.72, 1.08);
  }, [
    contentBounds.height,
    contentBounds.width,
    useFloorPlan,
    viewportHeight,
    viewportWidth,
  ]);

  const canvas = {
    width: Math.max(
      Math.round((contentBounds.width + CANVAS_PADDING * 2) * scale),
      viewportWidth,
    ),
    height: Math.max(
      Math.round((contentBounds.height + CANVAS_PADDING * 2) * scale),
      viewportHeight,
    ),
  };
  const contentOffset = {
    x: Math.max(
      CANVAS_PADDING * scale,
      (canvas.width - contentBounds.width * scale) / 2,
    ),
    y: Math.max(
      CANVAS_PADDING * scale,
      Math.min(
        CANVAS_PADDING * 2,
        (canvas.height - contentBounds.height * scale) * 0.18,
      ),
    ),
  };
  const dots = useMemo(() => {
    const cols = Math.floor(canvas.width / scale / GRID_STEP);
    const rows = Math.floor(canvas.height / scale / GRID_STEP);
    return Array.from({ length: cols * rows }, (_, index) => ({
      key: `dot-${index}`,
      x: (index % cols) * GRID_STEP + 8,
      y: Math.floor(index / cols) * GRID_STEP + 8,
    }));
  }, [canvas.height, canvas.width, scale]);

  const openTakeawayCheck = async () => {
    if (openingTakeaway) return;
    const credentials = session?.credentials;
    if (!credentials) {
      Alert.alert('เปิดบิลไม่ได้', 'กรุณาเข้าใช้งานใหม่');
      return;
    }
    setOpeningTakeaway(true);
    try {
      const response = await openCheck({
        variables: {
          input: {
            serviceMode: 'TAKEAWAY',
            tableId: null,
            cashierUserId: credentials.cashierUserId,
            pin: credentials.pin,
            guestCount: 1,
            note: null,
          },
        },
      });
      const opened = response.data?.bmsPosRestaurantOpenCheck.check;
      if (!opened) throw new Error('เปิดบิลกลับบ้านไม่สำเร็จ');
      await query.refetch();
      navigation.navigate('CheckDetail', {
        checkId: opened.id,
        serviceMode: 'TAKEAWAY',
      });
    } catch (error) {
      Alert.alert(
        'เปิดบิลกลับบ้านไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setOpeningTakeaway(false);
    }
  };

  const openTable = (table: FloorTable) => {
    if (table.checks.length > 1) {
      setBillPickerTable(table);
      return;
    }
    navigation.navigate('CheckDetail', {
      tableId: table.id,
      checkId: table.checks[0]?.id,
      serviceMode: 'DINE_IN',
    });
  };

  const renderGridCard = (item: FloorTable) => (
    <Pressable
      style={{ flex: 1 }}
      disabled={!item.active || item.blocked}
      onPress={() => openTable(item)}
    >
      <Card
        style={{
          minHeight: 150,
          opacity: !item.active || item.blocked ? 0.55 : 1,
        }}
      >
        <View style={styles.header}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            {item.code}
          </Text>
          <StatusPill
            label={tableStatusLabel(item)}
            tone={item.blocked ? 'danger' : tableTone(item)}
          />
        </View>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {item.name} · {item.seats} ที่นั่ง
        </Text>
        {item.check ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              {item.check.itemCount} รายการ · ฿{item.check.amountDue.toFixed(2)}
            </Text>
            {item.check.unsentCount > 0 ? (
              <Text
                style={[typography.captionStrong, { color: colors.warning }]}
              >
                ยังไม่ส่งครัว {item.check.unsentCount} รายการ
              </Text>
            ) : null}
          </View>
        ) : null}
        {item.checks.length > 1 ? (
          <Text style={[typography.captionStrong, { color: colors.primary }]}>
            {item.checks.length} บิล แยกชำระ
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );

  const renderFloorTable = (table: FloorTable) => {
    const size = tableSize(table) * scale;
    const occupied = table.status !== 'AVAILABLE';
    const disabled = !table.active || table.blocked;
    const borderColor = table.blocked
      ? colors.danger
      : occupied
      ? colors.warning
      : colors.success;
    const backgroundColor = table.blocked
      ? colors.dangerBg
      : occupied
      ? colors.warningBg
      : colors.successBg;
    const left =
      (table.positionX - contentBounds.minX) * scale + contentOffset.x;
    const top =
      (table.positionY - contentBounds.minY) * scale + contentOffset.y;
    const compact = size < 104;
    const chairLong = Math.max(22, size * 0.26);
    const chairShort = Math.max(8, size * 0.085);
    const chairColor = borderColor;

    return (
      <Pressable
        key={table.id}
        accessibilityRole="button"
        accessibilityLabel={`${table.code} ${tableStatusLabel(table)}`}
        disabled={disabled}
        onPress={() => openTable(table)}
        style={({ pressed }) => [
          styles.floorTableWrap,
          {
            left,
            top,
            width: size,
            height: size,
            opacity: disabled ? 0.48 : pressed ? 0.82 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.chairTop,
            {
              width: chairLong,
              height: chairShort,
              borderColor: chairColor,
              borderRadius: radius.sm,
              top: -chairShort - 5,
              left: (size - chairLong) / 2,
            },
          ]}
        />
        <View
          style={[
            styles.chairBottom,
            {
              width: chairLong,
              height: chairShort,
              borderColor: chairColor,
              borderRadius: radius.sm,
              bottom: -chairShort - 5,
              left: (size - chairLong) / 2,
            },
          ]}
        />
        {table.seats >= 4 ? (
          <>
            <View
              style={[
                styles.chairLeft,
                {
                  width: chairShort,
                  height: chairLong,
                  borderColor: chairColor,
                  borderRadius: radius.sm,
                  left: -chairShort - 5,
                  top: (size - chairLong) / 2,
                },
              ]}
            />
            <View
              style={[
                styles.chairRight,
                {
                  width: chairShort,
                  height: chairLong,
                  borderColor: chairColor,
                  borderRadius: radius.sm,
                  right: -chairShort - 5,
                  top: (size - chairLong) / 2,
                },
              ]}
            />
          </>
        ) : null}
        <View
          style={[
            styles.floorTable,
            {
              width: size,
              height: size,
              borderColor,
              borderRadius: table.shape === 'rect' ? radius.lg : size / 2,
              backgroundColor,
              borderWidth: Math.max(2, 4 * scale),
            },
          ]}
        >
          <Text
            style={[
              typography.title,
              { color: colors.text, fontSize: Math.max(17, 24 * scale) },
            ]}
            numberOfLines={1}
          >
            {table.code}
          </Text>
          <Text
            style={[
              typography.bodyStrong,
              { color: colors.text, fontSize: Math.max(12, 16 * scale) },
            ]}
            numberOfLines={1}
          >
            {table.name}
          </Text>
          {!compact ? (
            <Text
              style={[
                typography.caption,
                {
                  color: colors.textMuted,
                  fontSize: Math.max(11, 13 * scale),
                },
              ]}
              numberOfLines={1}
            >
              {table.seats} · {tableStatusLabel(table)}
            </Text>
          ) : null}
          {table.check && !compact ? (
            <Text
              style={[
                typography.captionStrong,
                {
                  color: table.check.unsentCount ? colors.warning : colors.text,
                  fontSize: Math.max(10, 12 * scale),
                },
              ]}
              numberOfLines={1}
            >
              {table.check.itemCount} รายการ
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <ScreenContainer padded={false}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <View style={styles.header}>
          <View>
            <Text style={[typography.title, { color: colors.text }]}>
              ผังโต๊ะ
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {query.loading
                ? 'กำลังโหลด…'
                : `${visibleTables.length} โต๊ะในสาขานี้`}
            </Text>
          </View>
          {query.error ? (
            <Pressable onPress={() => query.refetch()}>
              <Text style={[typography.caption, { color: colors.danger }]}>
                {query.error.message} · แตะเพื่อลองใหม่
              </Text>
            </Pressable>
          ) : null}
          <Button
            label="เปิดบิลกลับบ้าน"
            loading={openingTakeaway}
            disabled={!session || openingTakeaway}
            onPress={() => {
              openTakeawayCheck().catch(() => undefined);
            }}
          />
        </View>
        {takeawayChecks.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: spacing.sm,
              paddingTop: spacing.md,
              paddingBottom: spacing.xs,
            }}
          >
            {takeawayChecks.map(check => (
              <Pressable
                key={check.id}
                accessibilityRole="button"
                accessibilityLabel={`บิลกลับบ้าน ${check.id.slice(0, 8)}`}
                onPress={() =>
                  navigation.navigate('CheckDetail', {
                    checkId: check.id,
                    serviceMode: 'TAKEAWAY',
                  })
                }
                style={{
                  minWidth: 168,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  gap: spacing.xs,
                }}
              >
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  กลับบ้าน #{check.id.slice(0, 8)}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {check.itemCount} รายการ · ฿{check.amountDue.toFixed(2)}
                </Text>
                {check.unsentCount > 0 ? (
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.warning },
                    ]}
                  >
                    ยังไม่ส่งครัว {check.unsentCount} รายการ
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {areas.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: spacing.sm,
              paddingTop: spacing.md,
              paddingBottom: spacing.xs,
            }}
          >
            {areas.map(area => {
              const selected = area.id === areaId;
              return (
                <Pressable
                  key={area.id}
                  onPress={() => setAreaId(area.id)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.pill,
                    backgroundColor: selected ? colors.primary : colors.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: selected ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={[
                      typography.bodyStrong,
                      {
                        color: selected ? colors.primaryText : colors.text,
                      },
                    ]}
                  >
                    {area.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {useFloorPlan ? (
          <View
            style={{ flex: 1, marginTop: spacing.md }}
            onLayout={event =>
              setFloorAreaHeight(Math.round(event.nativeEvent.layout.height))
            }
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View
                style={[
                  styles.floorCanvas,
                  {
                    width: canvas.width,
                    height: canvas.height,
                    borderRadius: radius.lg,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                {dots.map(dot => (
                  <View
                    key={dot.key}
                    style={[
                      styles.gridDot,
                      {
                        left: dot.x * scale,
                        top: dot.y * scale,
                        backgroundColor: colors.surface3,
                      },
                    ]}
                  />
                ))}
                {visibleTables.map(renderFloorTable)}
              </View>
            </ScrollView>
          </View>
        ) : (
          <FlatList
            key={`floor-${columns}`}
            data={data}
            numColumns={columns}
            keyExtractor={(table, index) => table?.id ?? `filler-${index}`}
            contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.md }}
            columnWrapperStyle={{ gap: spacing.md }}
            renderItem={({ item }) =>
              item ? renderGridCard(item) : <View style={{ flex: 1 }} />
            }
          />
        )}
      </View>
      <Modal
        transparent
        visible={billPickerTable !== null}
        animationType="fade"
        onRequestClose={() => setBillPickerTable(null)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setBillPickerTable(null)}
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                padding: spacing.lg,
                borderRadius: radius.lg,
              },
            ]}
          >
            <Text style={[typography.title, { color: colors.text }]}>
              เลือกบิล {billPickerTable?.code}
            </Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
              {(billPickerTable?.checks ?? []).map(check => (
                <Button
                  key={check.id}
                  fullWidth
                  variant="secondary"
                  label={`บิล ${check.splitGroupNo} · ${
                    check.itemCount
                  } รายการ · ฿${check.amountDue.toFixed(2)}`}
                  onPress={() => {
                    const tableId = billPickerTable?.id;
                    setBillPickerTable(null);
                    if (!tableId) return;
                    navigation.navigate('CheckDetail', {
                      tableId,
                      checkId: check.id,
                      serviceMode: 'DINE_IN',
                    });
                  }}
                />
              ))}
            </ScrollView>
            <Button
              label="ปิด"
              variant="secondary"
              fullWidth
              onPress={() => setBillPickerTable(null)}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  floorCanvas: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
    position: 'relative',
  },
  gridDot: {
    position: 'absolute',
    width: 3,
    height: 3,
  },
  floorTableWrap: {
    position: 'absolute',
  },
  floorTable: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  chairTop: {
    position: 'absolute',
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  chairBottom: {
    position: 'absolute',
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  chairLeft: {
    position: 'absolute',
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  chairRight: {
    position: 'absolute',
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 16,
  },
});
