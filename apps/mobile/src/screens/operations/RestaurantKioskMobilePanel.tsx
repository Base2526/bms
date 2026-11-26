import React, { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useLazyQuery, useMutation } from '@apollo/client';
import { Button } from '../../components/Button';
import {
  MobileRestaurantKioskAcceptDocument,
  MobileRestaurantKioskOrdersDocument,
  MobileRestaurantKioskPreviewDocument,
  MobileRestaurantKioskRejectDocument,
  type MobileRestaurantFloorQuery,
  type MobileRestaurantKioskOrdersQuery,
  type MobileRestaurantKioskPreviewMutation,
} from '../../graphql/generated';
import { posText, usePosLanguage } from '../../i18n/language';
import { useTheme } from '../../theme/ThemeProvider';

type Submission = MobileRestaurantKioskOrdersQuery['bmsPosRestaurantKioskOrders']['submissions'][number];
type Preview = MobileRestaurantKioskPreviewMutation['bmsPosRestaurantKioskPreview'];
type Floor = MobileRestaurantFloorQuery['bmsPosRestaurantFloor'];

export function RestaurantKioskMobilePanel({
  submissions, error, floor, credentials, refresh, openCheck,
}: {
  submissions: Submission[];
  error?: string | null;
  floor?: Floor;
  credentials: { cashierUserId: string; pin: string };
  refresh: () => Promise<void>;
  openCheck: (checkId: string, serviceMode: 'DINE_IN' | 'TAKEAWAY', tableId?: string) => void;
}) {
  usePosLanguage();
  const { colors, typography, minTouchTarget } = useTheme();
  const [requestCode, setRequestCode] = useState('');
  const [searchResults, setSearchResults] = useState<Submission[] | null>(null);
  const [selectedCheck, setSelectedCheck] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmedTable, setConfirmedTable] = useState(false);
  const [confirmedPrice, setConfirmedPrice] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [lookup] = useLazyQuery(MobileRestaurantKioskOrdersDocument, { fetchPolicy: 'network-only' });
  const [previewMutation] = useMutation(MobileRestaurantKioskPreviewDocument);
  const [accept] = useMutation(MobileRestaurantKioskAcceptDocument);
  const [reject] = useMutation(MobileRestaurantKioskRejectDocument);
  const shown = searchResults ?? submissions;
  const checks = (floor?.tables ?? []).flatMap(table =>
    table.checks.filter(check => check.status === 'OPEN' && check.serviceMode === 'DINE_IN')
      .map(check => ({
        id: check.id,
        tableId: table.id,
        label: `${floor?.areas.find(area => area.id === table.areaId)?.name ?? ''} · ${table.code} ${table.name} · ${posText('บิล')} ${check.splitGroupNo} · ${check.id.slice(0, 8)}`,
      })),
  );

  async function search(code: string) {
    const trimmed = code.trim();
    if (!trimmed) { setSearchResults(null); return; }
    setBusy(true);
    try {
      const result = await lookup({ variables: { requestCode: trimmed } });
      setSearchResults(result.data?.bmsPosRestaurantKioskOrders.submissions ?? []);
    } catch (cause) {
      Alert.alert(posText('ค้นหาไม่สำเร็จ'), cause instanceof Error ? cause.message : posText('กรุณาลองใหม่'));
    } finally { setBusy(false); }
  }

  function resetPreview() {
    setPreview(null);
    setConfirmedTable(false);
    setConfirmedPrice(false);
  }

  async function review(item: Submission) {
    if (item.serviceMode === 'DINE_IN' && !selectedCheck) {
      Alert.alert(posText('กรุณาเลือกบิลโต๊ะก่อนตรวจราคา'));
      return;
    }
    setBusy(true);
    resetPreview();
    try {
      const result = await previewMutation({ variables: {
        input: { ...credentials, submissionId: item.id,
          checkId: item.serviceMode === 'DINE_IN' ? selectedCheck || null : null },
      } });
      setPreview(result.data?.bmsPosRestaurantKioskPreview ?? null);
    } catch (cause) {
      Alert.alert(posText('ตรวจคำขอไม่สำเร็จ'), cause instanceof Error ? cause.message : posText('กรุณาลองใหม่'));
    } finally { setBusy(false); }
  }

  async function decide(item: Submission, action: 'accept' | 'reject') {
    if (action === 'reject' && !reason.trim()) {
      Alert.alert(posText('กรุณาระบุเหตุผลที่ปฏิเสธ'));
      return;
    }
    if (action === 'accept' && (!preview || preview.submissionId !== item.id ||
      (item.serviceMode === 'DINE_IN' && (!confirmedTable || preview.check?.id !== selectedCheck)) ||
      (preview.priceChanged && !confirmedPrice))) {
      Alert.alert(posText('ตรวจราคาล่าสุด ยืนยันโต๊ะกับลูกค้า และยืนยันราคาใหม่ก่อนรับคำขอ'));
      return;
    }
    setBusy(true);
    try {
      const acceptInput = {
        ...credentials, submissionId: item.id,
        checkId: item.serviceMode === 'DINE_IN' ? selectedCheck || null : null,
        quoteFingerprint: preview?.quote.fingerprint ?? null,
        confirmedPriceChange: confirmedPrice, confirmedTable,
        expectedCheckVersion: preview?.check?.version ?? null,
        expectedTableId: preview?.check?.tableId ?? null,
        expectedCheckOpenedAt: preview?.check?.openedAt ?? null,
      };
      if (action === 'accept') {
        const result = await accept({ variables: { input: acceptInput } });
        const outcome = result.data?.bmsPosRestaurantKioskAccept;
        if (outcome?.status !== 'ACCEPTED') throw new Error(outcome?.reason ?? outcome?.status ?? posText('รับคำขอไม่สำเร็จ'));
      } else {
        const result = await reject({ variables: { input: {
          ...credentials, submissionId: item.id, reason: reason.trim(),
        } } });
        const outcome = result.data?.bmsPosRestaurantKioskReject;
        if (outcome?.status !== 'REJECTED') throw new Error(outcome?.reason ?? outcome?.status ?? posText('ปฏิเสธไม่สำเร็จ'));
      }
      resetPreview();
      setSelectedCheck('');
      setReason('');
      await refresh().catch(() => undefined);
      if (searchResults) await search(requestCode);
    } catch (cause) {
      Alert.alert(posText('ตรวจคำขออีกครั้ง'), `${cause instanceof Error ? cause.message : posText('กรุณาลองใหม่')} ${posText('ค้นรหัสคำขอก่อนคีย์รายการใหม่หรือกดรับซ้ำ')}`);
    } finally { setBusy(false); }
  }

  const checkbox = (label: string, value: boolean, onPress: () => void) => (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }}
      onPress={onPress} style={{ minHeight: minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 22 }}>{value ? '☑' : '□'}</Text>
      <Text style={[typography.body, { color: colors.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );

  return <View style={{ gap: 14 }}>
    <Text style={[typography.body, { color: colors.text }]}>{posText('คำขอจากจอเป็นรายการรอตรวจ กดรับแล้วส่งครัวทันที รับเงินผ่าน POS รหัสคำขอไม่ใช่เลขรับอาหาร')}</Text>
    {error && <Text accessibilityRole="alert" style={[typography.bodyStrong, { color: colors.danger }]}>
      {posText('อ่านคำขอจากจอไม่ได้ ข้อมูลที่เห็นอาจเก่า กรุณารีเฟรชและตรวจรหัสก่อนคีย์ใหม่')}: {error}
    </Text>}
    <TextInput accessibilityLabel={posText('รหัสคำขอที่ลูกค้าเห็น')} value={requestCode}
      onChangeText={setRequestCode} placeholder={posText('ค้นรหัสคำขออย่างน้อย 8 ตัว')}
      autoCapitalize="none" style={{ minHeight: minTouchTarget, borderWidth: 1, borderColor: colors.border, color: colors.text, padding: 10 }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button label={posText('ค้นหาคำขอ')} disabled={busy} onPress={() => search(requestCode)} />
      <Button label={posText('แสดงล่าสุด')} variant="secondary" disabled={busy} onPress={() => { setSearchResults(null); setRequestCode(''); }} />
      <Button label={posText('รีเฟรช')} variant="secondary" disabled={busy} onPress={() => refresh().catch(cause =>
        Alert.alert(posText('รีเฟรชไม่สำเร็จ'), cause instanceof Error ? cause.message : posText('กรุณาลองใหม่')))} />
    </View>
    {shown.length === 0 && !error && <Text style={{ color: colors.text }}>{searchResults ? posText('ไม่พบรหัสคำขอในสาขานี้') : posText('ไม่มีคำขอจากจอ')}</Text>}
    {shown.map(item => <View key={item.id} style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
      <Text style={[typography.bodyStrong, { color: colors.text }]}>{item.id.slice(0, 8).toUpperCase()} · {item.serviceMode} · {item.status}</Text>
      <Text selectable style={{ color: colors.text }}>{item.id}</Text>
      {item.items.map((line, index) => <Text key={`${line.sku}:${index}`} style={{ color: colors.text }}>
        {line.packQty} × {line.productName}{line.size ? ` · ${line.size}` : ''}{line.modifierCodes.length ? ` · ${line.modifierCodes.join(', ')}` : ''}{line.kitchenNote ? ` · ${line.kitchenNote}` : ''}
      </Text>)}
      {item.checkId && <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text }}>{posText('รหัสคำขอ')} {item.id.slice(0, 8).toUpperCase()} → {posText('บิล POS')} {item.checkId.slice(0, 8).toUpperCase()} · {item.checkStatus}</Text>
        {item.tableCode && <Text style={{ color: colors.text }}>{item.areaName} · {item.tableCode} {item.tableName} · {posText('บิล')} {item.splitGroupNo}</Text>}
        <Button label={posText('เปิดบิลที่ผูก')} variant="secondary" onPress={() => openCheck(item.checkId!, item.serviceMode as 'DINE_IN' | 'TAKEAWAY',
          item.serviceMode === 'DINE_IN' ? checks.find(check => check.id === item.checkId)?.tableId : undefined)} />
      </View>}
      {item.status === 'PENDING' && <View style={{ gap: 8 }}>
        {item.serviceMode === 'DINE_IN' && <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text }}>{posText('เลือกโต๊ะและบิลที่ลูกค้าอยู่จริง')}</Text>
          {checks.map(check => <Pressable key={check.id} accessibilityRole="radio" accessibilityState={{ selected: selectedCheck === check.id }}
            onPress={() => { setSelectedCheck(check.id); resetPreview(); }}
            style={{ minHeight: minTouchTarget, padding: 8, borderWidth: 1, borderColor: selectedCheck === check.id ? colors.primary : colors.border }}>
            <Text style={{ color: colors.text }}>{selectedCheck === check.id ? '● ' : '○ '}{check.label}</Text>
          </Pressable>)}
        </View>}
        <Button label={posText('ตรวจราคาและบิลล่าสุด')} disabled={busy} onPress={() => review(item)} />
        {preview?.submissionId === item.id && <View style={{ gap: 7, padding: 10, backgroundColor: colors.surface2 }}>
          <Text style={[typography.bodyStrong, { color: colors.text }]}>{posText('ยอดก่อน VAT โปรโมชัน และส่วนลด')} ฿{preview.quote.total.toFixed(2)}</Text>
          {preview.quote.lines.map((line, index) => <Text key={`${line.sku}:${index}`} style={{ color: colors.text }}>
            {line.packQty} × {line.productName} · {line.size} · {line.modifiers.map(option => option.name).join(', ')} · ฿{line.lineAmount.toFixed(2)}
            {'\n'}{posText('ตอนลูกค้าส่ง')} ฿{Number(preview.submittedLines?.[index]?.lineAmount ?? 0).toFixed(2)}
          </Text>)}
          {preview.priceChanged && checkbox(posText('ยืนยันเมนู ตัวเลือก หรือราคาใหม่กับลูกค้าแล้ว'), confirmedPrice, () => setConfirmedPrice(!confirmedPrice))}
          {preview.check && <>
            <Text style={{ color: colors.text }}>{preview.check.areaName} · {preview.check.tableCode} {preview.check.tableName} · {posText('บิล')} {preview.check.splitGroupNo} · {preview.check.id.slice(0, 8)}</Text>
            {checkbox(posText('ยืนยันว่าลูกค้าอยู่โต๊ะและบิลนี้จริง'), confirmedTable, () => setConfirmedTable(!confirmedTable))}
          </>}
        </View>}
        <TextInput accessibilityLabel={posText('เหตุผลที่ปฏิเสธ')} value={reason} onChangeText={setReason}
          placeholder={posText('เหตุผลที่ปฏิเสธ')} maxLength={300}
          style={{ minHeight: minTouchTarget, borderWidth: 1, borderColor: colors.border, color: colors.text, padding: 10 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button label={posText('รับและส่งครัว')} disabled={busy} onPress={() => decide(item, 'accept')} />
          <Button label={posText('ปฏิเสธ')} variant="danger" disabled={busy} onPress={() => decide(item, 'reject')} />
        </View>
      </View>}
    </View>)}
  </View>;
}
