import { posText, usePosLanguage, posLocale } from '../../i18n/language';
import React, { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@apollo/client';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import {
  TABLET_SIDEBAR_WIDTH,
  TabletMainNavigation,
} from '../../components/TabletMainNavigation';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { AppColors } from '../../theme/colors';
import { typography as typographyTokens } from '../../theme/typography';
import { useShift } from '../../state/ShiftContext';
import { useSession } from '../../state/SessionContext';
import { useStoreMode } from '../../state/StoreModeContext';
import { PosBootstrapDocument } from '../../graphql/generated';
import type { CashMovementType } from '../../lib/shiftMath';
import { createIdempotencyKey } from '../../lib/operation';
import { useRootNavigationActions } from '../../navigation/RootNavigationActions';
import type { ShiftStackParamList } from '../../navigation/types';
import { getAppNavigation } from '../../navigation/parentNavigation';

// ทุกยอดบนหน้านี้มาจาก shift report ของ server เพื่อให้ยอดขาย คืนเงิน และลิ้นชักตรงกัน
type Props = { onBack?: () => void };
type ShiftSection = 'OVERVIEW' | 'MOVEMENTS' | 'HISTORY';

export default function ShiftScreen({ onBack }: Props) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const shift = useShift();
  const { session, signOut } = useSession();
  const { mode } = useStoreMode();
  const navigation =
    useNavigation<NativeStackNavigationProp<ShiftStackParamList>>();
  const { openSettings, resetToLogin } = useRootNavigationActions();
  const bootstrap = useQuery(PosBootstrapDocument);
  const approvers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver =>
      approver.id !== session?.cashier.id &&
      approver.approvals.includes('pos.cash.movement'),
  );

  const [movementType, setMovementType] = useState<CashMovementType | null>(
    null,
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [opening, setOpening] = useState(false);
  const [openingFloat, setOpeningFloat] = useState('');
  const [error, setError] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [movementKey, setMovementKey] = useState('');
  const movementInFlight = useRef(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [section, setSection] = useState<ShiftSection>('OVERVIEW');

  const closeMovement = () => {
    if (movementInFlight.current) return;
    setMovementType(null);
    setAmount('');
    setReason('');
    setApproverId('');
    setApproverPin('');
    setMovementKey('');
    setError('');
  };

  const submitMovement = async () => {
    if (!movementType || movementInFlight.current) return;
    movementInFlight.current = true;
    setSavingMovement(true);
    try {
      const failure = await shift.addMovement(
        movementType,
        amount,
        reason,
        {
          approverUserId: approverId || undefined,
          approverPin: approverPin || undefined,
        },
        movementKey,
      );
      if (failure) {
        setError(failure);
        return;
      }
      movementInFlight.current = false;
      closeMovement();
    } finally {
      movementInFlight.current = false;
      setSavingMovement(false);
    }
  };

  const submitClose = async () => {
    const failure = await shift.closeShift(countedCash);
    if (failure) {
      setError(failure);
      return;
    }
    setClosing(false);
    setCountedCash('');
    setError('');
  };

  const submitOpen = async () => {
    if (!openingFloat.trim()) {
      setError(posText("กรุณากรอกเงินทอนตั้งต้น หรือ 0 หากไม่มีเงินทอน"));
      return;
    }
    const failure = await shift.reopenShift(Number(openingFloat));
    if (failure) {
      setError(failure);
      return;
    }
    setOpening(false);
    setOpeningFloat('');
    setError('');
  };

  const branchName = session?.branch.name ?? posText("ไม่พบสาขา");
  const branchLabel = branchName.replace(/^BOOM\s+/, 'BOOM · ');
  const expectedCashLabel = shift.expectedCashHidden
    ? posText("ซ่อนจนปิดกะ")
    : shift.expectedCash == null
    ? posText("รอข้อมูล")
    : formatBaht(shift.expectedCash);
  const summaryItems = [
    {
      label: posText("สถานะกะ"),
      value: shift.isOpen ? posText("เปิดอยู่") : posText("ปิดแล้ว"),
      note: shift.isOpen
        ? posText("เปิดเมื่อ {v0}", { v0: formatShiftTime(shift.openedAt) })
        : posText("พร้อมเปิดกะใหม่"),
      glyph: shift.isOpen ? '●' : '×',
      ink: shift.isOpen ? colors.success : colors.danger,
      background: shift.isOpen ? colors.successBg : colors.dangerBg,
    },
    {
      label: posText("เงินทอนตั้งต้น"),
      value: formatBaht(shift.openingFloat),
      note: posText("ผู้เปิดกะ {v0}", { v0: shift.openedByName }),
      glyph: '▰',
      ink: colors.success,
      background: colors.successBg,
    },
    {
      label: posText("ยอดขายเงินสด"),
      value: formatBaht(shift.cashSales),
      note: posText("ยอดขายของกะนี้"),
      glyph: '▤',
      ink: colors.primary,
      background: `${colors.primary}0e`,
    },
    {
      label: posText("เงินที่ควรมี"),
      value: expectedCashLabel,
      note: shift.expectedCashHidden ? posText("โหมดนับปิดตา") : posText("ยอดในลิ้นชัก"),
      glyph: '▦',
      ink: colors.primary,
      background: `${colors.primary}0e`,
    },
  ];

  const sectionNavigation = (
    <View style={[styles.sectionTabs, { borderColor: colors.border }]}>
      <SectionTab
        label={posText("ภาพรวม")}
        selected={section === 'OVERVIEW'}
        onPress={() => setSection('OVERVIEW')}
      />
      <SectionTab
        label={posText("เงินเข้าออก")}
        selected={section === 'MOVEMENTS'}
        onPress={() => setSection('MOVEMENTS')}
      />
      <SectionTab
        label={posText("ประวัติกะ")}
        selected={section === 'HISTORY'}
        onPress={() => setSection('HISTORY')}
      />
    </View>
  );

  const movementList = shift.movements.length ? (
    <View style={styles.movementList}>
      {shift.movements.map(item => (
        <View
          key={item.id}
          style={[styles.movementRow, { borderColor: colors.border }]}
        >
          <View
            style={[
              styles.movementIcon,
              {
                backgroundColor:
                  item.type === 'IN' ? colors.successBg : colors.dangerBg,
              },
            ]}
          >
            <Text
              style={[
                styles.movementGlyph,
                {
                  color: item.type === 'IN' ? colors.success : colors.danger,
                },
              ]}
            >
              {item.type === 'IN' ? '↓' : '↑'}
            </Text>
          </View>
          <View style={styles.movementText}>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              {item.reason}
            </Text>
            <Text style={[typography.caption, { color: colors.textSoft }]}>
              {item.at}
              {item.actorName ? ` · ${item.actorName}` : ''}
            </Text>
          </View>
          <StatusPill
            label={
              item.type === 'IN'
                ? `+${formatBaht(item.amount)}`
                : `−${formatBaht(item.amount)}`
            }
            tone={item.type === 'IN' ? 'success' : 'danger'}
          />
        </View>
      ))}
    </View>
  ) : (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
        <Text style={[styles.emptyIconText, { color: colors.textMuted }]}>
          ≡
        </Text>
      </View>
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        {posText("ยังไม่มีรายการเงินเข้า/ออก") + " "}</Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textMuted, textAlign: 'center' },
        ]}
      >
        {posText("รายการที่บันทึกระหว่างกะจะแสดงที่นี่") + " "}</Text>
    </View>
  );

  const closeSummary = shift.closeSummary;
  const reconciliationCard = (
    <Card style={styles.primaryPanel}>
      <PanelHeading glyph="▤" title={posText("สรุปการปิดกะ")} />
      {closeSummary ? (
        <>
          <View
            style={[styles.reconciliationRows, { borderColor: colors.border }]}
          >
            <Row
              label={posText("นับได้จริง")}
              value={formatBaht(closeSummary.countedCash)}
              colors={colors}
              strong
            />
            <Row
              label={posText("ควรมี")}
              value={formatBaht(closeSummary.expectedCash)}
              colors={colors}
              strong
            />
            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />
            <View style={styles.varianceRow}>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                {posText("ผลต่าง") + " "}</Text>
              <StatusPill
                label={varianceLabel(closeSummary.variance)}
                tone={closeSummary.variance === 0 ? 'success' : 'danger'}
              />
            </View>
          </View>
          <View
            style={[
              styles.reconciliationResult,
              {
                backgroundColor:
                  closeSummary.variance === 0
                    ? colors.successBg
                    : colors.dangerBg,
              },
            ]}
          >
            <View
              style={[
                styles.resultIcon,
                {
                  backgroundColor:
                    closeSummary.variance === 0
                      ? colors.success
                      : colors.danger,
                },
              ]}
            >
              <Text style={styles.resultIconText}>
                {closeSummary.variance === 0 ? '✓' : '!'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  typography.bodyStrong,
                  {
                    color:
                      closeSummary.variance === 0
                        ? colors.success
                        : colors.danger,
                  },
                ]}
              >
                {closeSummary.variance === 0
                  ? posText("ยอดเงินตรงกัน")
                  : posText("ยอดเงินมีผลต่าง")}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("ปิดกะเมื่อ") + " "}{formatShiftTime(closeSummary.closedAt)}
              </Text>
            </View>
          </View>
        </>
      ) : (
        <>
          <View
            style={[styles.reconciliationRows, { borderColor: colors.border }]}
          >
            <Row
              label={posText("เปิดกะเมื่อ")}
              value={formatShiftTime(shift.openedAt)}
              colors={colors}
            />
            <Row label={posText("ผู้เปิดกะ")} value={shift.openedByName} colors={colors} />
            <Row
              label={posText("เงินที่ควรมี")}
              value={expectedCashLabel}
              colors={colors}
              strong
            />
          </View>
          <View
            style={[
              styles.reconciliationResult,
              { backgroundColor: `${colors.primary}0e` },
            ]}
          >
            <View
              style={[styles.resultIcon, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.resultIconText}>●</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.primary }]}>
                {posText("กะกำลังเปิดอยู่") + " "}</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("ปิดกะแล้วผลต่างจะแสดงในส่วนนี้") + " "}</Text>
            </View>
          </View>
        </>
      )}
    </Card>
  );

  const cashDetailCard = (
    <Card style={styles.detailPanel}>
      <PanelHeading glyph={posText("฿")} title={posText("รายละเอียดเงินสด")} />
      <Row
        label={posText("เงินทอนตั้งต้น")}
        value={formatBaht(shift.openingFloat)}
        colors={colors}
      />
      <Row
        label={posText("ยอดขายเงินสด")}
        value={formatBaht(shift.cashSales)}
        colors={colors}
      />
      {shift.cashRefunds > 0 ? (
        <Row
          label={posText("คืนเงินสด")}
          value={`−${formatBaht(shift.cashRefunds)}`}
          colors={colors}
        />
      ) : null}
      {shift.movementIn > 0 ? (
        <Row
          label={posText("เงินเข้าลิ้นชัก")}
          value={`+${formatBaht(shift.movementIn)}`}
          colors={colors}
        />
      ) : null}
      {shift.movementOut > 0 ? (
        <Row
          label={posText("เงินออกจากลิ้นชัก")}
          value={`−${formatBaht(shift.movementOut)}`}
          colors={colors}
        />
      ) : null}
      {shift.roundingTotal !== 0 ? (
        <Row
          label={posText("ปัดเศษเงินสด")}
          value={`${shift.roundingTotal < 0 ? '−' : '+'}${formatBaht(
            Math.abs(shift.roundingTotal),
          )}`}
          colors={colors}
        />
      ) : null}
      <Text style={[typography.caption, { color: colors.textSoft }]}>
        {posText("นับเฉพาะเงินสด — QR/บัตร และการคืนที่ยังรอยืนยันไม่อยู่ในลิ้นชัก") + " "}</Text>
    </Card>
  );

  const movementsCard = (
    <Card
      style={
        isTablet
          ? { ...styles.secondaryPanel, ...styles.secondaryPanelTablet }
          : styles.secondaryPanel
      }
    >
      <PanelHeading glyph="↕" title={posText("รายการเงินเข้า/ออก")} />
      {movementList}
      <View style={styles.movementButtons}>
        <Button
          label={posText("＋ บันทึกเงินเข้า")}
          accessibilityLabel={posText("บันทึกเงินเข้าลิ้นชัก")}
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!shift.isOpen}
          onPress={() => {
            setError('');
            setMovementType('IN');
            setMovementKey(createIdempotencyKey('cash'));
          }}
        />
        <Button
          label={posText("− บันทึกเงินออก")}
          accessibilityLabel={posText("บันทึกเงินออกจากลิ้นชัก")}
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!shift.isOpen}
          onPress={() => {
            setError('');
            setMovementType('OUT');
            setMovementKey(createIdempotencyKey('cash'));
          }}
        />
      </View>
    </Card>
  );

  const historyCard = (
    <Card style={styles.historyPanel}>
      <PanelHeading glyph="◷" title={posText("ประวัติกะล่าสุด")} />
      {closeSummary ? (
        <View style={[styles.historyItem, { borderColor: colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              {posText("ปิดกะแล้ว ·") + " "}{formatShiftTime(closeSummary.closedAt)}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {posText("นับได้") + " "}{formatBaht(closeSummary.countedCash)} {" " + posText("· ควรมี")}{' '}
              {formatBaht(closeSummary.expectedCash)}
            </Text>
          </View>
          <StatusPill
            label={varianceLabel(closeSummary.variance)}
            tone={closeSummary.variance === 0 ? 'success' : 'danger'}
          />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyIconText, { color: colors.textMuted }]}>
            ◷
          </Text>
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            {posText("ยังไม่มีประวัติปิดกะ") + " "}</Text>
        </View>
      )}
    </Card>
  );

  const actions = (
    <View style={styles.actions}>
      {!shift.isOpen ? (
        <Button
          label={posText("▶  เปิดกะใหม่")}
          accessibilityLabel={posText("เปิดกะใหม่")}
          fullWidth
          onPress={() => {
            setError('');
            setOpeningFloat(
              shift.closeSummary?.countedCash.toFixed(2) ?? '0.00',
            );
            setOpening(true);
          }}
        />
      ) : (
        <Button
          label={posText("ปิดกะ")}
          accessibilityLabel={posText("ปิดกะและนับเงินในลิ้นชัก")}
          variant="danger"
          fullWidth
          onPress={() => {
            setError('');
            setCountedCash('');
            setClosing(true);
          }}
        />
      )}
      <View style={styles.secondaryActions}>
        <Button
          label={posText("⚙  ตั้งค่าเครื่อง")}
          variant="secondary"
          style={{ flex: 1 }}
          onPress={openSettings}
        />
        <Button
          label={posText("♙  เปลี่ยนผู้ปฏิบัติงาน")}
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            signOut();
            resetToLogin();
          }}
        />
      </View>
    </View>
  );

  const summaryGrid = (
    <View style={[styles.summaryGrid, isTablet && styles.summaryGridTablet]}>
      {summaryItems.map(item => (
        <View
          key={item.label}
          style={[
            styles.summaryCard,
            isTablet && styles.summaryCardTablet,
            { backgroundColor: item.background, borderColor: `${item.ink}20` },
          ]}
        >
          <View
            style={[styles.summaryIcon, { backgroundColor: `${item.ink}16` }]}
          >
            <Text style={[styles.summaryGlyph, { color: item.ink }]}>
              {item.glyph}
            </Text>
          </View>
          <View style={styles.summaryText}>
            <Text
              style={[typography.captionStrong, { color: colors.textMuted }]}
            >
              {item.label}
            </Text>
            <Text
              style={[
                styles.summaryValue,
                { color: item.label === posText("สถานะกะ") ? item.ink : colors.text },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {item.value}
            </Text>
            <Text
              style={[styles.summaryNote, { color: colors.textSoft }]}
              numberOfLines={1}
            >
              {item.note}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );

  const sectionContent =
    section === 'OVERVIEW' ? (
      <View
        style={[styles.dashboardColumns, !isTablet && styles.dashboardStack]}
      >
        <View style={styles.dashboardPrimaryColumn}>{reconciliationCard}</View>
        <View style={styles.dashboardSecondaryColumn}>{movementsCard}</View>
      </View>
    ) : section === 'MOVEMENTS' ? (
      movementsCard
    ) : (
      <View style={styles.historyStack}>
        {historyCard}
        {cashDetailCard}
      </View>
    );

  const pageHeader = onBack ? (
    <ScreenHeader
      title={posText("กะและลิ้นชัก")}
      subtitle={branchLabel}
      onBack={onBack}
      right={
        <Button
          label={posText("↻ รีเฟรช")}
          variant="secondary"
          loading={shift.loading}
          onPress={shift.refresh}
        />
      }
    />
  ) : (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            isTablet ? typography.displayLg : styles.phoneTitle,
            { color: colors.text },
          ]}
        >
          {isTablet ? posText("ภาพรวมกะและลิ้นชัก") : posText("กะและลิ้นชัก")}
        </Text>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {isTablet
            ? `${branchLabel} · ${new Date().toLocaleString(posLocale(), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}`
            : branchLabel}
        </Text>
      </View>
      <Button
        label={posText("↻ รีเฟรช")}
        variant="secondary"
        loading={shift.loading}
        onPress={shift.refresh}
      />
    </View>
  );

  const pageContent = (
    <View style={styles.pageContent}>
      {pageHeader}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.pageScrollContent}
      >
        {summaryGrid}
        {!isTablet ? sectionNavigation : null}
        {sectionContent}
        {actions}
      </ScrollView>
    </View>
  );

  const showTabletShell = isTablet && !onBack;

  return (
    <ScreenContainer padded={!showTabletShell}>
      {showTabletShell ? (
        <View style={styles.tabletShell}>
          <View
            style={[
              styles.tabletSidebar,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.sidebarHeader}>
              <View
                style={[
                  styles.sidebarBrandIcon,
                  { backgroundColor: `${colors.primary}18` },
                ]}
              >
                <Text
                  style={[styles.sidebarBrandGlyph, { color: colors.primary }]}
                >
                  ▰
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.title, { color: colors.text }]}>
                  {posText("กะและลิ้นชัก") + " "}</Text>
                <Text style={[typography.body, { color: colors.textMuted }]}>
                  {branchLabel}
                </Text>
              </View>
            </View>

            <View style={styles.sidebarSections}>
              <SidebarSectionButton
                glyph="▣"
                label={posText("ภาพรวมกะ")}
                selected={section === 'OVERVIEW'}
                onPress={() => setSection('OVERVIEW')}
              />
              <SidebarSectionButton
                glyph="↕"
                label={posText("เงินเข้า/ออก")}
                selected={section === 'MOVEMENTS'}
                onPress={() => setSection('MOVEMENTS')}
              />
              <SidebarSectionButton
                glyph="◷"
                label={posText("ประวัติกะ")}
                selected={section === 'HISTORY'}
                onPress={() => setSection('HISTORY')}
              />
            </View>

            <View
              style={[styles.sidebarDivider, { borderColor: colors.border }]}
            />
            <View style={styles.sidebarStatus}>
              <Text
                style={[typography.captionStrong, { color: colors.textSoft }]}
              >
                {posText("สถานะปัจจุบัน") + " "}</Text>
              <View
                style={[
                  styles.sidebarStatusCard,
                  {
                    backgroundColor: shift.isOpen
                      ? colors.successBg
                      : colors.dangerBg,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: shift.isOpen
                        ? colors.success
                        : colors.danger,
                    },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      typography.bodyStrong,
                      {
                        color: shift.isOpen ? colors.success : colors.danger,
                      },
                    ]}
                  >
                    {shift.isOpen ? posText("เปิดอยู่") : posText("ปิดแล้ว")}
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {shift.isOpen
                      ? formatShiftTime(shift.openedAt)
                      : formatShiftTime(closeSummary?.closedAt ?? '-')}
                  </Text>
                </View>
              </View>
            </View>

            <TabletMainNavigation
              activeTab="ShiftTab"
              showBoardGame={mode === 'board_game_cafe'}
              onNavigate={tab =>
                getAppNavigation(navigation).navigate('Tabs', { screen: tab })
              }
            />
          </View>
          <View style={[styles.tabletMain, { backgroundColor: colors.bg }]}>
            {pageContent}
          </View>
        </View>
      ) : (
        pageContent
      )}

      <Modal
        transparent
        visible={movementType !== null}
        animationType="fade"
        onRequestClose={closeMovement}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMovement} />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {movementType === 'IN'
                  ? posText("เงินเข้าลิ้นชัก")
                  : posText("เงินออกจากลิ้นชัก")}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("รายการจะบันทึกในลิ้นชักของกะปัจจุบันบนเซิร์ฟเวอร์") + " "}</Text>
              <TextInput
                accessibilityLabel={posText("จำนวนเงิน")}
                editable={!savingMovement}
                value={amount}
                onChangeText={setAmount}
                placeholder={posText("จำนวนเงิน")}
                placeholderTextColor={colors.textSoft}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {movementType === 'OUT' ? (
                <>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted },
                    ]}
                  >
                    {posText("ผู้อนุมัติคนที่สอง") + " "}</Text>
                  <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                    {approvers.map(approver => (
                      <Button
                        key={approver.id}
                        label={`${approver.name ?? approver.id}${
                          approver.hasPin ? '' : posText(" · ยังไม่ได้ตั้ง PIN")
                        }`}
                        variant={
                          approverId === approver.id ? 'primary' : 'secondary'
                        }
                        fullWidth
                        disabled={!approver.hasPin || savingMovement}
                        onPress={() => setApproverId(approver.id)}
                      />
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel={posText("PIN ผู้อนุมัติเงินออก")}
                    editable={!savingMovement}
                    value={approverPin}
                    onChangeText={setApproverPin}
                    placeholder={posText("PIN ผู้อนุมัติ")}
                    placeholderTextColor={colors.textSoft}
                    keyboardType="number-pad"
                    secureTextEntry
                    style={[
                      styles.input,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                  />
                </>
              ) : null}
              <TextInput
                accessibilityLabel={posText("เหตุผล")}
                editable={!savingMovement}
                value={reason}
                onChangeText={setReason}
                placeholder={posText("เหตุผล เช่น เติมเงินทอน / ซื้อวัตถุดิบ")}
                placeholderTextColor={colors.textSoft}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {error ? (
                <Text
                  style={[typography.captionStrong, { color: colors.danger }]}
                >
                  {error}
                </Text>
              ) : null}
              <Button
                label={posText("บันทึก")}
                accessibilityLabel={posText("บันทึกรายการเงินเข้า/ออก")}
                loading={savingMovement}
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={submitMovement}
              />
              <Button
                label={posText("ยกเลิก")}
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={closeMovement}
                disabled={savingMovement}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={closing}
        animationType="fade"
        onRequestClose={() => setClosing(false)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setClosing(false)}
          />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {posText("ปิดกะ") + " "}</Text>
              {/* ไม่บอก "ควรมีเท่าไร" ก่อนนับ — การนับแบบเห็นคำตอบก่อนไม่ใช่การนับ
                  (ฝั่งเว็บมีโหมดนับปิดตาด้วยเหตุผลเดียวกัน) */}
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {posText("นับเงินในลิ้นชักแล้วกรอกยอดจริง ผลต่างจะแสดงหลังยืนยัน") + " "}</Text>
              <TextInput
                accessibilityLabel={posText("เงินสดที่นับได้")}
                value={countedCash}
                onChangeText={setCountedCash}
                placeholder={posText("เงินสดที่นับได้")}
                placeholderTextColor={colors.textSoft}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {error ? (
                <Text
                  style={[typography.captionStrong, { color: colors.danger }]}
                >
                  {error}
                </Text>
              ) : null}
              <Button
                label={posText("ยืนยันปิดกะ")}
                accessibilityLabel={posText("ยืนยันปิดกะ")}
                variant="danger"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={submitClose}
              />
              <Button
                label={posText("ยกเลิก")}
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => setClosing(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={opening}
        animationType="fade"
        onRequestClose={() => setOpening(false)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpening(false)}
          />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {posText("เปิดกะ") + " "}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {posText("ตรวจนับเงินทอนตั้งต้นก่อนเริ่มรับชำระ") + " "}</Text>
            <TextInput
              accessibilityLabel={posText("เงินทอนตั้งต้น")}
              value={openingFloat}
              onChangeText={setOpeningFloat}
              placeholder={posText("เงินทอนตั้งต้น")}
              placeholderTextColor={colors.textSoft}
              keyboardType="decimal-pad"
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text },
              ]}
            />
            {error ? (
              <Text
                style={[typography.captionStrong, { color: colors.danger }]}
              >
                {error}
              </Text>
            ) : null}
            <Button
              label={posText("ยืนยันเปิดกะ")}
              fullWidth
              style={{ marginTop: spacing.md }}
              onPress={submitOpen}
            />
            <Button
              label={posText("ยกเลิก")}
              variant="secondary"
              fullWidth
              style={{ marginTop: spacing.sm }}
              onPress={() => setOpening(false)}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function formatBaht(value: number) {
  return posText("฿{v0}", { v0: value.toLocaleString('th-TH', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }) });
}

function formatShiftTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString(posLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function varianceLabel(variance: number) {
  if (variance === 0) return posText("ตรงพอดี");
  return variance > 0
    ? posText("เกิน {v0}", { v0: formatBaht(variance) })
    : posText("ขาด {v0}", { v0: formatBaht(Math.abs(variance)) });
}

function PanelHeading({ glyph, title }: { glyph: string; title: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.panelHeading}>
      <View
        style={[
          styles.panelHeadingIcon,
          { backgroundColor: `${colors.primary}14` },
        ]}
      >
        <Text style={[styles.panelHeadingGlyph, { color: colors.primary }]}>
          {glyph}
        </Text>
      </View>
      <Text style={[typography.subtitle, { color: colors.text, flex: 1 }]}>
        {title}
      </Text>
    </View>
  );
}

function SectionTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionTab,
        {
          backgroundColor: selected
            ? colors.primary
            : pressed
            ? colors.surface3
            : colors.surface2,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        style={[
          typography.bodyStrong,
          { color: selected ? colors.primaryText : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SidebarSectionButton({
  glyph,
  label,
  selected,
  onPress,
}: {
  glyph: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
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
          styles.sidebarButtonGlyph,
          { color: selected ? colors.primary : colors.textMuted },
        ]}
      >
        {glyph}
      </Text>
      <Text
        style={[
          typography.bodyStrong,
          { color: selected ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  value,
  colors,
  strong,
}: {
  label: string;
  value: string;
  colors: AppColors;
  strong?: boolean;
}) {
  return (
    <View style={styles.dataRow}>
      <Text
        style={[typographyTokens.body, { color: colors.textMuted, flex: 1 }]}
      >
        {label}
      </Text>
      <Text
        style={[
          strong ? typographyTokens.bodyStrong : typographyTokens.body,
          { color: colors.text, flex: 1.2, textAlign: 'right' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageContent: { flex: 1, minWidth: 0 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  phoneTitle: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  pageScrollContent: { gap: 16, paddingBottom: 28 },
  tabletShell: { flex: 1, flexDirection: 'row' },
  tabletSidebar: {
    width: TABLET_SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  tabletMain: { flex: 1, minWidth: 0, padding: 24 },
  sidebarHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sidebarBrandIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBrandGlyph: { fontSize: 22, fontWeight: '700' },
  sidebarSections: { paddingHorizontal: 12, gap: 3 },
  sidebarButton: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sidebarButtonGlyph: {
    width: 24,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
  sidebarDivider: {
    marginHorizontal: 16,
    marginVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sidebarStatus: { paddingHorizontal: 16, gap: 10 },
  sidebarStatusCard: {
    minHeight: 92,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryGridTablet: { flexWrap: 'nowrap', gap: 16 },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 106,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  summaryCardTablet: {
    flex: 1,
    flexBasis: 0,
    minHeight: 132,
    padding: 16,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  summaryText: { flex: 1, minWidth: 0, gap: 2 },
  summaryValue: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryNote: { fontSize: 9, lineHeight: 12, fontWeight: '400' },
  sectionTabs: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionTab: {
    minHeight: 44,
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dashboardColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  dashboardStack: { flexDirection: 'column' },
  dashboardPrimaryColumn: { flex: 1.65, width: '100%', gap: 16 },
  dashboardSecondaryColumn: { flex: 0.95, width: '100%' },
  primaryPanel: { gap: 14 },
  detailPanel: { gap: 6 },
  secondaryPanel: { gap: 14, minHeight: 210 },
  secondaryPanelTablet: { minHeight: 330 },
  historyPanel: { gap: 14, minHeight: 230 },
  historyStack: { gap: 16 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelHeadingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelHeadingGlyph: { fontSize: 18, fontWeight: '700' },
  reconciliationRows: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  reconciliationResult: {
    minHeight: 86,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIconText: { color: '#ffffff', fontSize: 24, fontWeight: '700' },
  movementList: { gap: 8 },
  movementRow: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  movementIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  movementGlyph: { fontSize: 20, fontWeight: '700' },
  movementText: { flex: 1, minWidth: 0 },
  movementButtons: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  emptyState: {
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconText: { fontSize: 28, lineHeight: 32, fontWeight: '700' },
  historyItem: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actions: { gap: 10 },
  secondaryActions: { flexDirection: 'row', gap: 10 },
  dataRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  varianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '82%',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginVertical: 12,
  },
});
