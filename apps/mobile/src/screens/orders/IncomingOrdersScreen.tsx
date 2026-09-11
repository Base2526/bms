import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import { OrderAlertSettingsModal } from '../../components/OrderAlertSettingsModal';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useIncomingOrders } from '../../state/IncomingOrdersContext';
import { useKitchen } from '../../state/KitchenContext';
import { useOrderAlerts } from '../../state/OrderAlertContext';
import { describeAgo } from '../../lib/orderAlert';
import {
  INCOMING_CHANNEL_LABEL,
  incomingOrderTotal,
  type MockIncomingOrder,
} from '../../mocks/incomingOrders';

// คิวออร์เดอร์เข้า — ข้อเสนอจากแชท/ออนไลน์/QR ที่โต๊ะ
// ⚠️ "รับออร์เดอร์" เป็นการกดของคนเสมอ ไม่ใช่ผลพลอยได้ของอย่างอื่น (กฎเดียวกับฝั่งเว็บ)
export default function IncomingOrdersScreen() {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { orders, pending, simulateArrival, acceptOrder, rejectOrder } =
    useIncomingOrders();
  const { enqueueRound } = useKitchen();
  const { settings, soundAvailable, acknowledge } = useOrderAlerts();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<MockIncomingOrder | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const onAccept = (order: MockIncomingOrder) => {
    const accepted = acceptOrder(order.id);
    if (!accepted) return;
    acknowledge();
    // รับแล้วงานถึงจะเข้าครัว — ตั๋วแตกตามสถานีด้วยเส้นทางเดียวกับการส่งครัวจากบิลโต๊ะ
    const ticketCount = enqueueRound(
      order.tableCode ?? INCOMING_CHANNEL_LABEL[order.channel],
      order.lines.map(line => ({
        sku: line.sku,
        name: line.name,
        qty: line.qty,
      })),
    );
    Alert.alert(
      'รับออร์เดอร์แล้ว',
      `ส่งเข้าครัว ${ticketCount} ตั๋ว · ${order.customerName}`,
    );
  };

  const submitReject = () => {
    if (!rejectTarget) return;
    const failure = rejectOrder(rejectTarget.id, rejectReason);
    if (failure) {
      setRejectError(failure);
      return;
    }
    setRejectTarget(null);
    setRejectReason('');
    setRejectError('');
  };

  const header = (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.title, { color: colors.text }]}>
            ออร์เดอร์เข้า
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            รอรับ {pending.length} ใบ · ทั้งหมด {orders.length} ใบในรอบนี้
          </Text>
        </View>
        <Button
          label={settings.enabled ? '🔔 แจ้งเตือน' : '🔕 ปิดอยู่'}
          accessibilityLabel="ตั้งค่าการแจ้งเตือนออร์เดอร์เข้า"
          variant="secondary"
          onPress={() => setSettingsOpen(true)}
        />
      </View>

      {/* ⚠️ ปุ่มจำลองมีเพราะยังไม่มี backend — ออร์เดอร์จริงเข้ามาเองไม่ได้
          ตอนต่อ subscription จริงให้ถอดปุ่มนี้ทิ้ง ไม่ใช่ปล่อยไว้ให้กดที่หน้าร้าน */}
      <View style={[styles.headRow, { gap: spacing.sm }]}>
        <Button
          label="จำลองออร์เดอร์เข้า (TEST)"
          accessibilityLabel="จำลองว่ามีออร์เดอร์เข้ามาใหม่หนึ่งใบ"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => simulateArrival()}
        />
      </View>

      {!soundAvailable && settings.sound ? (
        <Text style={[typography.caption, { color: colors.warning }]}>
          เครื่องนี้ยังไม่มีโมดูลเสียง — แจ้งเตือนด้วยการสั่นและแถบบนจอเท่านั้น
          (ดู README หัวข้อ “เปิดเสียงแจ้งเตือนจริง”)
        </Text>
      ) : null}
    </View>
  );

  return (
    <ScreenContainer>
      {header}
      <FlatList
        data={orders}
        keyExtractor={order => order.id}
        contentContainerStyle={{ gap: spacing.md }}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: spacing.md } : undefined}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ยังไม่มีออร์เดอร์เข้าในรอบนี้
          </Text>
        }
        renderItem={({ item }) => {
          const waitedMs = Date.now() - Date.parse(item.receivedAt);
          return (
            <Card style={{ flex: 1 }}>
              <View style={styles.headRow}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.customerName}
                </Text>
                <StatusPill
                  label={
                    item.status === 'PENDING'
                      ? 'รอรับ'
                      : item.status === 'ACCEPTED'
                      ? 'รับแล้ว'
                      : 'ปฏิเสธ'
                  }
                  tone={
                    item.status === 'PENDING'
                      ? 'warning'
                      : item.status === 'ACCEPTED'
                      ? 'success'
                      : 'danger'
                  }
                />
              </View>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {INCOMING_CHANNEL_LABEL[item.channel]}
                {item.tableCode ? ` · โต๊ะ ${item.tableCode}` : ''} ·{' '}
                {describeAgo(waitedMs)}
              </Text>

              <View style={{ marginTop: spacing.sm }}>
                {item.lines.map(line => (
                  <View key={line.sku} style={styles.headRow}>
                    <Text
                      style={[typography.body, { color: colors.text, flex: 1 }]}
                    >
                      {line.name} × {line.qty}
                    </Text>
                    <Text style={[typography.body, { color: colors.text }]}>
                      ฿{(line.qty * line.unitPrice).toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>

              {item.note ? (
                <Text
                  style={[
                    typography.caption,
                    { color: colors.warning, marginTop: spacing.xs },
                  ]}
                >
                  หมายเหตุ: {item.note}
                </Text>
              ) : null}

              <View
                style={[
                  styles.headRow,
                  {
                    marginTop: spacing.sm,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                    paddingTop: spacing.sm,
                  },
                ]}
              >
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  ฿{incomingOrderTotal(item).toFixed(2)}
                </Text>
              </View>

              {item.status === 'PENDING' ? (
                <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
                  <Button
                    label="รับออร์เดอร์ → ส่งครัว"
                    accessibilityLabel={`รับออร์เดอร์ของ ${item.customerName} แล้วส่งเข้าครัว`}
                    fullWidth
                    onPress={() => onAccept(item)}
                  />
                  <Button
                    label="ปฏิเสธ"
                    accessibilityLabel={`ปฏิเสธออร์เดอร์ของ ${item.customerName}`}
                    variant="danger"
                    fullWidth
                    onPress={() => {
                      setRejectError('');
                      setRejectReason('');
                      setRejectTarget(item);
                    }}
                  />
                </View>
              ) : item.rejectReason ? (
                <Text
                  style={[
                    typography.caption,
                    { color: colors.textMuted, marginTop: spacing.sm },
                  ]}
                >
                  เหตุผลที่ปฏิเสธ: {item.rejectReason}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />

      <OrderAlertSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <Modal
        transparent
        visible={rejectTarget !== null}
        animationType="fade"
        onRequestClose={() => setRejectTarget(null)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setRejectTarget(null)}
          />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ปฏิเสธออร์เดอร์
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ลูกค้าต้องได้คำตอบว่าทำไมร้านรับไม่ได้ — เหตุผลจึงบังคับ
              </Text>
              <TextInput
                accessibilityLabel="เหตุผลที่ปฏิเสธ"
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="เช่น วัตถุดิบหมด / นอกเวลารับออร์เดอร์"
                placeholderTextColor={colors.textSoft}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {rejectError ? (
                <Text
                  style={[typography.captionStrong, { color: colors.danger }]}
                >
                  {rejectError}
                </Text>
              ) : null}
              <Button
                label="ยืนยันปฏิเสธ"
                variant="danger"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={submitReject}
              />
              <Button
                label="ยกเลิก"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => setRejectTarget(null)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headRow: {
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
