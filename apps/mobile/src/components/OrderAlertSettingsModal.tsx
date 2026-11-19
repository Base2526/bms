import { posText, usePosLanguage } from '../i18n/language';
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { useOrderAlerts } from '../state/OrderAlertContext';
import { ORDER_ALERT_KINDS, type OrderAlertKind } from '../lib/orderAlert';
import { fireOrderAlert } from '../state/OrderAlertContext';

const KIND_LABEL: Record<OrderAlertKind, string> = {
  get incoming_order() { return posText("ออร์เดอร์เข้าจากแชท/ออนไลน์"); },
  get kitchen_ticket() { return posText("ตั๋วครัวใบใหม่"); },
  get qr_order() { return posText("คำสั่งใหม่จาก QR โต๊ะ"); },
  get service_call() { return posText("ลูกค้าเรียกพนักงาน"); },
  get waitlist() { return posText("คิวหรือการจองโต๊ะใหม่"); },
};

const REPEAT_CHOICES = [0, 15, 30, 60];

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * ตั้งค่าการแจ้งเตือน — เก็บในหน่วยความจำต่ออุปกรณ์ ยังไม่เขียนลง storage
 *
 * ⚠️ จงใจไม่ใช้ native storage ด้วยเหตุผลเดียวกับ `StoreModeContext`: ไม่อยากให้คนที่กำลังรัน
 * JS ใหม่บน binary เก่าตั้งค่าไม่ได้ · ผลที่ยอมรับไว้คือปิดแอปแล้วกลับไปค่าปริยาย
 * (ซึ่งค่าปริยายคือ "เปิด" จึงไม่ใช่การเงียบ)
 */
export function OrderAlertSettingsModal({ visible, onClose }: Props) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const { settings, setSettings, soundAvailable, vibrationSupported } =
    useOrderAlerts();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.modal,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {posText("การแจ้งเตือนออร์เดอร์") + " "}</Text>
            <Text
              style={[
                typography.caption,
                { color: colors.textMuted, marginBottom: spacing.md },
              ]}
            >
              {posText("ตั้งค่าต่อเครื่องนี้เท่านั้น · ปิดแอปแล้วกลับเป็นค่าปริยาย (เปิด)") + " "}</Text>

            <Row
              label={posText("เปิดแจ้งเตือน")}
              value={settings.enabled}
              onChange={enabled => setSettings({ enabled })}
            />

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            {ORDER_ALERT_KINDS.map(kind => (
              <Row
                key={kind}
                label={KIND_LABEL[kind]}
                value={settings.kinds[kind]}
                disabled={!settings.enabled}
                onChange={on =>
                  setSettings({ kinds: { ...settings.kinds, [kind]: on } })
                }
              />
            ))}

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            <Row
              label={posText("เสียง")}
              value={settings.sound}
              disabled={!settings.enabled}
              onChange={sound => setSettings({ sound })}
              // ⚠️ ต้องบอกตรง ๆ ว่าเครื่องนี้เล่นเสียงไม่ได้ — สวิตช์ที่เปิดอยู่แต่เงียบสนิท
              // คือบั๊กที่ฝั่งเว็บใช้เวลาเป็นเดือนกว่าจะมีคนเจอ
              note={
                soundAvailable
                  ? undefined
                  : posText("เครื่องนี้ยังไม่มีโมดูลเสียง (ดู README)")
              }
            />
            <Row
              label={posText("สั่น")}
              value={settings.vibrate}
              disabled={!settings.enabled}
              onChange={vibrate => setSettings({ vibrate })}
              note={
                vibrationSupported
                  ? posText("แท็บเล็ตหน้าร้านหลายรุ่นไม่มีมอเตอร์สั่น")
                  : posText("แพลตฟอร์มนี้สั่นไม่ได้")
              }
            />

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            <Text style={[typography.captionStrong, { color: colors.text }]}>
              {posText("ย้ำซ้ำจนกว่าจะมีคนรับทราบ") + " "}</Text>
            <View style={styles.chips}>
              {REPEAT_CHOICES.map(seconds => {
                const selected = settings.repeatSeconds === seconds;
                return (
                  <Pressable
                    key={seconds}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      seconds === 0 ? posText("ไม่ย้ำซ้ำ") : posText("ย้ำทุก {v0} วินาที", { v0: seconds })
                    }
                    onPress={() => setSettings({ repeatSeconds: seconds })}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: 999,
                      backgroundColor: selected
                        ? colors.primary
                        : colors.surface2,
                    }}
                  >
                    <Text
                      style={[
                        typography.body,
                        {
                          color: selected ? colors.primaryText : colors.text,
                        },
                      ]}
                    >
                      {seconds === 0 ? posText("ไม่ย้ำ") : posText("{v0} วิ", { v0: seconds })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Button
              label={posText("ทดสอบแจ้งเตือน")}
              accessibilityLabel={posText("ทดสอบการแจ้งเตือนหนึ่งครั้ง")}
              variant="secondary"
              fullWidth
              style={{ marginTop: spacing.lg }}
              onPress={() => fireOrderAlert('incoming_order')}
            />
            <Button
              label={posText("ปิด")}
              fullWidth
              style={{ marginTop: spacing.sm }}
              onPress={onClose}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  onChange,
  disabled,
  note,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  note?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: spacing.sm }]}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            typography.body,
            { color: disabled ? colors.textSoft : colors.text },
          ]}
        >
          {label}
        </Text>
        {note ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {note}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '86%',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});
