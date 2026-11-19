import { posText, usePosLanguage } from '../../i18n/language';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import {
  BarcodeScannerModal,
  type ScannerResolvedItem,
} from '../../components/BarcodeScannerModal';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  TABLET_SIDEBAR_WIDTH,
  TabletMainNavigation,
} from '../../components/TabletMainNavigation';
import {
  MobilePosApplyStockCountDocument,
  MobilePosCancelStockCountDocument,
  MobilePosCancelStockTransferDocument,
  MobilePosCreateStockCountDocument,
  MobilePosCreateStockTransferDocument,
  MobilePosReceiveStockTransferDocument,
  MobilePosRecordStockCountItemDocument,
  MobilePosSendStockTransferDocument,
  MobilePosStockCountsDocument,
  MobilePosStockSearchDocument,
  MobilePosStockTransfersDocument,
  type MobilePosStockCountsQuery,
  type MobilePosStockSearchQuery,
  type MobilePosStockTransfersQuery,
} from '../../graphql/generated';
import {
  createIdempotencyKey,
  isDecidedRejection,
  isStaleOperationConflict,
} from '../../lib/operation';
import type { AppStackParamList } from '../../navigation/types';
import { useSession } from '../../state/SessionContext';
import { useStoreMode } from '../../state/StoreModeContext';
import { useTheme } from '../../theme/ThemeProvider';
import { supportsTabletLayout } from '../../theme/useResponsive';

type ViewMode = 'LOOKUP' | 'OVERVIEW' | 'TRANSFER' | 'COUNT';
type DraftLine = { sku: string; size: string; qty: string };
type Transfer =
  MobilePosStockTransfersQuery['bmsPosStockTransfers']['transfers'][number];
type TransferData = MobilePosStockTransfersQuery['bmsPosStockTransfers'];
type CountData = MobilePosStockCountsQuery['bmsPosStockCounts'];
type StockCount = CountData['counts'][number];
type StockSearchItem =
  MobilePosStockSearchQuery['bmsPosStockSearch']['items'][number];
type StockScanResult = ScannerResolvedItem & { code: string };
type ReceiptDraft = {
  itemId: number;
  sku: string;
  size: string;
  sent: number;
  qty: string;
  damagedQty: string;
  reason: string;
  note: string;
};

const emptyLine = (): DraftLine => ({ sku: '', size: '', qty: '1' });
class BusinessResultError extends Error {}
/**
 * บนแท็บเล็ตจอนี้เป็นปลายทางของรางด้านซ้าย (ไม่ได้ถูก push มา) — ปุ่มย้อนกลับจึงไม่มีที่ให้กลับ
 * ปุ่มที่กดแล้วไม่เกิดอะไรคือปุ่มที่สอนให้คนเลิกเชื่อปุ่มอื่นบนจอเดียวกัน
 */
type Props = {
  asTabRoot?: boolean;
};

const discrepancyReasons = [
  { code: 'LOST_IN_TRANSIT', get label() { return posText("สูญหายระหว่างทาง"); } },
  { code: 'SOURCE_SHORT_SHIP', get label() { return posText("ต้นทางส่งขาด"); } },
  { code: 'COUNT_ERROR', get label() { return posText("นับผิด"); } },
  { code: 'DAMAGED', get label() { return posText("เสียหาย"); } },
  { code: 'OTHER', get label() { return posText("อื่นๆ"); } },
] as const;

function hasDiscrepancy(row: ReceiptDraft): boolean {
  const received = Number(row.qty);
  const damaged = Number(row.damagedQty);
  return (
    Number.isFinite(received) &&
    Number.isFinite(damaged) &&
    (damaged > 0 || received + damaged < row.sent)
  );
}

function resultError(
  result:
    | {
        status?: string | null;
        reason?: string | null;
        current?: string | null;
        sku?: string | null;
        size?: string | null;
        available?: number | null;
        requested?: number | null;
        reserved?: number | null;
        wouldBe?: number | null;
      }
    | null
    | undefined,
): string | null {
  if (!result || typeof result.status !== 'string' || !result.status.trim()) {
    // Missing status is an unknown outcome, not a decided business rejection.
    throw new Error(posText("ไม่ได้รับผลยืนยันจากเซิร์ฟเวอร์"));
  }
  if (result.reason) return result.reason;
  if (['OK', 'CREATED', 'APPLIED'].includes(result.status ?? '')) return null;
  if (result.status === 'INSUFFICIENT') {
    return posText("{v0}/{v1} มีพร้อมโอน {v2} แต่ขอ {v3}", { v0: result.sku, v1: result.size, v2: result.available ?? 0, v3: result.requested ?? 0 });
  }
  if (result.status === 'WOULD_BREAK_RESERVED') {
    return posText("{v0}/{v1} จะเหลือ {v2} ต่ำกว่ายอดจอง {v3}", { v0: result.sku, v1: result.size, v2: result.wouldBe ?? 0, v3: result.reserved ?? 0 });
  }
  if (result.status === 'WRONG_STATE') {
    return posText("สถานะปัจจุบัน {v0}", { v0: result.current ?? '-' });
  }
  return result.status ?? posText("ทำรายการไม่สำเร็จ");
}

function branchDisplayLabel(branchName: string) {
  return branchName.replace(/^BOOM\s+/, 'BOOM · ');
}

function transferStatusLabel(status: string) {
  if (status === 'IN_TRANSIT') return posText("รอรับสินค้า");
  if (status === 'DRAFT') return posText("ฉบับร่าง");
  return status;
}

type InventorySummaryProps = {
  isTablet: boolean;
  sellableSkuCount: number;
  lowStockCount: number;
  incomingCount: number;
  draftCountCount: number;
};

function InventorySummary({
  isTablet,
  sellableSkuCount,
  lowStockCount,
  incomingCount,
  draftCountCount,
}: InventorySummaryProps) {
  usePosLanguage();
  const { colors, scheme, spacing, typography } = useTheme();
  const primaryTint =
    scheme === 'dark' ? 'rgba(22, 119, 255, 0.18)' : '#eff6ff';
  const items = [
    {
      key: 'sellable',
      glyph: '◇',
      label: posText("พร้อมขาย"),
      value: `${sellableSkuCount} SKU`,
      color: colors.success,
      backgroundColor: colors.successBg,
    },
    {
      key: 'low',
      glyph: '!',
      label: posText("ใกล้หมด"),
      value: String(lowStockCount),
      color: colors.warning,
      backgroundColor: colors.warningBg,
    },
    {
      key: 'incoming',
      glyph: '⇥',
      label: posText("รอรับเข้า"),
      value: String(incomingCount),
      color: colors.primary,
      backgroundColor: primaryTint,
    },
    {
      key: 'counts',
      glyph: '▣',
      label: posText("รอบนับค้าง"),
      value: String(draftCountCount),
      color: colors.danger,
      backgroundColor: colors.dangerBg,
    },
  ];
  return (
    <View style={styles.summaryGrid}>
      {items.map(item => (
        <View
          key={item.key}
          style={[
            styles.summaryCard,
            {
              width: isTablet ? '23.7%' : '48.5%',
              padding: isTablet ? spacing.lg : spacing.md,
              backgroundColor: item.backgroundColor,
            },
          ]}
        >
          <View style={styles.summaryIconRow}>
            <View
              style={[
                styles.summaryIcon,
                { backgroundColor: `${item.color}1f` },
              ]}
            >
              <Text style={[styles.summaryGlyph, { color: item.color }]}>
                {item.glyph}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text
                numberOfLines={1}
                style={[typography.captionStrong, { color: item.color }]}
              >
                {item.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  isTablet ? typography.numeric : styles.summaryValuePhone,
                  { color: item.color },
                ]}
              >
                {item.value}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

type InventoryOverviewProps = {
  isTablet: boolean;
  transferData?: TransferData;
  countData?: CountData;
  phoneNavigation?: React.ReactNode;
  onReceive: (transfer: Transfer) => void;
  onOpenTransfers: () => void;
  onOpenCount: (count: StockCount) => void;
};

function InventoryOverview({
  isTablet,
  transferData,
  countData,
  phoneNavigation,
  onReceive,
  onOpenTransfers,
  onOpenCount,
}: InventoryOverviewProps) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const deviceLocationId = transferData?.deviceLocationId;
  const incoming = (transferData?.transfers ?? []).filter(
    transfer =>
      transfer.status === 'IN_TRANSIT' &&
      transfer.toLocationId === deviceLocationId,
  );
  const outgoingDrafts = (transferData?.transfers ?? []).filter(
    transfer =>
      transfer.status === 'DRAFT' &&
      transfer.fromLocationId === deviceLocationId,
  );
  const draftCounts = (countData?.counts ?? []).filter(
    count => count.status === 'DRAFT',
  );
  const summary = (
    <InventorySummary
      isTablet={isTablet}
      sellableSkuCount={transferData?.summary.sellableSkuCount ?? 0}
      lowStockCount={transferData?.summary.lowStockCount ?? 0}
      incomingCount={incoming.length}
      draftCountCount={draftCounts.length}
    />
  );
  const tasks = [
    ...incoming.map(transfer => ({
      key: `receive-${transfer.id}`,
      glyph: '⇥',
      title: posText("รับสินค้าจาก{v0}", { v0: transfer.fromLocationName ?? posText("อีกสาขา") }),
      detail: posText("{v0} · {v1} รายการ", { v0: transfer.transferNo, v1: transfer.items.length }),
      status: posText("รอรับสินค้า"),
      statusColor: colors.warning,
      action: posText("ตรวจรับ"),
      onPress: () => onReceive(transfer),
    })),
    ...draftCounts.map(count => ({
      key: `count-${count.id}`,
      glyph: '▣',
      title: count.note?.trim() || posText("นับสต็อกสาขา"),
      detail: posText("{v0} · บันทึกแล้ว {v1} รายการ", { v0: count.countNo, v1: count.items.length }),
      status: posText("ฉบับร่าง"),
      statusColor: colors.textMuted,
      action: posText("ทำต่อ"),
      onPress: () => onOpenCount(count),
    })),
    ...outgoingDrafts.map(transfer => ({
      key: `send-${transfer.id}`,
      glyph: '⇄',
      title: posText("โอนสินค้าไป{v0}", { v0: transfer.toLocationName ?? posText("อีกสาขา") }),
      detail: posText("{v0} · {v1} รายการ", { v0: transfer.transferNo, v1: transfer.items.length }),
      status: transferStatusLabel(transfer.status),
      statusColor: colors.success,
      action: posText("ดูรายละเอียด"),
      onPress: onOpenTransfers,
    })),
  ].slice(0, 4);

  const taskPanel = (
    <View
      style={[
        styles.dashboardPanel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.between}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          {posText("งานที่ต้องทำ") + " "}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={posText("ดูงานสต็อกทั้งหมด")}
          onPress={onOpenTransfers}
        >
          <Text style={[typography.captionStrong, { color: colors.primary }]}>
            {posText("ดูทั้งหมด ›") + " "}</Text>
        </Pressable>
      </View>
      {tasks.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {posText("ไม่มีงานโอนหรือใบนับที่ค้างอยู่") + " "}</Text>
      ) : (
        tasks.map(task => (
          <View
            key={task.key}
            style={[styles.taskRow, { borderColor: colors.border }]}
          >
            <View
              style={[styles.taskIcon, { backgroundColor: colors.surface2 }]}
            >
              <Text style={[styles.taskGlyph, { color: colors.primary }]}>
                {task.glyph}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text
                numberOfLines={1}
                style={[typography.bodyStrong, { color: colors.text }]}
              >
                {task.title}
              </Text>
              <Text
                numberOfLines={1}
                style={[typography.caption, { color: colors.textMuted }]}
              >
                {task.detail}
              </Text>
              {!isTablet ? (
                <Text
                  style={[
                    typography.captionStrong,
                    { color: task.statusColor },
                  ]}
                >
                  {task.status}
                </Text>
              ) : null}
            </View>
            {isTablet ? (
              <View
                style={[
                  styles.taskStatus,
                  { backgroundColor: `${task.statusColor}1f` },
                ]}
              >
                <Text
                  style={[
                    typography.captionStrong,
                    { color: task.statusColor },
                  ]}
                >
                  {task.status}
                </Text>
              </View>
            ) : null}
            <Button
              label={task.action}
              variant={task.action === posText("ตรวจรับ") ? 'primary' : 'secondary'}
              onPress={task.onPress}
              style={styles.taskAction}
            />
          </View>
        ))
      )}
    </View>
  );

  const lowStockPanel = (
    <View
      style={[
        styles.dashboardPanel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.between}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          {posText("สินค้าใกล้หมด") + " "}</Text>
        <Text style={[typography.captionStrong, { color: colors.primary }]}>
          {transferData?.summary.lowStockCount ?? 0} {" " + posText("รายการ") + " "}</Text>
      </View>
      {(transferData?.lowStock ?? []).length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {posText("ยังไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ") + " "}</Text>
      ) : (
        (transferData?.lowStock ?? []).slice(0, isTablet ? 6 : 4).map(item => (
          <View
            key={`${item.sku}-${item.size}`}
            style={[styles.lowStockRow, { borderColor: colors.border }]}
          >
            <View
              style={[
                styles.productMark,
                { backgroundColor: colors.warningBg },
              ]}
            >
              <Text style={[styles.productMarkText, { color: colors.warning }]}>
                {item.name.slice(0, 1)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text
                numberOfLines={1}
                style={[typography.bodyStrong, { color: colors.text }]}
              >
                {item.name}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {item.sku} · {item.size}
              </Text>
            </View>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              {posText("เหลือ") + " "}{item.available}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {posText("ขั้นต่ำ") + " "}{item.reorderPoint}
            </Text>
          </View>
        ))
      )}
    </View>
  );

  const libraryNote = (
    <View
      style={[
        styles.libraryNote,
        { backgroundColor: colors.surface2, borderColor: colors.border },
      ]}
    >
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        {posText("สต็อกขาย ≠ คลังเกมเล่น") + " "}</Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {posText("เกมที่ให้ลูกค้ายืมจัดการในเมนูคลังเกม ไม่ตัดสต็อกขาย") + " "}</Text>
    </View>
  );

  if (isTablet) {
    return (
      <View style={{ gap: spacing.lg }}>
        {summary}
        <View style={styles.dashboardColumns}>
          <View style={styles.dashboardPrimary}>{taskPanel}</View>
          <View style={styles.dashboardSecondary}>
            {lowStockPanel}
            {libraryNote}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.infoStrip, { backgroundColor: colors.surface2 }]}>
        <Text style={[typography.captionStrong, { color: colors.primary }]}>
          {posText("ⓘ สินค้าเพื่อขายเท่านั้น · เกมสำหรับเล่นอยู่ในคลังเกม") + " "}</Text>
      </View>
      {summary}
      {phoneNavigation}
      {taskPanel}
      {lowStockPanel}
    </View>
  );
}

function StockLookup({
  items,
  loading,
  failed,
  draft,
  offset,
  nextOffset,
  onDraftChange,
  onSearch,
  onScan,
  onPrevious,
  onNext,
  onUseForTransfer,
  onUseForCount,
}: {
  items: StockSearchItem[];
  loading: boolean;
  failed: boolean;
  draft: string;
  offset: number;
  nextOffset: number | null | undefined;
  onDraftChange: (value: string) => void;
  onSearch: () => void;
  onScan: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onUseForTransfer: (item: StockSearchItem) => void;
  onUseForCount: (item: StockSearchItem) => void;
}) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ gap: spacing.md }}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          {posText("ค้นหาสต็อก") + " "}</Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {posText("ค้นด้วยชื่อ SKU หรือบาร์โค้ด · แสดงยอดของสาขาเครื่องนี้จากเซิร์ฟเวอร์") + " "}</Text>
        <View style={styles.row}>
          <TextInput
            value={draft}
            onChangeText={onDraftChange}
            onSubmitEditing={onSearch}
            placeholder={posText("ชื่อสินค้า, SKU หรือบาร์โค้ด")}
            placeholderTextColor={colors.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={200}
            returnKeyType="search"
            style={[
              styles.input,
              styles.flex,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.surface,
              },
            ]}
          />
          <Button label={posText("ค้นหา")} loading={loading} onPress={onSearch} />
          <Button label={posText("สแกน")} variant="secondary" onPress={onScan} />
        </View>
      </Card>

      {!loading && !failed && items.length === 0 ? (
        <Card>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {posText("ไม่พบสินค้าที่ตรงกับคำค้นหา") + " "}</Text>
        </Card>
      ) : null}

      {items.map(item => {
        // Quantities are stored in base units; a display-unit label alone is not conversion.
        const unit = item.baseUnit;
        return (
          <Card
            key={`${item.locationId}-${item.sku}-${item.size}`}
            style={{ gap: spacing.sm }}
          >
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.name}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {item.sku} · {item.size} · {item.stockPolicy}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={[
                    typography.subtitle,
                    {
                      color:
                        item.available > 0 ? colors.success : colors.danger,
                    },
                  ]}
                >
                  {posText("พร้อมใช้") + " "}{item.available}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {unit}
                </Text>
              </View>
            </View>
            <View style={styles.wrap}>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("คงเหลือ") + " "}{item.currentStock}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("จอง") + " "}{item.reservedStock}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("กักกัน") + " "}{item.quarantineStock}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("กำลังเข้า") + " "}{item.incomingStock}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("จุดสั่งซื้อ") + " "}{item.reorderPoint}
              </Text>
            </View>
            {item.operationBlockReason ? (
              <View
                style={[
                  styles.infoStrip,
                  { backgroundColor: colors.warningBg },
                ]}
              >
                <Text
                  style={[typography.captionStrong, { color: colors.warning }]}
                >
                  {item.operationBlockReason}
                </Text>
              </View>
            ) : (
              <View style={styles.wrap}>
                <Button
                  label={posText("เพิ่มลงใบโอน")}
                  variant="secondary"
                  disabled={loading || failed || !item.transferSupported}
                  onPress={() => onUseForTransfer(item)}
                />
                <Button
                  label={posText("เพิ่มลงใบนับ")}
                  variant="secondary"
                  disabled={loading || failed || !item.countSupported}
                  onPress={() => onUseForCount(item)}
                />
              </View>
            )}
          </Card>
        );
      })}

      {offset > 0 || nextOffset != null ? (
        <View style={styles.between}>
          <Button
            label={posText("ก่อนหน้า")}
            variant="secondary"
            disabled={offset === 0 || loading}
            onPress={onPrevious}
          />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {posText("หน้า") + " "}{Math.floor(offset / 30) + 1}
          </Text>
          <Button
            label={posText("ถัดไป")}
            variant="secondary"
            disabled={nextOffset == null || loading}
            onPress={onNext}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function InventoryScreen({ asTabRoot }: Props) {
  usePosLanguage();
  const navigation =
    useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const { mode: storeMode } = useStoreMode();
  const { width, height } = useWindowDimensions();
  const isTablet =
    supportsTabletLayout(width, height, 760) && Boolean(asTabRoot);
  const credentials = session?.credentials;
  const [mode, setMode] = useState<ViewMode>('LOOKUP');
  const [lookupDraft, setLookupDraft] = useState('');
  const [lookupSearch, setLookupSearch] = useState('');
  const [lookupOffset, setLookupOffset] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [working, setWorking] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [line, setLine] = useState<DraftLine>(emptyLine);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [receiptRows, setReceiptRows] = useState<ReceiptDraft[]>([]);
  const [receivingNote, setReceivingNote] = useState('');
  const [countNote, setCountNote] = useState('');
  const [selectedCountId, setSelectedCountId] = useState('');
  const [countSku, setCountSku] = useState('');
  const [countSize, setCountSize] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [countItemNote, setCountItemNote] = useState('');
  const operationKeys = useRef<Record<string, string>>({});
  const operationInFlight = useRef(false);

  const inputCredentials = credentials ?? { cashierUserId: '', pin: '' };
  const transfers = useQuery(MobilePosStockTransfersDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials || mode === 'COUNT' || mode === 'LOOKUP',
  });
  const counts = useQuery(MobilePosStockCountsDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials || mode === 'TRANSFER' || mode === 'LOOKUP',
  });
  const stockSearch = useQuery(MobilePosStockSearchDocument, {
    variables: {
      credentials: inputCredentials,
      q: lookupSearch,
      limit: 30,
      offset: lookupOffset,
    },
    skip: !credentials || mode !== 'LOOKUP',
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });
  const [scanStock] = useLazyQuery(MobilePosStockSearchDocument, {
    fetchPolicy: 'network-only',
  });
  const [createTransfer] = useMutation(MobilePosCreateStockTransferDocument);
  const [sendTransfer] = useMutation(MobilePosSendStockTransferDocument);
  const [receiveTransfer] = useMutation(MobilePosReceiveStockTransferDocument);
  const [cancelTransfer] = useMutation(MobilePosCancelStockTransferDocument);
  const [createCount] = useMutation(MobilePosCreateStockCountDocument);
  const [recordCountItem] = useMutation(MobilePosRecordStockCountItemDocument);
  const [applyCount] = useMutation(MobilePosApplyStockCountDocument);
  const [cancelCount] = useMutation(MobilePosCancelStockCountDocument);
  const refetchTransfers = transfers.refetch;
  const refetchCounts = counts.refetch;
  const refetchStockSearch = stockSearch.refetch;

  useFocusEffect(
    useCallback(() => {
      if (!credentials) return;
      if (mode === 'LOOKUP') {
        refetchStockSearch().catch(() => undefined);
        return;
      }
      if (mode === 'OVERVIEW') {
        Promise.all([refetchTransfers(), refetchCounts()]).catch(
          () => undefined,
        );
        return;
      }
      const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
      refetch().catch(() => undefined);
    }, [
      credentials,
      mode,
      refetchCounts,
      refetchStockSearch,
      refetchTransfers,
    ]),
  );

  const transferData = transfers.data?.bmsPosStockTransfers;
  const countData = counts.data?.bmsPosStockCounts;
  const selectedCount = countData?.counts.find(
    item => item.id === selectedCountId,
  );
  const pendingTransfers = useMemo(
    () =>
      (transferData?.transfers ?? []).filter(item =>
        ['DRAFT', 'IN_TRANSIT'].includes(item.status),
      ),
    [transferData?.transfers],
  );

  const submitLookup = () => {
    if (lookupOffset === 0 && lookupSearch === lookupDraft.trim()) {
      refetchStockSearch().catch(() => undefined);
      return;
    }
    setLookupOffset(0);
    setLookupSearch(lookupDraft.trim());
  };
  const resolveStockCode = async (code: string): Promise<StockScanResult> => {
    if (!credentials) throw new Error(posText("กรุณาเลือกพนักงานและใส่ PIN"));
    const response = await scanStock({
      variables: { credentials, q: code.trim(), limit: 30, offset: 0 },
    });
    const items = response.data?.bmsPosStockSearch.items ?? [];
    if (items.length === 0) throw new Error(posText("ไม่พบสินค้า {v0}", { v0: code }));
    const first = items[0];
    return {
      name:
        items.length === 1
          ? `${first.name} · ${first.size}`
          : posText("{v0} · {v1} ตัวเลือก", { v0: first.name, v1: items.length }),
      sellable: true,
      code: code.trim(),
    };
  };

  const run = async (key: string, action: () => Promise<string | null>) => {
    if (!credentials || operationInFlight.current) return false;
    operationInFlight.current = true;
    setWorking(key);
    try {
      const error = await action();
      if (error) throw new BusinessResultError(error);
      delete operationKeys.current[key];
      const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
      await refetch().catch(() => undefined);
      return true;
    } catch (cause) {
      // คีย์ถูกเก็บไว้เฉพาะตอน "ไม่รู้ผล" เท่านั้น เพื่อให้กดซ้ำแล้ว replay คำตอบเดิม
      // · ผลที่รู้แล้ว (ธุรกิจปฏิเสธ) และ CONFLICT (คีย์นี้ผูกกับคำขอเก่าไปแล้ว) ต้องทิ้งคีย์
      //   ไม่งั้นคนหน้าเครื่องแก้ข้อมูลแล้วกดใหม่จะชนคีย์เดิมและล้มแบบเดิมไปตลอด
      const stale = isStaleOperationConflict(cause);
      if (cause instanceof BusinessResultError || isDecidedRejection(cause)) {
        delete operationKeys.current[key];
      }
      if (stale) {
        const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
        await refetch().catch(() => undefined);
      }
      Alert.alert(
        stale ? posText("ข้อมูลเปลี่ยนไปแล้ว") : posText("ทำรายการไม่สำเร็จ"),
        cause instanceof Error ? cause.message : posText("กรุณาลองใหม่"),
      );
      return false;
    } finally {
      operationInFlight.current = false;
      setWorking('');
    }
  };
  const retryKey = (key: string) =>
    (operationKeys.current[key] ??= createIdempotencyKey(`inventory-${key}`));

  const addDraftLine = () => {
    const qty = Number(line.qty);
    if (
      !line.sku.trim() ||
      !line.size.trim() ||
      !Number.isInteger(qty) ||
      qty <= 0
    ) {
      Alert.alert(posText("รายการไม่ครบ"), posText("ระบุ SKU, ขนาด และจำนวนเต็มที่มากกว่า 0"));
      return;
    }
    setDraftLines(previous => [
      ...previous,
      {
        sku: line.sku.trim(),
        size: line.size.trim().toUpperCase(),
        qty: String(qty),
      },
    ]);
    setLine(emptyLine());
  };

  const beginReceive = (transfer: Transfer) => {
    setReceiving(transfer);
    setReceivingNote('');
    setReceiptRows(
      transfer.items.map(item => ({
        itemId: item.id,
        sku: item.sku,
        size: item.size,
        sent: item.qty,
        qty: String(item.qty),
        damagedQty: '0',
        reason: '',
        note: '',
      })),
    );
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
    },
  ];

  const branchName = session?.branch.name ?? '-';
  const activeError =
    mode === 'LOOKUP'
      ? stockSearch.error
      : mode === 'OVERVIEW'
      ? transfers.error ?? counts.error
      : mode === 'TRANSFER'
      ? transfers.error
      : counts.error;
  const permissionDenied = activeError?.message.includes(posText("ไม่มีสิทธิ์"));
  const retryActiveView = () => {
    if (mode === 'LOOKUP') {
      refetchStockSearch().catch(() => undefined);
      return;
    }
    if (mode === 'OVERVIEW') {
      Promise.all([refetchTransfers(), refetchCounts()]).catch(() => undefined);
      return;
    }
    const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
    refetch().catch(() => undefined);
  };
  const phoneNavigation = (
    <View style={[styles.segment, { gap: spacing.xs }]}>
      {(
        [
          ['LOOKUP', posText("ค้นหา")],
          ['OVERVIEW', posText("ภาพรวม")],
          ['TRANSFER', posText("โอนสินค้า")],
          ['COUNT', posText("นับสต็อก")],
        ] as const
      ).map(([value, label]) => (
        <Button
          key={value}
          label={label}
          variant={mode === value ? 'primary' : 'secondary'}
          onPress={() => setMode(value)}
          style={styles.segmentButton}
        />
      ))}
    </View>
  );
  const errorPanel = activeError ? (
    <View
      style={[
        styles.errorPanel,
        { backgroundColor: colors.dangerBg, borderColor: colors.danger },
      ]}
    >
      <View style={styles.flex}>
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>
          {permissionDenied
            ? posText("บัญชีนี้ไม่มีสิทธิ์ใช้งานสต็อก")
            : posText("โหลดข้อมูลงานสต็อกไม่สำเร็จ")}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {permissionDenied
            ? mode === 'LOOKUP'
              ? posText("ให้ผู้ดูแลกำหนดสิทธิ์ดูสินค้า (product.view) ให้บัญชีนี้")
              : posText("ให้ Manager, Warehouse หรือผู้ดูแลระบบเข้าใช้งาน")
            : posText("ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง")}
        </Text>
      </View>
      {permissionDenied ? null : (
        <Button label={posText("ลองใหม่")} variant="secondary" onPress={retryActiveView} />
      )}
    </View>
  ) : null;

  const workContent = (
    <>
      {errorPanel}
      {mode === 'LOOKUP' ? (
        <StockLookup
          items={stockSearch.data?.bmsPosStockSearch.items ?? []}
          loading={stockSearch.loading}
          failed={Boolean(stockSearch.error)}
          draft={lookupDraft}
          offset={lookupOffset}
          nextOffset={stockSearch.data?.bmsPosStockSearch.nextOffset}
          onDraftChange={setLookupDraft}
          onSearch={submitLookup}
          onScan={() => setScannerOpen(true)}
          onPrevious={() => setLookupOffset(Math.max(0, lookupOffset - 30))}
          onNext={() => {
            const next = stockSearch.data?.bmsPosStockSearch.nextOffset;
            if (next != null) setLookupOffset(next);
          }}
          onUseForTransfer={item => {
            setLine({ sku: item.sku, size: item.size, qty: '1' });
            setMode('TRANSFER');
          }}
          onUseForCount={item => {
            setCountSku(item.sku);
            setCountSize(item.size);
            setCountedQty('');
            setMode('COUNT');
          }}
        />
      ) : mode === 'OVERVIEW' ? (
        <InventoryOverview
          isTablet={isTablet}
          transferData={transferData}
          countData={countData}
          phoneNavigation={isTablet ? undefined : phoneNavigation}
          onReceive={transfer => {
            setMode('TRANSFER');
            beginReceive(transfer);
          }}
          onOpenTransfers={() => setMode('TRANSFER')}
          onOpenCount={count => {
            setSelectedCountId(count.id);
            setMode('COUNT');
          }}
        />
      ) : mode === 'TRANSFER' ? (
        <>
          <Card style={{ gap: spacing.md }}>
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {posText("สร้างใบโอน") + " "}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {posText("ต้นทางถูกกำหนดจากสาขาของเครื่อง เลือกเฉพาะปลายทาง") + " "}</Text>
            <View style={styles.wrap}>
              {(transferData?.destinations ?? []).map(location => (
                <Button
                  key={location.id}
                  label={location.name}
                  variant={
                    destinationId === location.id ? 'primary' : 'secondary'
                  }
                  onPress={() => setDestinationId(location.id)}
                />
              ))}
            </View>
            <View style={styles.row}>
              <TextInput
                value={line.sku}
                onChangeText={sku =>
                  setLine(previous => ({ ...previous, sku }))
                }
                placeholder="SKU"
                placeholderTextColor={colors.textSoft}
                autoCapitalize="characters"
                style={[inputStyle, styles.flex]}
              />
              <TextInput
                value={line.size}
                onChangeText={size =>
                  setLine(previous => ({ ...previous, size }))
                }
                placeholder={posText("ขนาด")}
                placeholderTextColor={colors.textSoft}
                autoCapitalize="characters"
                style={[inputStyle, styles.smallInput]}
              />
              <TextInput
                value={line.qty}
                onChangeText={qty =>
                  setLine(previous => ({ ...previous, qty }))
                }
                placeholder={posText("จำนวน")}
                placeholderTextColor={colors.textSoft}
                keyboardType="number-pad"
                style={[inputStyle, styles.smallInput]}
              />
            </View>
            <Button
              label={posText("เพิ่มรายการ")}
              variant="secondary"
              onPress={addDraftLine}
            />
            {draftLines.map((item, index) => (
              <View
                key={`${item.sku}-${item.size}-${index}`}
                style={styles.between}
              >
                <Text
                  style={[typography.body, { color: colors.text, flex: 1 }]}
                >
                  {item.sku} / {item.size} × {item.qty}
                </Text>
                <Button
                  label={posText("ลบ")}
                  variant="ghost"
                  onPress={() =>
                    setDraftLines(rows =>
                      rows.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                />
              </View>
            ))}
            <TextInput
              value={transferNote}
              onChangeText={setTransferNote}
              placeholder={posText("หมายเหตุใบโอน")}
              placeholderTextColor={colors.textSoft}
              style={inputStyle}
            />
            <Button
              label={posText("บันทึกใบโอน")}
              fullWidth
              loading={working === 'create-transfer'}
              disabled={!destinationId || draftLines.length === 0}
              onPress={() =>
                run('create-transfer', async () => {
                  const response = await createTransfer({
                    variables: {
                      input: {
                        ...inputCredentials,
                        idempotencyKey: retryKey('create-transfer'),
                        destinationId,
                        note: transferNote.trim() || null,
                        items: draftLines.map(item => ({
                          sku: item.sku,
                          size: item.size,
                          qty: Number(item.qty),
                        })),
                      },
                    },
                  });
                  const result = response.data?.bmsPosCreateStockTransfer;
                  const error = resultError(result);
                  if (!error) {
                    setDraftLines([]);
                    setDestinationId('');
                    setTransferNote('');
                  }
                  return error;
                })
              }
            />
          </Card>

          {receiving ? (
            <Card style={{ gap: spacing.md }}>
              <View style={styles.between}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  {posText("รับ") + " "}{receiving.transferNo}
                </Text>
                <Button
                  label={posText("ปิด")}
                  variant="ghost"
                  onPress={() => setReceiving(null)}
                />
              </View>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("จำนวนรับดี + เสียหาย ต้องไม่เกินจำนวนที่ส่ง หากขาดหรือเสียหายต้องระบุเหตุผลและหมายเหตุ") + " "}</Text>
              {receiptRows.map((row, index) => (
                <View
                  key={row.itemId}
                  style={[styles.receiptLine, { borderColor: colors.border }]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>
                    {row.sku} / {row.size} {" " + posText("· ส่ง") + " "}{row.sent}
                  </Text>
                  <View style={styles.row}>
                    <TextInput
                      value={row.qty}
                      onChangeText={qty =>
                        setReceiptRows(items =>
                          items.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, qty } : item,
                          ),
                        )
                      }
                      placeholder={posText("รับดี")}
                      placeholderTextColor={colors.textSoft}
                      keyboardType="number-pad"
                      style={[inputStyle, styles.flex]}
                    />
                    <TextInput
                      value={row.damagedQty}
                      onChangeText={damagedQty =>
                        setReceiptRows(items =>
                          items.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, damagedQty }
                              : item,
                          ),
                        )
                      }
                      placeholder={posText("เสียหาย")}
                      placeholderTextColor={colors.textSoft}
                      keyboardType="number-pad"
                      style={[inputStyle, styles.flex]}
                    />
                  </View>
                  {hasDiscrepancy(row) ? (
                    <>
                      <View style={styles.wrap}>
                        {discrepancyReasons.map(reason => (
                          <Button
                            key={reason.code}
                            label={reason.label}
                            variant={
                              row.reason === reason.code
                                ? 'primary'
                                : 'secondary'
                            }
                            onPress={() =>
                              setReceiptRows(items =>
                                items.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, reason: reason.code }
                                    : item,
                                ),
                              )
                            }
                          />
                        ))}
                      </View>
                      <TextInput
                        value={row.note}
                        onChangeText={note =>
                          setReceiptRows(items =>
                            items.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, note } : item,
                            ),
                          )
                        }
                        placeholder={posText("อธิบายส่วนต่าง (จำเป็น)")}
                        placeholderTextColor={colors.textSoft}
                        style={inputStyle}
                      />
                    </>
                  ) : (
                    <Text
                      style={[typography.caption, { color: colors.success }]}
                    >
                      {posText("รับครบตามจำนวนส่ง") + " "}</Text>
                  )}
                </View>
              ))}
              <TextInput
                value={receivingNote}
                onChangeText={setReceivingNote}
                placeholder={posText("หมายเหตุการรับ")}
                placeholderTextColor={colors.textSoft}
                style={inputStyle}
              />
              <Button
                label={posText("ยืนยันรับสินค้า")}
                fullWidth
                loading={working === `receive-${receiving.id}`}
                onPress={() =>
                  run(`receive-${receiving.id}`, async () => {
                    const response = await receiveTransfer({
                      variables: {
                        input: {
                          ...inputCredentials,
                          idempotencyKey: retryKey(`receive-${receiving.id}`),
                          transferId: receiving.id,
                          receivingNote: receivingNote.trim() || null,
                          received: receiptRows.map(item => ({
                            itemId: item.itemId,
                            qty: Number(item.qty),
                            damagedQty: Number(item.damagedQty),
                            reason: item.reason.trim() || null,
                            note: item.note.trim() || null,
                          })),
                        },
                      },
                    });
                    const error = resultError(
                      response.data?.bmsPosReceiveStockTransfer,
                    );
                    if (!error) setReceiving(null);
                    return error;
                  })
                }
              />
            </Card>
          ) : null}

          {pendingTransfers.map(transfer => {
            const isSource =
              transfer.fromLocationId === transferData?.deviceLocationId;
            return (
              <Card key={transfer.id} style={{ gap: spacing.sm }}>
                <View style={styles.between}>
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>
                    {transfer.transferNo}
                  </Text>
                  <Text
                    style={[
                      typography.captionStrong,
                      {
                        color:
                          transfer.status === 'IN_TRANSIT'
                            ? colors.warning
                            : colors.primary,
                      },
                    ]}
                  >
                    {transfer.status}
                  </Text>
                </View>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {transfer.fromLocationName ?? '-'} →{' '}
                  {transfer.toLocationName ?? '-'}
                </Text>
                {transfer.items.map(item => (
                  <Text
                    key={item.id}
                    style={[typography.body, { color: colors.text }]}
                  >
                    {item.productName ?? item.sku} · {item.size} × {item.qty}
                  </Text>
                ))}
                <View style={styles.wrap}>
                  {transfer.status === 'DRAFT' && isSource ? (
                    <Button
                      label={posText("ส่งสินค้า")}
                      loading={working === `send-${transfer.id}`}
                      onPress={() =>
                        Alert.alert(
                          posText("ยืนยันส่งสินค้า"),
                          posText("สต็อกจะถูกตัดจากสาขาต้นทางทันที"),
                          [
                            { text: posText("กลับ") },
                            {
                              text: posText("ยืนยัน"),
                              onPress: () => {
                                run(`send-${transfer.id}`, async () => {
                                  const response = await sendTransfer({
                                    variables: {
                                      input: {
                                        ...inputCredentials,
                                        idempotencyKey: retryKey(
                                          `send-${transfer.id}`,
                                        ),
                                        transferId: transfer.id,
                                      },
                                    },
                                  });
                                  return resultError(
                                    response.data?.bmsPosSendStockTransfer,
                                  );
                                });
                              },
                            },
                          ],
                        )
                      }
                    />
                  ) : null}
                  {transfer.status === 'DRAFT' && isSource ? (
                    <Button
                      label={posText("ยกเลิก")}
                      variant="danger"
                      onPress={() =>
                        run(`cancel-${transfer.id}`, async () => {
                          const response = await cancelTransfer({
                            variables: {
                              input: {
                                ...inputCredentials,
                                idempotencyKey: retryKey(
                                  `cancel-${transfer.id}`,
                                ),
                                transferId: transfer.id,
                              },
                            },
                          });
                          return resultError(
                            response.data?.bmsPosCancelStockTransfer,
                          );
                        })
                      }
                    />
                  ) : null}
                  {transfer.status === 'IN_TRANSIT' && !isSource ? (
                    <Button
                      label={posText("รับสินค้า")}
                      onPress={() => beginReceive(transfer)}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </>
      ) : (
        <>
          <Card style={{ gap: spacing.md }}>
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {posText("เริ่มใบนับใหม่") + " "}</Text>
            <TextInput
              value={countNote}
              onChangeText={setCountNote}
              placeholder={posText("ขอบเขตหรือหมายเหตุการนับ")}
              placeholderTextColor={colors.textSoft}
              style={inputStyle}
            />
            <Button
              label={posText("สร้างใบนับ")}
              loading={working === 'create-count'}
              onPress={() =>
                run('create-count', async () => {
                  const response = await createCount({
                    variables: {
                      input: {
                        ...inputCredentials,
                        idempotencyKey: retryKey('create-count'),
                        note: countNote.trim() || null,
                      },
                    },
                  });
                  const result = response.data?.bmsPosCreateStockCount;
                  const error = resultError(result);
                  if (!error) {
                    setCountNote('');
                    setSelectedCountId(result?.countId ?? '');
                  }
                  return error;
                })
              }
            />
          </Card>

          {(countData?.counts ?? [])
            .filter(count => count.status === 'DRAFT')
            .map(count => (
              <Card key={count.id} style={{ gap: spacing.sm }}>
                <View style={styles.between}>
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>
                    {count.countNo}
                  </Text>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.primary },
                    ]}
                  >
                    {count.items.length} {" " + posText("รายการ · ต่าง") + " "}{count.varianceUnits}
                  </Text>
                </View>
                <Button
                  label={
                    selectedCountId === count.id
                      ? posText("กำลังกรอกใบนี้")
                      : posText("เปิดใบนับ")
                  }
                  variant={
                    selectedCountId === count.id ? 'primary' : 'secondary'
                  }
                  onPress={() => setSelectedCountId(count.id)}
                />
              </Card>
            ))}

          {selectedCount ? (
            <Card style={{ gap: spacing.md }}>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {posText("กรอก") + " "}{selectedCount.countNo}
              </Text>
              <View style={styles.row}>
                <TextInput
                  value={countSku}
                  onChangeText={setCountSku}
                  placeholder="SKU"
                  placeholderTextColor={colors.textSoft}
                  autoCapitalize="characters"
                  style={[inputStyle, styles.flex]}
                />
                <TextInput
                  value={countSize}
                  onChangeText={setCountSize}
                  placeholder={posText("ขนาด")}
                  placeholderTextColor={colors.textSoft}
                  autoCapitalize="characters"
                  style={[inputStyle, styles.smallInput]}
                />
                <TextInput
                  value={countedQty}
                  onChangeText={setCountedQty}
                  placeholder={posText("นับได้")}
                  placeholderTextColor={colors.textSoft}
                  keyboardType="number-pad"
                  style={[inputStyle, styles.smallInput]}
                />
              </View>
              <TextInput
                value={countItemNote}
                onChangeText={setCountItemNote}
                placeholder={posText("หมายเหตุรายการ")}
                placeholderTextColor={colors.textSoft}
                style={inputStyle}
              />
              <Button
                label={posText("บันทึกรายการ")}
                loading={working === `count-item-${selectedCount.id}`}
                disabled={
                  !countSku.trim() || !countSize.trim() || !countedQty.trim()
                }
                onPress={() =>
                  run(`count-item-${selectedCount.id}`, async () => {
                    if (!countedQty.trim()) return posText("กรุณากรอกจำนวนที่นับได้ หรือ 0 หากไม่มีสินค้า");
                    const response = await recordCountItem({
                      variables: {
                        input: {
                          ...inputCredentials,
                          idempotencyKey: retryKey(
                            `count-item-${selectedCount.id}`,
                          ),
                          countId: selectedCount.id,
                          sku: countSku.trim(),
                          size: countSize.trim(),
                          countedQty: Number(countedQty),
                          note: countItemNote.trim() || null,
                        },
                      },
                    });
                    const error = resultError(
                      response.data?.bmsPosRecordStockCountItem,
                    );
                    if (!error) {
                      setCountSku('');
                      setCountSize('');
                      setCountedQty('');
                      setCountItemNote('');
                    }
                    return error;
                  })
                }
              />
              {selectedCount.items.map(item => (
                <View key={item.id} style={styles.between}>
                  <Text
                    style={[typography.body, { color: colors.text, flex: 1 }]}
                  >
                    {item.productName ?? item.sku} / {item.size}
                  </Text>
                  <Text
                    style={[
                      typography.captionStrong,
                      {
                        color:
                          item.variance === 0 ? colors.success : colors.warning,
                      },
                    ]}
                  >
                    {posText("ระบบ") + " "}{item.snapshotQty} {" " + posText("· นับ") + " "}{item.countedQty} {" " + posText("· ต่าง")}{' '}
                    {item.variance}
                  </Text>
                </View>
              ))}
              <View style={styles.wrap}>
                <Button
                  label={posText("ยืนยันปรับสต็อก")}
                  loading={working === `apply-count-${selectedCount.id}`}
                  disabled={selectedCount.items.length === 0}
                  onPress={() =>
                    Alert.alert(
                      posText("ยืนยันผลนับ"),
                      posText("ระบบจะปรับสต็อกด้วยผลต่างจาก snapshot แรก"),
                      [
                        { text: posText("กลับ") },
                        {
                          text: posText("ยืนยัน"),
                          onPress: () => {
                            run(`apply-count-${selectedCount.id}`, async () => {
                              const response = await applyCount({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    idempotencyKey: retryKey(
                                      `apply-count-${selectedCount.id}`,
                                    ),
                                    countId: selectedCount.id,
                                  },
                                },
                              });
                              const error = resultError(
                                response.data?.bmsPosApplyStockCount,
                              );
                              if (!error) setSelectedCountId('');
                              return error;
                            });
                          },
                        },
                      ],
                    )
                  }
                />
                <Button
                  label={posText("ยกเลิกใบนับ")}
                  variant="danger"
                  onPress={() =>
                    run(`cancel-count-${selectedCount.id}`, async () => {
                      const response = await cancelCount({
                        variables: {
                          input: {
                            ...inputCredentials,
                            idempotencyKey: retryKey(
                              `cancel-count-${selectedCount.id}`,
                            ),
                            countId: selectedCount.id,
                          },
                        },
                      });
                      const error = resultError(
                        response.data?.bmsPosCancelStockCount,
                      );
                      if (!error) setSelectedCountId('');
                      return error;
                    })
                  }
                />
              </View>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
  const scannerModal = (
    <BarcodeScannerModal<StockScanResult>
      purpose="lookup"
      visible={scannerOpen}
      resolveCode={resolveStockCode}
      onCancel={() => setScannerOpen(false)}
      onScanned={item => {
        setLookupDraft(item.code);
        setLookupSearch(item.code);
        setLookupOffset(0);
        setScannerOpen(false);
      }}
      completedHardwareScan={null}
    />
  );

  if (!isTablet) {
    return (
      <ScreenContainer>
        <ScreenHeader
          title={posText("สต็อกสาขา")}
          subtitle={branchDisplayLabel(branchName)}
          onBack={asTabRoot ? undefined : () => navigation.goBack()}
        />
        {mode === 'OVERVIEW' ? null : phoneNavigation}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          {workContent}
        </ScrollView>
        {scannerModal}
      </ScreenContainer>
    );
  }

  const incomingCount = (transferData?.transfers ?? []).filter(
    transfer =>
      transfer.status === 'IN_TRANSIT' &&
      transfer.toLocationId === transferData?.deviceLocationId,
  ).length;
  const draftCount = (countData?.counts ?? []).filter(
    count => count.status === 'DRAFT',
  ).length;
  const sidebarModes: Array<{
    key: ViewMode | 'RECEIVE';
    glyph: string;
    label: string;
  }> = [
    { key: 'LOOKUP', glyph: '⌕', label: posText("ค้นหาสต็อก") },
    { key: 'OVERVIEW', glyph: '▦', label: posText("ภาพรวม") },
    { key: 'TRANSFER', glyph: '⇄', label: posText("โอนสินค้า") },
    { key: 'RECEIVE', glyph: '⇥', label: posText("รับสินค้า") },
    { key: 'COUNT', glyph: '▣', label: posText("นับสต็อก") },
  ];
  const tabletTitle =
    mode === 'LOOKUP'
      ? posText("ค้นหาสต็อกสาขา")
      : mode === 'OVERVIEW'
      ? posText("ภาพรวมสต็อกสาขา")
      : mode === 'TRANSFER'
      ? posText("โอนและรับสินค้า")
      : posText("นับสต็อก");
  const tabletSubtitle =
    mode === 'LOOKUP'
      ? posText("{v0} · ค้นด้วยชื่อ SKU หรือบาร์โค้ด", { v0: branchDisplayLabel(branchName) })
      : mode === 'OVERVIEW'
      ? posText("{v0} · ข้อมูลล่าสุดจากเซิร์ฟเวอร์", { v0: branchDisplayLabel(branchName) })
      : mode === 'TRANSFER'
      ? posText("ต้นทางกำหนดจากสาขาของเครื่อง · สินค้าระหว่างทางยังไม่เป็นของสาขาใด")
      : posText("ปรับด้วยผลต่างจาก snapshot แรก เพื่อไม่ทับยอดขายระหว่างนับ");

  return (
    <ScreenContainer padded={false}>
      <View style={styles.tabletShell}>
        <View
          style={[
            styles.sidebar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={{ padding: spacing.lg, gap: spacing.xs }}>
            <Text style={[typography.title, { color: colors.text }]}>
              {posText("สต็อกสาขา") + " "}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {branchDisplayLabel(branchName)}
            </Text>
          </View>

          <View style={{ paddingHorizontal: spacing.md, gap: spacing.xs }}>
            {sidebarModes.map(item => {
              const selected =
                item.key === mode ||
                (item.key === 'RECEIVE' && mode === 'TRANSFER' && receiving);
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => {
                    if (item.key === 'RECEIVE') {
                      setMode('TRANSFER');
                      return;
                    }
                    setMode(item.key);
                  }}
                  style={({ pressed }) => [
                    styles.sidebarButton,
                    {
                      backgroundColor: selected
                        ? `${colors.primary}18`
                        : pressed
                        ? colors.surface2
                        : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sidebarGlyph,
                      { color: selected ? colors.primary : colors.textMuted },
                    ]}
                  >
                    {item.glyph}
                  </Text>
                  <Text
                    style={[
                      typography.bodyStrong,
                      { color: selected ? colors.primary : colors.text },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View
            style={[styles.sidebarDivider, { borderColor: colors.border }]}
          />
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text
              style={[typography.captionStrong, { color: colors.textSoft }]}
            >
              {posText("สถานะสาขา") + " "}</Text>
            {[
              {
                label: posText("สินค้าใกล้หมด"),
                value: transferData?.summary.lowStockCount ?? 0,
                color: colors.warning,
              },
              {
                label: posText("รอรับเข้า"),
                value: incomingCount,
                color: colors.primary,
              },
              { label: posText("รอบนับค้าง"), value: draftCount, color: colors.danger },
            ].map(item => (
              <View key={item.label} style={styles.between}>
                <View style={styles.sidebarStatusLabel}>
                  <View
                    style={[styles.statusDot, { backgroundColor: item.color }]}
                  />
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {item.label}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>

          <TabletMainNavigation
            activeTab="InventoryTab"
            showBoardGame={storeMode === 'board_game_cafe'}
            onNavigate={tab => navigation.navigate('Tabs', { screen: tab })}
          />
        </View>

        <View style={[styles.tabletMain, { backgroundColor: colors.bg }]}>
          <ScreenHeader
            title={tabletTitle}
            subtitle={tabletSubtitle}
            right={
              mode === 'OVERVIEW' ? (
                <Button
                  label={posText("＋ สร้างใบโอน")}
                  onPress={() => setMode('TRANSFER')}
                />
              ) : undefined
            }
          />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              gap: spacing.lg,
              paddingBottom: spacing.xxl,
            }}
          >
            {workContent}
          </ScrollView>
        </View>
        {scannerModal}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginBottom: 4 },
  segmentButton: { flex: 1 },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  summaryCard: {
    borderRadius: 14,
    minHeight: 86,
    justifyContent: 'center',
  },
  summaryIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryGlyph: { fontSize: 17, fontWeight: '800' },
  summaryValuePhone: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  dashboardPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  dashboardColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  dashboardPrimary: { flex: 1.25, minWidth: 0 },
  dashboardSecondary: { flex: 0.75, minWidth: 0, gap: 16 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  taskIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskGlyph: { fontSize: 20, fontWeight: '800' },
  taskStatus: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  taskAction: { minWidth: 86 },
  lowStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  productMark: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productMarkText: { fontSize: 17, fontWeight: '800' },
  libraryNote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 3,
  },
  infoStrip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  errorPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tabletShell: { flex: 1, flexDirection: 'row' },
  sidebar: {
    width: TABLET_SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  sidebarButton: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  sidebarGlyph: {
    width: 26,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
  sidebarDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginVertical: 16,
  },
  sidebarStatusLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  tabletMain: { flex: 1, padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  smallInput: { width: 88 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  receiptLine: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
});
